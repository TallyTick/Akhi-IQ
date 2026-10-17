import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/api/app.js';
import { webhookEvents, whatsappNumbers } from '../src/db/schema.js';
import { createTestDb, resetTestDb, TEST_WHATSAPP_NUMBER } from './helpers/test-db.js';
import { MockQueue } from './helpers/mock-queue.js';
import { loadConfig } from '../src/config/env.js';
import { MetaWhatsAppProvider } from '../src/whatsapp/meta.js';

const META_APP_SECRET = 'meta-app-secret-for-tests';
const META_VERIFY_TOKEN = 'meta-verify-token-for-tests';
const META_PHONE_NUMBER_ID = 'meta-phone-number-id-123';

describe('Meta WhatsApp webhook', () => {
  let app: FastifyInstance;
  let mockQueue: MockQueue;
  let testDb: any;
  let pgliteInstance: any;

  beforeAll(async () => {
    const { db, pglite } = await createTestDb();
    testDb = db;
    pgliteInstance = pglite;
    await db
      .update(whatsappNumbers)
      .set({ providerNumberId: META_PHONE_NUMBER_ID })
      .where(eq(whatsappNumbers.phoneNumber, TEST_WHATSAPP_NUMBER));

    mockQueue = new MockQueue();
    app = await buildApp({
      db: testDb,
      queue: mockQueue as any,
      metaAppSecret: META_APP_SECRET,
      metaVerifyToken: META_VERIFY_TOKEN,
    });
    await app.ready();
  });

  afterAll(async () => {
    try {
      await app?.close();
    } finally {
      await pgliteInstance?.close();
    }
  });

  beforeEach(async () => {
    await resetTestDb(testDb);
    mockQueue.clear();
  });

  const payloadWithMessage = (id: string) => ({
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: {
            display_phone_number: '15550001111',
            phone_number_id: META_PHONE_NUMBER_ID,
          },
          messages: [{
            from: '15559998888',
            id,
            timestamp: '1700000000',
            text: { body: 'Where is my order?' },
            type: 'text',
          }],
        },
      }],
    }],
  });

  const postMetaPayload = (payload: unknown, signature?: string) => {
    const rawBody = JSON.stringify(payload);
    const validSignature = `sha256=${createHmac('sha256', META_APP_SECRET).update(rawBody).digest('hex')}`;
    return app.inject({
      method: 'POST',
      url: '/webhooks/meta/whatsapp',
      headers: {
        'content-type': 'application/json',
        ...(signature === undefined ? { 'x-hub-signature-256': validSignature } : { 'x-hub-signature-256': signature }),
      },
      payload: rawBody,
    });
  };

  it('accepts valid raw-body signatures and queues normalized text messages by registered phone number ID', async () => {
    const response = await postMetaPayload(payloadWithMessage('wamid.valid-message-1'));

    expect(response.statusCode).toBe(200);
    expect(mockQueue.jobs).toHaveLength(1);
    expect(mockQueue.jobs[0].data).toMatchObject({
      eventId: 'wamid.valid-message-1',
      whatsappMessageId: 'wamid.valid-message-1',
      from: '+15559998888',
      to: TEST_WHATSAPP_NUMBER,
      body: 'Where is my order?',
    });

    const events = await testDb.select().from(webhookEvents).where(eq(webhookEvents.eventId, 'wamid.valid-message-1'));
    expect(events).toHaveLength(1);
  });

  it('rejects an invalid signature without processing the payload', async () => {
    const response = await postMetaPayload(payloadWithMessage('wamid.invalid-signature'), 'sha256=invalid');

    expect(response.statusCode).toBe(401);
    expect(mockQueue.jobs).toHaveLength(0);
  });

  it('answers successful webhook verification with the plain-text challenge', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=${META_VERIFY_TOKEN}&hub.challenge=challenge-123`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toBe('challenge-123');
  });

  it('rejects failed webhook verification', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/webhooks/meta/whatsapp?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge-123',
    });

    expect(response.statusCode).toBe(403);
  });

  it('ignores duplicate message IDs', async () => {
    const payload = payloadWithMessage('wamid.duplicate-message');

    const first = await postMetaPayload(payload);
    const second = await postMetaPayload(payload);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(mockQueue.jobs).toHaveLength(1);
  });

  it('ignores status-only webhook payloads', async () => {
    const response = await postMetaPayload({
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: META_PHONE_NUMBER_ID },
            statuses: [{ id: 'wamid.status-only', status: 'delivered' }],
          },
        }],
      }],
    });

    expect(response.statusCode).toBe(200);
    expect(mockQueue.jobs).toHaveLength(0);
  });

  it('requires Meta settings when the Meta provider is selected', () => {
    expect(() => loadConfig({
      NODE_ENV: 'test',
      REDIS_URL: 'redis://localhost:6379',
      INTERNAL_API_SECRET: 'test-only-internal-api-secret-at-least-32-characters',
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      WHATSAPP_PROVIDER: 'meta',
    })).toThrow(/META_APP_SECRET/);
  });
});

describe('Meta WhatsApp outbound provider', () => {
  it('builds a v21.0 Cloud API text request with Bearer auth and a 10-second timeout', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: 'wamid.outbound-1' }] }), { status: 200 })
    );
    const provider = new MetaWhatsAppProvider('meta-access-token-test', META_PHONE_NUMBER_ID, fetchMock);

    const result = await provider.sendMessage('+15559998888', TEST_WHATSAPP_NUMBER, 'Hello there');

    expect(result).toEqual({ messageId: 'wamid.outbound-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://graph.facebook.com/v21.0/${META_PHONE_NUMBER_ID}/messages`);
    expect(request?.method).toBe('POST');
    expect(request?.headers).toMatchObject({
      authorization: 'Bearer meta-access-token-test',
      'content-type': 'application/json',
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      messaging_product: 'whatsapp',
      to: '15559998888',
      type: 'text',
      text: { body: 'Hello there' },
    });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not retry a 4xx response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 400 }));
    const provider = new MetaWhatsAppProvider('meta-access-token-test', META_PHONE_NUMBER_ID, fetchMock);

    await expect(
      provider.sendMessage('+15559998888', TEST_WHATSAPP_NUMBER, 'Hello there')
    ).rejects.toMatchObject({ retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx response and succeeds when Meta recovers', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: 'wamid.recovered' }] }), { status: 200 }));
    const provider = new MetaWhatsAppProvider('meta-access-token-test', META_PHONE_NUMBER_ID, fetchMock);

    await expect(
      provider.sendMessage('+15559998888', TEST_WHATSAPP_NUMBER, 'Hello there')
    ).resolves.toEqual({ messageId: 'wamid.recovered' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
