import { timingSafeEqual, randomUUID } from 'node:crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getConfig } from '../../config/env.js';
import {
  conversations,
  handoffs,
  merchants,
  messages,
  shopifyInstallations,
  subscriptions,
  usage,
  whatsappNumbers,
  webhookEvents,
} from '../../db/schema.js';

const shopDomainPattern = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const shopSchema = z.string().regex(shopDomainPattern);
const shopBodySchema = z.object({ shop: shopSchema });
const customerBodySchema = z.object({
  shop: shopSchema,
  phones: z.array(z.string()).default([]),
  emails: z.array(z.string()).default([]),
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

async function findCustomerConversations(db: any, tenantId: string, phones: string[], emails: string[]) {
  const customerMatch = [
    phones.length ? inArray(conversations.customerPhone, phones) : undefined,
    emails.length ? inArray(sql`lower(${conversations.verifiedEmail})`, emails.map((email) => email.toLowerCase())) : undefined,
  ].filter((condition) => condition !== undefined);

  if (customerMatch.length === 0) return [];
  return db.select().from(conversations).where(and(
    eq(conversations.tenantId, tenantId),
    or(...customerMatch)
  ));
}

export function registerInternalShopifyRoutes(app: FastifyInstance, db: any) {
  app.post('/internal/shopify/installations', async (request, reply) => {
    if (!authorize(request, reply)) return;

    const parsed = shopBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid installation payload' });

    const shop = parsed.data.shop;
    const result = await db.transaction(async (tx: any) => {
      const [existing] = await tx.select().from(merchants)
        .where(eq(merchants.shopDomain, shop)).limit(1);

      if (existing) {
        const [updated] = await tx.update(merchants)
          .set({ name: shop, isActive: true, handoffEmail: null, updatedAt: new Date() })
          .where(eq(merchants.id, existing.id))
          .returning();
        return updated;
      }

      const [created] = await tx.insert(merchants).values({
        id: randomUUID(),
        name: shop,
        shopDomain: shop,
        isActive: true,
        handoffEmail: null,
      }).returning();
      return created;
    });

    return reply.status(200).send({ status: 'ok', shop, tenantId: result.id });
  });

  app.post('/internal/shopify/uninstalled', async (request, reply) => {
    if (!authorize(request, reply)) return;

    const parsed = shopBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid uninstall payload' });

    const [merchant] = await db.select().from(merchants)
      .where(eq(merchants.shopDomain, parsed.data.shop)).limit(1);
    if (!merchant) return reply.status(404).send({ error: 'Shop not found' });

    await db.update(merchants)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(merchants.id, merchant.id));

    return reply.status(200).send({ status: 'ok', shop: parsed.data.shop });
  });

  app.post('/internal/shopify/customer-data', async (request, reply) => {
    if (!authorize(request, reply)) return;

    const parsed = customerBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid customer-data payload' });

    const [merchant] = await db.select().from(merchants)
      .where(eq(merchants.shopDomain, parsed.data.shop)).limit(1);
    if (!merchant) return reply.status(404).send({ error: 'Shop not found' });

    const customerConversations = await findCustomerConversations(
      db,
      merchant.id,
      parsed.data.phones,
      parsed.data.emails
    );
    const conversationIds = customerConversations.map((conversation: typeof conversations.$inferSelect) => conversation.id);
    const [customerMessages, customerHandoffs] = conversationIds.length
      ? await Promise.all([
        db.select().from(messages).where(and(
          eq(messages.tenantId, merchant.id),
          inArray(messages.conversationId, conversationIds)
        )),
        db.select().from(handoffs).where(and(
          eq(handoffs.tenantId, merchant.id),
          inArray(handoffs.conversationId, conversationIds)
        )),
      ])
      : [[], []];

    return reply.status(200).send({
      conversations: customerConversations,
      messages: customerMessages,
      handoffs: customerHandoffs,
    });
  });

  app.post('/internal/shopify/redact-customer', async (request, reply) => {
    if (!authorize(request, reply)) return;

    const parsed = customerBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid redact-customer payload' });

    const [merchant] = await db.select().from(merchants)
      .where(eq(merchants.shopDomain, parsed.data.shop)).limit(1);
    if (!merchant) return reply.status(404).send({ error: 'Shop not found' });

    await db.transaction(async (tx: any) => {
      const customerConversations = await findCustomerConversations(
        tx,
        merchant.id,
        parsed.data.phones,
        parsed.data.emails
      );
      const conversationIds = customerConversations.map((conversation: typeof conversations.$inferSelect) => conversation.id);
      if (conversationIds.length === 0) return;

      await tx.delete(messages).where(and(
        eq(messages.tenantId, merchant.id),
        inArray(messages.conversationId, conversationIds)
      ));
      await tx.delete(handoffs).where(and(
        eq(handoffs.tenantId, merchant.id),
        inArray(handoffs.conversationId, conversationIds)
      ));
      await tx.delete(conversations).where(and(
        eq(conversations.tenantId, merchant.id),
        inArray(conversations.id, conversationIds)
      ));
    });

    return reply.status(200).send({ status: 'ok' });
  });

  app.post('/internal/shopify/redact-shop', async (request, reply) => {
    if (!authorize(request, reply)) return;

    const parsed = shopBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid redact-shop payload' });

    const [merchant] = await db.select().from(merchants)
      .where(eq(merchants.shopDomain, parsed.data.shop)).limit(1);
    if (!merchant) return reply.status(404).send({ error: 'Shop not found' });

    await db.transaction(async (tx: any) => {
      await tx.delete(messages).where(eq(messages.tenantId, merchant.id));
      await tx.delete(handoffs).where(eq(handoffs.tenantId, merchant.id));
      await tx.delete(conversations).where(eq(conversations.tenantId, merchant.id));
      await tx.delete(webhookEvents).where(eq(webhookEvents.tenantId, merchant.id));
      await tx.delete(shopifyInstallations).where(eq(shopifyInstallations.tenantId, merchant.id));
      await tx.delete(whatsappNumbers).where(eq(whatsappNumbers.tenantId, merchant.id));
      await tx.delete(subscriptions).where(eq(subscriptions.tenantId, merchant.id));
      await tx.delete(usage).where(eq(usage.tenantId, merchant.id));
      await tx.delete(merchants).where(eq(merchants.id, merchant.id));
    });

    return reply.status(200).send({ status: 'ok' });
  });
}
