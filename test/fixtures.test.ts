import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDb, resetTestDb, TEST_TENANT_ID, TEST_WHATSAPP_NUMBER, TEST_ENCRYPTION_KEY } from './helpers/test-db.js';
import { processInboundMessage } from '../src/conversation/processor.js';
import { MockShopifyClient } from '../src/shopify/mock.js';
import { MockWhatsAppProvider } from '../src/whatsapp/mock.js';
import { LLMOrderExtractor } from '../src/extractor/llm.js';
import { EmailHandoffStub } from '../src/handoff/email.js';
import { SEED_SHOP_DOMAIN, SEED_ORDERS } from '../src/shopify/seed-orders.js';
import { createTenantRepository } from '../src/db/tenant.js';
import { REALISTIC_MESSAGE_FIXTURES, CustomerMessageFixture } from './fixtures/realistic-messages.js';

describe('30 Realistic Customer Messages Fixtures Suite', () => {
  let testDb: any;
  let pgliteInstance: any;
  let shopifyClient: MockShopifyClient;
  let whatsAppProvider: MockWhatsAppProvider;
  let orderExtractor: LLMOrderExtractor;
  let handoffNotifier: EmailHandoffStub;

  beforeAll(async () => {
    const { db, pglite } = await createTestDb();
    testDb = db;
    pgliteInstance = pglite;
  });

  afterAll(async () => {
    if (pgliteInstance) {
      await pgliteInstance.close();
    }
  });

  beforeEach(async () => {
    await resetTestDb(testDb);

    shopifyClient = new MockShopifyClient();
    for (const order of SEED_ORDERS) {
      shopifyClient.addMockOrder(SEED_SHOP_DOMAIN, order);
    }

    whatsAppProvider = new MockWhatsAppProvider();
    orderExtractor = new LLMOrderExtractor({ provider: 'stub' });
    handoffNotifier = new EmailHandoffStub();
  });

  for (const fixture of REALISTIC_MESSAGE_FIXTURES) {
    it(`[${fixture.id}] ${fixture.description}`, async () => {
      const tenantRepo = createTenantRepository(testDb, TEST_TENANT_ID);

      // Precondition for multi-step fixtures:
      // msg_16 & msg_17: customer previously asked for #1002 with mismatched phone
      if (fixture.id === 'msg_16_email_match' || fixture.id === 'msg_17_email_mismatch') {
        const conv = await tenantRepo.createConversation({
          customerPhone: fixture.senderPhone,
          pendingOrderNumber: '1002',
          status: 'active',
        });
      }

      // msg_19: customer previously failed first attempt for #9999
      if (fixture.id === 'msg_19_order_not_found_try2') {
        await tenantRepo.createConversation({
          customerPhone: fixture.senderPhone,
          failedOrderLookupCount: 1,
          status: 'active',
        });
      }

      await processInboundMessage({
        eventId: `evt_${fixture.id}`,
        from: fixture.senderPhone,
        to: fixture.businessPhone,
        body: fixture.message,
        db: testDb,
        shopifyClient,
        whatsAppProvider,
        orderExtractor,
        handoffNotifier,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      const lastMsg = whatsAppProvider.getLastMessage();
      expect(lastMsg).toBeDefined();

      if (fixture.expectedResponseSnippet) {
        expect(lastMsg?.body.toLowerCase()).toContain(fixture.expectedResponseSnippet.toLowerCase());
      }

      const conv = await tenantRepo.findConversationByCustomerPhone(fixture.senderPhone);

      switch (fixture.expectedOutcome) {
        case 'order_status_revealed': {
          expect(conv?.status).toBe('active');
          expect(conv?.verifiedAt).toBeDefined();
          break;
        }

        case 'email_verification_requested': {
          expect(conv?.pendingOrderNumber).toBe('1002');
          // Must not disclose order details
          expect(lastMsg?.body).not.toContain('In Transit');
          expect(lastMsg?.body).not.toContain('https://track.carrier.com/1002');
          break;
        }

        case 'order_not_found_prompt': {
          expect(conv?.failedOrderLookupCount).toBe(1);
          expect(conv?.status).toBe('active');
          break;
        }

        case 'order_not_found_handoff':
        case 'refund_handoff':
        case 'angry_customer_handoff':
        case 'human_handoff':
        case 'unclear_handoff': {
          expect(conv?.status).toBe('needs_human');
          const lastNotif = handoffNotifier.getLastNotification();
          expect(lastNotif).toBeDefined();
          if (fixture.expectedHandoffReason) {
            expect(lastNotif?.reason).toBe(fixture.expectedHandoffReason);
          }
          expect(lastNotif?.customerPhone).toBe(fixture.senderPhone);
          expect(lastNotif?.customerMessage).toBe(fixture.message);
          break;
        }

        case 'multiple_orders_listed': {
          expect(lastMsg?.body).toContain('1001');
          expect(lastMsg?.body).toContain('1003');
          break;
        }

        case 'ask_for_order_number': {
          expect(conv?.status).toBe('active');
          break;
        }
      }
    });
  }
});
