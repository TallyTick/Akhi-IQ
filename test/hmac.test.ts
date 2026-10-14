import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { createTestDb, resetTestDb, TEST_WEBHOOK_SECRET } from './helpers/test-db.js';
import { MockQueue } from './helpers/mock-queue.js';
import { computeHmacSha256 } from '../src/crypto/hmac.js';
import RedisMock from 'ioredis-mock';
import { FastifyInstance } from 'fastify';

describe('HMAC Verification & Rejection Tests', () => {
  let app: FastifyInstance;
  let mockQueue: MockQueue;
  let testDb: any;
  let pgliteInstance: any;
  let redisMock: any;

  beforeAll(async () => {
    const { db, pglite } = await createTestDb();
    testDb = db;
    pgliteInstance = pglite;
    mockQueue = new MockQueue();
    redisMock = new RedisMock();

    app = await buildApp({
      db: testDb,
      redisClient: redisMock,
      queue: mockQueue as any,
      webhookSecret: TEST_WEBHOOK_SECRET,
    });
    await app.ready();
  });

  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      if (pgliteInstance) await pgliteInstance.close();
    }
  });

  beforeEach(async () => {
    await resetTestDb(testDb);
    mockQueue.clear();
  });

  it('rejects with 401 when signature header is missing completely', async () => {
    const payload = {
      eventId: 'evt_hmac_test_1',
      from: '+15559998888',
      to: '+15550001111',
      body: 'Where is my order #1001?',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
      },
      payload,
    });

    expect(res.statusCode).toBe(401);
    const json = JSON.parse(res.body);
    expect(json.error).toMatch(/Invalid HMAC signature/i);
    expect(mockQueue.jobs.length).toBe(0);
  });

  it('rejects with 401 when signature is invalid or forged', async () => {
    const payload = {
      eventId: 'evt_hmac_test_2',
      from: '+15559998888',
      to: '+15550001111',
      body: 'Where is my order #1001?',
    };

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000',
      },
      payload,
    });

    expect(res.statusCode).toBe(401);
    expect(mockQueue.jobs.length).toBe(0);
  });

  it('rejects with 401 when signature was computed with a different secret', async () => {
    const payload = JSON.stringify({
      eventId: 'evt_hmac_test_3',
      from: '+15559998888',
      to: '+15550001111',
      body: 'Where is my order #1001?',
    });

    const wrongSignature = computeHmacSha256(payload, 'wrong_secret_key');

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${wrongSignature}`,
      },
      payload,
    });

    expect(res.statusCode).toBe(401);
    expect(mockQueue.jobs.length).toBe(0);
  });

  it('accepts with 200 when signature is valid and computed with correct secret', async () => {
    const payload = JSON.stringify({
      eventId: 'evt_hmac_test_4',
      from: '+15559998888',
      to: '+15550001111',
      body: 'Where is my order #1001?',
    });

    const validSignature = computeHmacSha256(payload, TEST_WEBHOOK_SECRET);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${validSignature}`,
      },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe('ok');
    expect(json.eventId).toBe('evt_hmac_test_4');
    expect(mockQueue.jobs.length).toBe(1);
    expect(mockQueue.jobs[0].data.eventId).toBe('evt_hmac_test_4');
  });
});
