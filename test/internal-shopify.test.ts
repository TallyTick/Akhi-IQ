import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/api/app.js';
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
} from '../src/db/schema.js';
import { createTestDb } from './helpers/test-db.js';

const internalSecret = process.env.INTERNAL_API_SECRET!;
const secureShop = 'secure-shop.myshopify.com';
const otherShop = 'other-shop.myshopify.com';
const customerPhone = '+15550002222';
const customerEmail = 'customer@example.com';

describe('Internal Shopify installation and privacy API', () => {
  let app: FastifyInstance;
  let db: any;
  let pglite: any;
  let secureTenantId: string;
  let otherTenantId: string;

  const post = async (url: string, payload: any, secret = internalSecret) => await app.inject({
    method: 'POST',
    url,
    headers: { 'x-internal-secret': secret },
    payload,
  });

  beforeAll(async () => {
    ({ db, pglite } = await createTestDb());
    app = await buildApp({ db });
    await app.ready();
  });

  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      if (pglite) await pglite.close();
    }
  });

  it('rejects a wrong internal secret', async () => {
    const response = await post('/internal/shopify/installations', { shop: secureShop }, 'wrong-internal-secret-value');
    expect(response.statusCode).toBe(401);
  });

  it('rejects a shop that does not match the required domain format', async () => {
    const response = await post('/internal/shopify/installations', { shop: 'Secure-shop.myshopify.com' });
    expect(response.statusCode).toBe(400);
  });

  it('creates an active merchant without storing a Shopify token', async () => {
    const response = await post('/internal/shopify/installations', {
      shop: secureShop,
      accessToken: 'must-not-be-stored',
    });
    expect(response.statusCode).toBe(200);
    secureTenantId = response.json().tenantId;

    const [merchant] = await db.select().from(merchants).where(eq(merchants.id, secureTenantId));
    const [installation] = await db.select().from(shopifyInstallations)
      .where(eq(shopifyInstallations.shopDomain, secureShop));
    expect(merchant).toMatchObject({ shopDomain: secureShop, isActive: true, handoffEmail: null });
    expect(installation).toBeUndefined();

    const repeatedResponse = await post('/internal/shopify/installations', { shop: secureShop });
    expect(repeatedResponse.json().tenantId).toBe(secureTenantId);
  });

  it('deactivates an uninstalled merchant and allows installation to reactivate it', async () => {
    const response = await post('/internal/shopify/uninstalled', { shop: secureShop });
    expect(response.statusCode).toBe(200);
    const [inactiveMerchant] = await db.select().from(merchants).where(eq(merchants.id, secureTenantId));
    expect(inactiveMerchant.isActive).toBe(false);

    await post('/internal/shopify/installations', { shop: secureShop });
    const [activeMerchant] = await db.select().from(merchants).where(eq(merchants.id, secureTenantId));
    expect(activeMerchant.isActive).toBe(true);
  });

  it('exports only the requested customer data belonging to the requested merchant', async () => {
    const otherInstall = await post('/internal/shopify/installations', { shop: otherShop });
    otherTenantId = otherInstall.json().tenantId;

    const [phoneConversation] = await db.insert(conversations).values({
      id: 'privacy_phone_conversation',
      tenantId: secureTenantId,
      customerPhone,
      verifiedEmail: null,
    }).returning();
    const [emailConversation] = await db.insert(conversations).values({
      id: 'privacy_email_conversation',
      tenantId: secureTenantId,
      customerPhone: '+15550003333',
      verifiedEmail: customerEmail,
    }).returning();
    const [unrelatedConversation] = await db.insert(conversations).values({
      id: 'privacy_unrelated_conversation',
      tenantId: secureTenantId,
      customerPhone: '+15550004444',
    }).returning();
    await db.insert(conversations).values({
      id: 'privacy_other_tenant_conversation',
      tenantId: otherTenantId,
      customerPhone,
    });

    const conversationFixtures = [
      [phoneConversation.id, secureTenantId],
      [emailConversation.id, secureTenantId],
      [unrelatedConversation.id, secureTenantId],
      ['privacy_other_tenant_conversation', otherTenantId],
    ] as const;
    for (const [conversationId, tenantId] of conversationFixtures) {
      await db.insert(messages).values({
        id: `${conversationId}_message`,
        tenantId,
        conversationId,
        direction: 'inbound',
        sender: customerPhone,
        recipient: '+15550001111',
        body: 'private message',
      });
      await db.insert(handoffs).values({
        id: `${conversationId}_handoff`,
        tenantId,
        conversationId,
        customerPhone,
        customerMessage: 'private handoff message',
        reason: 'unclear_intent',
      });
    }

    const response = await post('/internal/shopify/customer-data', {
      shop: secureShop,
      phones: [customerPhone],
      emails: [customerEmail],
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().conversations.map((conversation: typeof conversations.$inferSelect) => conversation.id).sort())
      .toEqual([phoneConversation.id, emailConversation.id].sort());
    expect(response.json().messages).toHaveLength(2);
    expect(response.json().handoffs).toHaveLength(2);
    expect(response.json().messages.every((message: typeof messages.$inferSelect) => message.tenantId === secureTenantId)).toBe(true);
  });

  it('redacts only matching customer data for the requested merchant', async () => {
    const response = await post('/internal/shopify/redact-customer', {
      shop: secureShop,
      phones: [customerPhone],
      emails: [customerEmail],
    });
    expect(response.statusCode).toBe(200);

    const remainingSecureConversations = await db.select().from(conversations)
      .where(eq(conversations.tenantId, secureTenantId));
    const remainingOtherConversations = await db.select().from(conversations)
      .where(eq(conversations.tenantId, otherTenantId));
    expect(remainingSecureConversations.map((conversation: typeof conversations.$inferSelect) => conversation.id))
      .toEqual(['privacy_unrelated_conversation']);
    expect(remainingOtherConversations.map((conversation: typeof conversations.$inferSelect) => conversation.id))
      .toEqual(['privacy_other_tenant_conversation']);

    const secureMessages = await db.select().from(messages).where(eq(messages.tenantId, secureTenantId));
    const otherMessages = await db.select().from(messages).where(eq(messages.tenantId, otherTenantId));
    expect(secureMessages.map((message: typeof messages.$inferSelect) => message.conversationId))
      .toEqual(['privacy_unrelated_conversation']);
    expect(otherMessages).toHaveLength(1);
  });

  it('redacts all data for one shop and preserves another merchant', async () => {
    await db.insert(whatsappNumbers).values({
      id: 'privacy_secure_number',
      tenantId: secureTenantId,
      phoneNumber: '+15550005555',
    });
    await db.insert(subscriptions).values({
      id: 'privacy_secure_subscription',
      tenantId: secureTenantId,
      plan: 'starter',
    });
    await db.insert(usage).values({
      id: 'privacy_secure_usage',
      tenantId: secureTenantId,
      metric: 'messages_inbound',
    });
    await db.insert(webhookEvents).values({
      id: 'privacy_secure_webhook',
      tenantId: secureTenantId,
      eventId: 'privacy-secure-event',
      payload: '{}',
    });
    await db.insert(shopifyInstallations).values({
      id: 'privacy_secure_installation',
      tenantId: secureTenantId,
      shopDomain: secureShop,
      accessTokenEncrypted: null,
    });

    const response = await post('/internal/shopify/redact-shop', { shop: secureShop });
    expect(response.statusCode).toBe(200);

    const secureMerchant = await db.select().from(merchants).where(eq(merchants.id, secureTenantId));
    expect(secureMerchant).toHaveLength(0);
    for (const table of [conversations, messages, handoffs, whatsappNumbers, subscriptions, usage, webhookEvents, shopifyInstallations]) {
      const remaining = await db.select().from(table).where(eq(table.tenantId, secureTenantId));
      expect(remaining).toHaveLength(0);
    }

    const otherMerchant = await db.select().from(merchants).where(eq(merchants.id, otherTenantId));
    const otherConversations = await db.select().from(conversations).where(eq(conversations.tenantId, otherTenantId));
    expect(otherMerchant).toHaveLength(1);
    expect(otherConversations).toHaveLength(1);
  });
});
