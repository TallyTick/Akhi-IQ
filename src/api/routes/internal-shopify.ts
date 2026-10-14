import { timingSafeEqual, randomUUID } from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getConfig } from '../../config/env.js';
import { encryptAES256GCM } from '../../crypto/aes.js';
import { createTenantRepository } from '../../db/tenant.js';
import { merchants, shopifyInstallations } from '../../db/schema.js';

const shopDomainPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.myshopify\.com$/i;
const installBodySchema = z.object({
  shop: z.string().trim().regex(shopDomainPattern),
  accessToken: z.string().min(1),
  scopes: z.union([
    z.string().min(1),
    z.array(z.string().min(1)).min(1),
  ]),
});
const uninstallBodySchema = z.object({
  shop: z.string().trim().regex(shopDomainPattern),
});

function hasValidInternalSecret(header: string | string[] | undefined, secret: string): boolean {
  if (typeof header !== 'string') return false;
  const received = Buffer.from(header);
  const expected = Buffer.from(secret);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function authorize(request: FastifyRequest, reply: FastifyReply): boolean {
  if (!hasValidInternalSecret(request.headers['x-internal-secret'], getConfig().INTERNAL_API_SECRET)) {
    reply.status(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

export function registerInternalShopifyRoutes(app: FastifyInstance, db: any) {
  app.post('/internal/shopify/installations', async (request, reply) => {
    if (!authorize(request, reply)) return;

    const parsed = installBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid installation payload' });
    }

    const { accessToken } = parsed.data;
    const shop = parsed.data.shop.toLowerCase();
    const scope = Array.isArray(parsed.data.scopes) ? parsed.data.scopes.join(',') : parsed.data.scopes;
    const accessTokenEncrypted = encryptAES256GCM(accessToken, getConfig().encryptionKeyBuffer).serialized;

    const installation = await db.transaction(async (tx: any) => {
      const [existing] = await tx
        .select()
        .from(shopifyInstallations)
        .where(eq(shopifyInstallations.shopDomain, shop))
        .limit(1);

      if (existing) {
        const tenantRepo = createTenantRepository(tx, existing.tenantId);
        if (!(await tenantRepo.getMerchant())) {
          await tx.insert(merchants).values({
            id: existing.tenantId,
            name: shop,
          });
        }

        const [updated] = await tx
          .update(shopifyInstallations)
          .set({
            accessTokenEncrypted,
            scope,
            status: 'installed',
            updatedAt: new Date(),
          })
          .where(and(
            eq(shopifyInstallations.tenantId, existing.tenantId),
            eq(shopifyInstallations.id, existing.id)
          ))
          .returning();
        return updated;
      }

      const tenantId = randomUUID();
      await tx.insert(merchants).values({
        id: tenantId,
        name: shop,
      });

      const [created] = await tx
        .insert(shopifyInstallations)
        .values({
          id: randomUUID(),
          tenantId,
          shopDomain: shop,
          accessTokenEncrypted,
          scope,
          status: 'installed',
        })
        .returning();
      return created;
    });

    return reply.status(200).send({
      status: 'ok',
      shop: installation.shopDomain,
      tenantId: installation.tenantId,
    });
  });

  app.post('/internal/shopify/uninstalled', async (request, reply) => {
    if (!authorize(request, reply)) return;

    const parsed = uninstallBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid uninstall payload' });
    }

    const shop = parsed.data.shop.toLowerCase();
    const [installation] = await db
      .select()
      .from(shopifyInstallations)
      .where(eq(shopifyInstallations.shopDomain, shop))
      .limit(1);

    if (!installation) {
      return reply.status(404).send({ error: 'Shop installation not found' });
    }

    await db
      .update(shopifyInstallations)
      .set({
        accessTokenEncrypted: null,
        status: 'uninstalled',
        updatedAt: new Date(),
      })
      .where(and(
        eq(shopifyInstallations.tenantId, installation.tenantId),
        eq(shopifyInstallations.id, installation.id)
      ));

    return reply.status(200).send({ status: 'ok', shop });
  });
}
