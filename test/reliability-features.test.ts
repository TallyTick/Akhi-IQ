import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDb, resetTestDb, TEST_TENANT_ID, TEST_WHATSAPP_NUMBER, TEST_ENCRYPTION_KEY } from './helpers/test-db.js';
import { processInboundMessage } from '../src/conversation/processor.js';
import { MockShopifyClient } from '../src/shopify/mock.js';
import { MockWhatsAppProvider } from '../src/whatsapp/mock.js';
import { RegexOrderExtractor } from '../src/extractor/regex.js';
import { EmailHandoffStub } from '../src/handoff/email.js';
import { SEED_SHOP_DOMAIN, SEED_ORDERS } from '../src/shopify/seed-orders.js';
import { createTenantRepository } from '../src/db/tenant.js';
import { buildApp } from '../src/api/app.js';
import { FastifyInstance } from 'fastify';

describe('Production Reliability & Merchant Features Tests', () => {
  let testDb: any;
  let pgliteInstance: any;
  let shopifyClient: MockShopifyClient;
  let whatsAppProvider: MockWhatsAppProvider;
  let orderExtractor: RegexOrderExtractor;
  let handoffNotifier: EmailHandoffStub;
  let app: FastifyInstance;

  beforeAll(async () => {
    const { db, pglite } = await createTestDb();
    testDb = db;
    pgliteInstance = pglite;

    app = await buildApp({
      db: testDb,
    });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    if (pgliteInstance) await pgliteInstance.close();
  });

  beforeEach(async () => {
    await resetTestDb(testDb);

    shopifyClient = new MockShopifyClient();
    for (const order of SEED_ORDERS) {
      shopifyClient.addMockOrder(SEED_SHOP_DOMAIN, order);
    }

    whatsAppProvider = new MockWhatsAppProvider();
    orderExtractor = new RegexOrderExtractor();
    handoffNotifier = new EmailHandoffStub();
  });

  describe('Reliability: Retries and System Errors', () => {
    it('retries failing Shopify call and handles permanent failure by emailing merchant instead of dropping', async () => {
      // Create a shopify client where getOrder always throws
      const failingShopifyClient = {
        getOrder: async () => {
          throw new Error('Shopify API 500 Internal Server Error');
        },
        getRecentOrdersByPhone: async () => [],
      };

      await processInboundMessage({
        eventId: 'evt_retry_fail_1',
        from: '+15559998888',
        to: TEST_WHATSAPP_NUMBER,
        body: 'Where is my order #1001?',
        db: testDb,
        shopifyClient: failingShopifyClient as any,
        whatsAppProvider,
        orderExtractor,
        handoffNotifier,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      // Conversation must be marked needs_human
      const tenantRepo = createTenantRepository(testDb, TEST_TENANT_ID);
      const conv = await tenantRepo.findConversationByCustomerPhone('+15559998888');
      expect(conv?.status).toBe('needs_human');

      // Merchant must be emailed about system error
      expect(handoffNotifier.notifications.length).toBe(1);
      const notif = handoffNotifier.getLastNotification();
      expect(notif?.reason).toBe('system_error');
      expect(notif?.summary).toContain('Shopify API error after retries');
    });

    it('prevents sending two replies to the exact same inbound event', async () => {
      const eventId = 'evt_dedup_reply_1';

      // First call
      await processInboundMessage({
        eventId,
        from: '+15559998888',
        to: TEST_WHATSAPP_NUMBER,
        body: 'Where is my order #1001?',
        db: testDb,
        shopifyClient,
        whatsAppProvider,
        orderExtractor,
        handoffNotifier,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      expect(whatsAppProvider.sentMessages.length).toBe(1);

      // Duplicate execution for the same inbound message
      await processInboundMessage({
        eventId,
        from: '+15559998888',
        to: TEST_WHATSAPP_NUMBER,
        body: 'Where is my order #1001?',
        db: testDb,
        shopifyClient,
        whatsAppProvider,
        orderExtractor,
        handoffNotifier,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      // Message count remains strictly 1!
      expect(whatsAppProvider.sentMessages.length).toBe(1);
    });

    it('enforces WhatsApp 24-hour window by sending approved placeholder when window closed', async () => {
      const senderPhone = '+15559998888';
      const tenantRepo = createTenantRepository(testDb, TEST_TENANT_ID);

      // Create conversation with last message 25 hours ago
      const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
      await tenantRepo.createConversation({
        customerPhone: senderPhone,
        status: 'active',
        lastCustomerMessageAt: twentyFiveHoursAgo,
      });

      await processInboundMessage({
        eventId: 'evt_window_closed_1',
        from: senderPhone,
        to: TEST_WHATSAPP_NUMBER,
        body: 'Where is my order #1001?',
        db: testDb,
        shopifyClient,
        whatsAppProvider,
        orderExtractor,
        handoffNotifier,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      const lastMsg = whatsAppProvider.getLastMessage();
      expect(lastMsg?.body).toContain('[Customer Support Update]');

      const conv = await tenantRepo.findConversationByCustomerPhone(senderPhone);
      expect(conv?.status).toBe('needs_human');
      expect(handoffNotifier.getLastNotification()?.reason).toBe('window_closed');
    });
  });

  describe('Merchant Features: Settings and Monthly Summary', () => {
    it('GET /settings renders HTML settings page', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/settings?merchantId=${TEST_TENANT_ID}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('Merchant Settings');
      expect(res.body).toContain('Handoff Alert Email Address');
    });

    it('POST /settings updates merchant handoff email and templates', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/settings?merchantId=${TEST_TENANT_ID}`,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        payload: 'handoffEmail=custom-desk@acme.com&customTemplates={"greeting":"Hi there"}',
      });

      expect(res.statusCode).toBe(200);

      const tenantRepo = createTenantRepository(testDb, TEST_TENANT_ID);
      const merchant = await tenantRepo.getMerchant();
      expect(merchant?.handoffEmail).toBe('custom-desk@acme.com');
      expect(merchant?.customTemplates).toBe('{"greeting":"Hi there"}');
    });

    it('POST /merchants/:merchantId/reports/monthly generates monthly summary and sends email', async () => {
      const tenantRepo = createTenantRepository(testDb, TEST_TENANT_ID);

      // Create 3 active resolved conversations and 1 handoff conversation
      await tenantRepo.createConversation({ customerPhone: '+15551110001', status: 'resolved' });
      await tenantRepo.createConversation({ customerPhone: '+15551110002', status: 'resolved' });
      await tenantRepo.createConversation({ customerPhone: '+15551110003', status: 'resolved' });
      await tenantRepo.createConversation({ customerPhone: '+15551110004', status: 'needs_human' });

      const now = new Date();
      const res = await app.inject({
        method: 'POST',
        url: `/merchants/${TEST_TENANT_ID}/reports/monthly?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`,
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.status).toBe('ok');
      expect(json.report.totalConversations).toBe(4);
      expect(json.report.conversationsHandledAutomatically).toBe(3);
      expect(json.report.conversationsHandedOff).toBe(1);
      expect(json.report.estimatedHoursSaved).toBe(0.5); // 3 * 10min = 30min = 0.5hr
    });
  });
});
