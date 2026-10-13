import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createTestDb, resetTestDb, TEST_TENANT_ID, TEST_WHATSAPP_NUMBER, TEST_ENCRYPTION_KEY } from './helpers/test-db.js';
import { processInboundMessage } from '../src/conversation/processor.js';
import { MockShopifyClient } from '../src/shopify/mock.js';
import { MockWhatsAppProvider } from '../src/whatsapp/mock.js';
import { RegexOrderExtractor } from '../src/extractor/regex.js';
import { EmailHandoffStub } from '../src/handoff/email.js';
import { SEED_SHOP_DOMAIN, SEED_ORDERS } from '../src/shopify/seed-orders.js';
import { createTenantRepository } from '../src/db/tenant.js';

describe('Identity Verification Tests', () => {
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
    orderExtractor = new RegexOrderExtractor();
    handoffNotifier = new EmailHandoffStub();
  });

  it('VERIFIED: reveals order status and tracking URL when sender phone matches order phone', async () => {
    // Order #1001 customer phone is +15559998888
    const senderPhone = '+15559998888';

    await processInboundMessage({
      eventId: 'evt_verified_phone_1',
      from: senderPhone,
      to: TEST_WHATSAPP_NUMBER,
      body: 'Hi, where is my order #1001?',
      db: testDb,
      shopifyClient,
      whatsAppProvider,
      orderExtractor,
      handoffNotifier,
      encryptionKey: TEST_ENCRYPTION_KEY,
    });

    const lastMsg = whatsAppProvider.getLastMessage();
    expect(lastMsg).toBeDefined();
    // Verify deterministic template contains status and tracking
    expect(lastMsg?.body).toContain('Order #1001 Status: Delivered');
    expect(lastMsg?.body).toContain('Fulfillment: FULFILLED');
    expect(lastMsg?.body).toContain('https://track.carrier.com/1001');

    // Verify conversation state
    const tenantRepo = createTenantRepository(testDb, TEST_TENANT_ID);
    const conv = await tenantRepo.findConversationByCustomerPhone(senderPhone);
    expect(conv).toBeDefined();
    expect(conv?.verifiedAt).toBeDefined();
    expect(conv?.verifiedOrderId).toBe('gid://shopify/Order/1001');
    expect(conv?.status).toBe('active');
  });

  it('UNVERIFIED: refuses to reveal order data when phone does not match and asks for email verification', async () => {
    // Order #1002 has phone +15557776666. Sender is +15559998888 (mismatch!)
    const senderPhone = '+15559998888';

    await processInboundMessage({
      eventId: 'evt_unverified_step1',
      from: senderPhone,
      to: TEST_WHATSAPP_NUMBER,
      body: 'Can you check order #1002 for me?',
      db: testDb,
      shopifyClient,
      whatsAppProvider,
      orderExtractor,
      handoffNotifier,
      encryptionKey: TEST_ENCRYPTION_KEY,
    });

    const lastMsg = whatsAppProvider.getLastMessage();
    expect(lastMsg).toBeDefined();

    // Critical: MUST NOT contain order status, fulfillment, or tracking URL
    expect(lastMsg?.body).not.toContain('In Transit');
    expect(lastMsg?.body).not.toContain('https://track.carrier.com/1002');
    expect(lastMsg?.body).not.toContain('FULFILLED');

    // Must prompt for order number + email verification
    expect(lastMsg?.body).toMatch(/phone number.*does not match.*email/i);

    // Verify conversation stores pending order number
    const tenantRepo = createTenantRepository(testDb, TEST_TENANT_ID);
    const conv = await tenantRepo.findConversationByCustomerPhone(senderPhone);
    expect(conv).toBeDefined();
    expect(conv?.pendingOrderNumber).toBe('1002');
    expect(conv?.verifiedAt).toBeNull();
  });

  it('VERIFIED VIA EMAIL: reveals order data once user provides matching email address', async () => {
    const senderPhone = '+15559998888';

    // Step 1: Unverified request for #1002
    await processInboundMessage({
      eventId: 'evt_email_step1',
      from: senderPhone,
      to: TEST_WHATSAPP_NUMBER,
      body: 'Where is order #1002?',
      db: testDb,
      shopifyClient,
      whatsAppProvider,
      orderExtractor,
      handoffNotifier,
      encryptionKey: TEST_ENCRYPTION_KEY,
    });

    // Step 2: Customer replies with matching email (bob@example.com for order #1002)
    await processInboundMessage({
      eventId: 'evt_email_step2',
      from: senderPhone,
      to: TEST_WHATSAPP_NUMBER,
      body: 'My email is bob@example.com',
      db: testDb,
      shopifyClient,
      whatsAppProvider,
      orderExtractor,
      handoffNotifier,
      encryptionKey: TEST_ENCRYPTION_KEY,
    });

    const lastMsg = whatsAppProvider.getLastMessage();
    expect(lastMsg).toBeDefined();

    // Now order data is safely revealed!
    expect(lastMsg?.body).toContain('Order #1002 Status: In Transit');
    expect(lastMsg?.body).toContain('Fulfillment: IN_TRANSIT');
    expect(lastMsg?.body).toContain('https://track.carrier.com/1002');

    // Verify conversation updated
    const tenantRepo = createTenantRepository(testDb, TEST_TENANT_ID);
    const conv = await tenantRepo.findConversationByCustomerPhone(senderPhone);
    expect(conv?.verifiedEmail).toBe('bob@example.com');
    expect(conv?.pendingOrderNumber).toBeNull();
  });

  it('UNVERIFIED EMAIL MISMATCH: refuses to reveal order data, triggers handoff when email is incorrect', async () => {
    const senderPhone = '+15559998888';

    // Step 1: Request for #1002
    await processInboundMessage({
      eventId: 'evt_wrong_email_step1',
      from: senderPhone,
      to: TEST_WHATSAPP_NUMBER,
      body: 'Order #1002 status please',
      db: testDb,
      shopifyClient,
      whatsAppProvider,
      orderExtractor,
      handoffNotifier,
      encryptionKey: TEST_ENCRYPTION_KEY,
    });

    // Step 2: Customer replies with WRONG email
    await processInboundMessage({
      eventId: 'evt_wrong_email_step2',
      from: senderPhone,
      to: TEST_WHATSAPP_NUMBER,
      body: 'attacker@fraud.com',
      db: testDb,
      shopifyClient,
      whatsAppProvider,
      orderExtractor,
      handoffNotifier,
      encryptionKey: TEST_ENCRYPTION_KEY,
    });

    const lastMsg = whatsAppProvider.getLastMessage();
    expect(lastMsg).toBeDefined();

    // Never reveals order info
    expect(lastMsg?.body).not.toContain('In Transit');
    expect(lastMsg?.body).not.toContain('https://track.carrier.com/1002');
    expect(lastMsg?.body).toMatch(/does not match our records.*support/i);

    // Verify handoff was created
    const tenantRepo = createTenantRepository(testDb, TEST_TENANT_ID);
    const handoffs = await tenantRepo.listHandoffs();
    expect(handoffs.length).toBe(1);
    expect(handoffs[0].reason).toBe('unverified');

    // Verify email notifier stub was called
    expect(handoffNotifier.notifications.length).toBe(1);
    expect(handoffNotifier.notifications[0].reason).toBe('unverified');
  });
});
