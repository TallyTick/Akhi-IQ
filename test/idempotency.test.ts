import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { createTestDb, resetTestDb, TEST_WEBHOOK_SECRET } from './helpers/test-db.js';
import { MockQueue } from './helpers/mock-queue.js';
import { computeHmacSha256 } from '../src/crypto/hmac.js';
import { webhookEvents } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import RedisMock from 'ioredis-mock';
import { FastifyInstance } from 'fastify';

describe('Webhook Idempotency & Deduplication Tests', () => {
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

  it('records event in webhook_events and enqueues on first webhook delivery', async () => {
    const eventId = 'evt_unique_101';
    const rawPayload = JSON.stringify({
      eventId,
      from: '+15559998888',
      to: '+15550001111',
      body: 'Where is my order #1001?',
    });

    const signature = computeHmacSha256(rawPayload, TEST_WEBHOOK_SECRET);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      payload: rawPayload,
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe('ok');
    expect(mockQueue.jobs.length).toBe(1);

    // Verify row was inserted into webhook_events
    const rows = await testDb
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventId, eventId));
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('received');
  });

  it('deduplicates identical eventId on subsequent deliveries without re-enqueuing', async () => {
    const eventId = 'evt_duplicate_202';
    const rawPayload = JSON.stringify({
      eventId,
      from: '+15559998888',
      to: '+15550001111',
      body: 'Where is my order #1001?',
    });

    const signature = computeHmacSha256(rawPayload, TEST_WEBHOOK_SECRET);

    // First call
    const res1 = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      payload: rawPayload,
    });

    expect(res1.statusCode).toBe(200);
    expect(mockQueue.jobs.length).toBe(1);

    // Second call with same eventId
    const res2 = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      payload: rawPayload,
    });

    expect(res2.statusCode).toBe(200);
    const json2 = JSON.parse(res2.body);
    expect(json2.deduplicated).toBe(true);

    // Job was NOT enqueued again
    expect(mockQueue.jobs.length).toBe(1);

    // Exactly one row exists in webhook_events
    const rows = await testDb
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.eventId, eventId));
    expect(rows.length).toBe(1);
  });
});
