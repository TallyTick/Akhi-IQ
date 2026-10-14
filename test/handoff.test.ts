import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDb, resetTestDb, TEST_TENANT_ID, TEST_WHATSAPP_NUMBER, TEST_ENCRYPTION_KEY } from './helpers/test-db.js';
import { processInboundMessage } from '../src/conversation/processor.js';
import { MockShopifyClient } from '../src/shopify/mock.js';
import { MockWhatsAppProvider } from '../src/whatsapp/mock.js';
import { RegexOrderExtractor } from '../src/extractor/regex.js';
import { EmailHandoffStub } from '../src/handoff/email.js';
import { createTenantRepository } from '../src/db/tenant.js';

describe('Human Handoff & Unclear Intent Tests', () => {
  let testDb: any;
  let pgliteInstance: any;
  let shopifyClient: MockShopifyClient;
  let whatsAppProvider: MockWhatsAppProvider;
  let orderExtractor: RegexOrderExtractor;
  let handoffNotifier: EmailHandoffStub;

  beforeAll(async () => {
    const { db, pglite } = await createTestDb();
    testDb = db;
    pgliteInstance = pglite;
  });

  afterAll(async () => {
    if (pgliteInstance) await pgliteInstance.close();
  });

  beforeEach(async () => {
    await resetTestDb(testDb);

    shopifyClient = new MockShopifyClient();
    whatsAppProvider = new MockWhatsAppProvider();
    orderExtractor = new RegexOrderExtractor();
    handoffNotifier = new EmailHandoffStub();
  });

  it('marks conversation needs_human and creates handoff when customer asks for a human agent', async () => {
    const senderPhone = '+15554443333';

    await processInboundMessage({
      eventId: 'evt_handoff_human_1',
      from: senderPhone,
      to: TEST_WHATSAPP_NUMBER,
      body: 'Can I please speak to a human support agent?',
      db: testDb,
      shopifyClient,
      whatsAppProvider,
      orderExtractor,
      handoffNotifier,
      encryptionKey: TEST_ENCRYPTION_KEY,
    });

    const lastMsg = whatsAppProvider.getLastMessage();
    expect(lastMsg?.body).toMatch(/transferred.*human support team/i);

    // Verify conversation status
    const tenantRepo = createTenantRepository(testDb, TEST_TENANT_ID);
    const conv = await tenantRepo.findConversationByCustomerPhone(senderPhone);
    expect(conv?.status).toBe('needs_human');

    // Verify handoff record in DB
    const handoffList = await tenantRepo.listHandoffs();
    expect(handoffList.length).toBe(1);
    expect(handoffList[0].reason).toBe('human_requested');
    expect(handoffList[0].summary).toBe('Can I please speak to a human support agent?');

    // Verify email notifier stub received event
    expect(handoffNotifier.notifications.length).toBe(1);
    const notification = handoffNotifier.getLastNotification();
    expect(notification?.reason).toBe('human_requested');
    expect(notification?.tenantId).toBe(TEST_TENANT_ID);
    expect(notification?.customerPhone).toBe(senderPhone);
  });

  it('marks conversation needs_human and creates handoff when intent is unclear', async () => {
    const senderPhone = '+15552221111';

    await processInboundMessage({
      eventId: 'evt_handoff_unclear_1',
      from: senderPhone,
      to: TEST_WHATSAPP_NUMBER,
      body: 'hello what is the color of the moon today',
      db: testDb,
      shopifyClient,
      whatsAppProvider,
      orderExtractor,
      handoffNotifier,
      encryptionKey: TEST_ENCRYPTION_KEY,
    });

    const lastMsg = whatsAppProvider.getLastMessage();
    expect(lastMsg?.body).toMatch(/support team.*agent will be with you/i);

    const tenantRepo = createTenantRepository(testDb, TEST_TENANT_ID);
    const conv = await tenantRepo.findConversationByCustomerPhone(senderPhone);
    expect(conv?.status).toBe('needs_human');

    const handoffList = await tenantRepo.listHandoffs();
    expect(handoffList.length).toBe(1);
    expect(handoffList[0].reason).toBe('unclear_intent');

    expect(handoffNotifier.notifications.length).toBe(1);
    expect(handoffNotifier.getLastNotification()?.reason).toBe('unclear_intent');
  });

  it('reminds customer when sending further messages in an ongoing needs_human conversation', async () => {
    const senderPhone = '+15553332222';

    // Step 1: Request agent
    await processInboundMessage({
      eventId: 'evt_handoff_persist_1',
      from: senderPhone,
      to: TEST_WHATSAPP_NUMBER,
      body: 'I need a human representative',
      db: testDb,
      shopifyClient,
      whatsAppProvider,
      orderExtractor,
      handoffNotifier,
      encryptionKey: TEST_ENCRYPTION_KEY,
    });

    // Step 2: Send another message while waiting
    await processInboundMessage({
      eventId: 'evt_handoff_persist_2',
      from: senderPhone,
      to: TEST_WHATSAPP_NUMBER,
      body: 'Is anyone there?',
      db: testDb,
      shopifyClient,
      whatsAppProvider,
      orderExtractor,
      handoffNotifier,
      encryptionKey: TEST_ENCRYPTION_KEY,
    });

    const lastMsg = whatsAppProvider.getLastMessage();
    expect(lastMsg?.body).toMatch(/human agent will respond.*shortly/i);

    const tenantRepo = createTenantRepository(testDb, TEST_TENANT_ID);
    const conv = await tenantRepo.findConversationByCustomerPhone(senderPhone);
    expect(conv?.status).toBe('needs_human');
  });
});
