import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { processInboundMessage } from '../src/conversation/processor.js';
import { createTenantRepository } from '../src/db/tenant.js';
import { EmailHandoffStub } from '../src/handoff/email.js';
import { MockWhatsAppProvider } from '../src/whatsapp/mock.js';
import { RegexOrderExtractor } from '../src/extractor/regex.js';
import { ShopifyAppProxyClient } from '../src/shopify/app-proxy.js';
import {
  createTestDb,
  resetTestDb,
  TEST_ENCRYPTION_KEY,
  TEST_TENANT_ID,
  TEST_WHATSAPP_NUMBER,
} from './helpers/test-db.js';

const INTERNAL_SECRET = 'test-internal-api-secret-that-is-at-least-32-chars';
const SHOP_DOMAIN = 'acme-store.myshopify.com';
const APP_URL = 'https://shopify-app.example.test/base';

describe('Shopify app proxy order lookup', () => {
  let db: any;
  let pglite: any;
  let client: ShopifyAppProxyClient;
  let whatsAppProvider: MockWhatsAppProvider;
  let handoffNotifier: EmailHandoffStub;

  beforeAll(async () => {
    ({ db, pglite } = await createTestDb());
  });

  afterAll(async () => {
    if (pglite) await pglite.close();
  });

  beforeEach(async () => {
    await resetTestDb(db);
    client = new ShopifyAppProxyClient(APP_URL, INTERNAL_SECRET, 10);
    whatsAppProvider = new MockWhatsAppProvider();
    handoffNotifier = new EmailHandoffStub();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function processOrderInquiry(from = '+27 66 275 6217'): Promise<void> {
    await processInboundMessage({
      eventId: `evt_proxy_${Math.random()}`,
      from,
      to: TEST_WHATSAPP_NUMBER,
      body: 'Where is my order #1001?',
      db,
      shopifyClient: client,
      whatsAppProvider,
      orderExtractor: new RegexOrderExtractor(),
      handoffNotifier,
      encryptionKey: TEST_ENCRYPTION_KEY,
    });
  }

  function mockLookupResponse(body: unknown, status = 200): void {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status })
    ));
  }

  const foundOrder = {
    found: true,
    orderNumber: '1001',
    financialStatus: 'PAID',
    fulfillmentStatus: 'IN_TRANSIT',
    cancelled: false,
    trackingCompany: 'DHL',
    trackingNumber: 'DHL-1001',
    trackingUrl: 'https://track.example.test/1001',
    phones: ['+1 555 000 1234', '+27 66 275 6217'],
    email: 'customer@example.test',
  };

  it('reveals the order when any phone in the response matches after normalization', async () => {
    mockLookupResponse(foundOrder);

    await processOrderInquiry();

    const message = whatsAppProvider.getLastMessage()?.body || '';
    expect(message).toContain('Order #1001 Status: In Transit');
    expect(message).toContain('https://track.example.test/1001');

    const [requestUrl, request] = vi.mocked(fetch).mock.calls[0];
    expect(requestUrl).toBe(`${APP_URL}/internal/orders/lookup`);
    expect(request?.method).toBe('POST');
    expect(new Headers(request?.headers).get('x-internal-secret')).toBe(INTERNAL_SECRET);
    expect(JSON.parse(String(request?.body))).toEqual({
      shop: SHOP_DOMAIN,
      orderNumber: '1001',
    });
  });

  it('does not reveal order data when no phone matches', async () => {
    mockLookupResponse({ ...foundOrder, phones: ['+1 555 000 1234'] });

    await processOrderInquiry();

    const message = whatsAppProvider.getLastMessage()?.body || '';
    expect(message).toMatch(/phone number.*does not match.*email/i);
    expect(message).not.toContain('In Transit');
    expect(message).not.toContain('PAID');
    expect(message).not.toContain('DHL-1001');
    expect(message).not.toContain('https://track.example.test/1001');
    expect(message).not.toContain('customer@example.test');
  });

  it('uses the existing not-found response when the app reports no order', async () => {
    mockLookupResponse({ found: false, orderNumber: '1001' });

    await processOrderInquiry();

    expect(whatsAppProvider.getLastMessage()?.body).toMatch(/couldn't find order #1001/i);
    expect(handoffNotifier.notifications).toHaveLength(0);
  });

  it('does not retry a rejected secret and hands the conversation to a human', async () => {
    mockLookupResponse({ error: 'Unauthorized' }, 401);

    await processOrderInquiry();

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(whatsAppProvider.getLastMessage()?.body).toMatch(/human support team/i);
    expect(handoffNotifier.getLastNotification()?.reason).toBe('system_error');
    const conversation = await createTenantRepository(db, TEST_TENANT_ID)
      .findConversationByCustomerPhone('+27 66 275 6217');
    expect(conversation?.status).toBe('needs_human');
  });

  it('retries server errors and hands the conversation to a human if they persist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('unavailable', { status: 503 })
    ));

    await processOrderInquiry();

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
    expect(whatsAppProvider.getLastMessage()?.body).toMatch(/human support team/i);
    expect(handoffNotifier.getLastNotification()?.reason).toBe('system_error');
  });

  it('hands the conversation to a human when the request times out', async () => {
    vi.stubGlobal('fetch', vi.fn((_input: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })
    ));

    await processOrderInquiry();

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
    expect(whatsAppProvider.getLastMessage()?.body).toMatch(/human support team/i);
    expect(handoffNotifier.getLastNotification()?.reason).toBe('system_error');
  });
});
