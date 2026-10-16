import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import RedisMock from 'ioredis-mock';
import { buildApp } from '../src/api/app.js';
import { computeTwilioSignature } from '../src/api/routes/webhooks.js';
import { createTestDb, resetTestDb } from './helpers/test-db.js';
import { MockQueue } from './helpers/mock-queue.js';
import { TwilioWhatsAppProvider } from '../src/whatsapp/twilio.js';

const TWILIO_AUTH_TOKEN = 'twilio-auth-token-for-tests';
const PUBLIC_BASE_URL = 'https://messages.example.com';
const TWILIO_WEBHOOK_URL = `${PUBLIC_BASE_URL}/webhooks/twilio/whatsapp`;

describe('Twilio WhatsApp integration', () => {
  let app: FastifyInstance;
  let mockQueue: MockQueue;
  let testDb: any;
  let pgliteInstance: any;

  beforeAll(async () => {
    const { db, pglite } = await createTestDb();
    testDb = db;
    pgliteInstance = pglite;
    mockQueue = new MockQueue();
    app = await buildApp({
      db: testDb,
      redisClient: new RedisMock(),
      queue: mockQueue as any,
      twilioAuthToken: TWILIO_AUTH_TOKEN,
      publicBaseUrl: PUBLIC_BASE_URL,
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

  const postTwilioMessage = (parameters: Record<string, string>, signature?: string) =>
    app.inject({
      method: 'POST',
      url: '/webhooks/twilio/whatsapp',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...(signature ? { 'x-twilio-signature': signature } : {}),
      },
      payload: new URLSearchParams(parameters).toString(),
    });

  const validParameters = (messageSid: string) => ({
    Body: 'Where is my order?',
    From: 'whatsapp:+15559998888',
    MessageSid: messageSid,
    To: 'whatsapp:+15550001111',
  });

  it('accepts a valid Twilio signature and queues the normalized inbound payload', async () => {
    const parameters = validParameters('SMvalid123');
    const signature = computeTwilioSignature(TWILIO_WEBHOOK_URL, parameters, TWILIO_AUTH_TOKEN);

    const response = await postTwilioMessage(parameters, signature);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('<Response></Response>');
    expect(mockQueue.jobs).toHaveLength(1);
    expect(mockQueue.jobs[0].data).toMatchObject({
      eventId: 'SMvalid123',
      whatsappMessageId: 'SMvalid123',
      from: '+15559998888',
      to: '+15550001111',
      body: 'Where is my order?',
    });
  });

  it('rejects a tampered form body', async () => {
    const signedParameters = validParameters('SMtampered123');
    const signature = computeTwilioSignature(TWILIO_WEBHOOK_URL, signedParameters, TWILIO_AUTH_TOKEN);
    const tamperedParameters = { ...signedParameters, Body: 'Changed after signing' };

    const response = await postTwilioMessage(tamperedParameters, signature);

    expect(response.statusCode).toBe(403);
    expect(mockQueue.jobs).toHaveLength(0);
  });

  it('rejects a signature created with the wrong token', async () => {
    const parameters = validParameters('SMwrongtoken123');
    const signature = computeTwilioSignature(TWILIO_WEBHOOK_URL, parameters, 'wrong-auth-token');

    const response = await postTwilioMessage(parameters, signature);

    expect(response.statusCode).toBe(403);
    expect(mockQueue.jobs).toHaveLength(0);
  });

  it('does not process the same MessageSid twice', async () => {
    const parameters = validParameters('SMduplicate123');
    const signature = computeTwilioSignature(TWILIO_WEBHOOK_URL, parameters, TWILIO_AUTH_TOKEN);

    const first = await postTwilioMessage(parameters, signature);
    const second = await postTwilioMessage(parameters, signature);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(mockQueue.jobs).toHaveLength(1);
  });
});

describe('Twilio WhatsApp outbound provider', () => {
  it('builds the Twilio request with Basic auth and a form-encoded body', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ sid: 'SMoutbound123' }), { status: 201 })
    );
    const provider = new TwilioWhatsAppProvider(
      'AC123456',
      'auth-secret',
      '+15550001111',
      fetchMock
    );

    const result = await provider.sendMessage('+15559998888', '+15550001111', 'Hello there');

    expect(result).toEqual({ messageId: 'SMoutbound123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123456/Messages.json');
    expect(request?.method).toBe('POST');
    expect(request?.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('AC123456:auth-secret').toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
    expect(new URLSearchParams(String(request?.body))).toEqual(
      new URLSearchParams({
        From: 'whatsapp:+15550001111',
        To: 'whatsapp:+15559998888',
        Body: 'Hello there',
      })
    );
  });

  it('does not retry a 4xx response', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('', { status: 400 })
    );
    const provider = new TwilioWhatsAppProvider(
      'AC123456',
      'auth-secret',
      '+15550001111',
      fetchMock
    );

    await expect(
      provider.sendMessage('+15559998888', '+15550001111', 'Hello there')
    ).rejects.toMatchObject({ retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx response and succeeds when Twilio recovers', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ sid: 'SMrecovered123' }), { status: 201 }));
    const provider = new TwilioWhatsAppProvider(
      'AC123456',
      'auth-secret',
      '+15550001111',
      fetchMock
    );

    await expect(
      provider.sendMessage('+15559998888', '+15550001111', 'Hello there')
    ).resolves.toEqual({ messageId: 'SMrecovered123' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
