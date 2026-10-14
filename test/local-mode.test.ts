import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { createInboundWorker } from '../src/worker/worker.js';
import { enqueueWhatsAppMessage, getInMemoryWhatsAppQueue, checkRedisHealth } from '../src/queue/queue.js';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../src/db/schema.js';
import { initLocalDb } from '../src/db/index.js';
import { createTenantRepository } from '../src/db/tenant.js';
import { MockWhatsAppProvider } from '../src/whatsapp/mock.js';
import { MockShopifyClient } from '../src/shopify/mock.js';
import { SEED_SHOP_DOMAIN, SEED_ORDERS } from '../src/shopify/seed-orders.js';
import { TEST_ENCRYPTION_KEY, TEST_WEBHOOK_SECRET } from './helpers/test-db.js';
import { computeHmacSha256 } from '../src/crypto/hmac.js';
import { FastifyInstance } from 'fastify';

describe('LOCAL_MODE Zero-Dependency Integration Tests', () => {
  let app: FastifyInstance;
  let testDb: any;
  let pgliteInstance: PGlite;
  let whatsAppProvider: MockWhatsAppProvider;
  let shopifyClient: MockShopifyClient;
  let worker: any;

  beforeAll(async () => {
    // Set LOCAL_MODE in process.env
    process.env.LOCAL_MODE = 'true';

    pgliteInstance = new PGlite();
    testDb = drizzle(pgliteInstance, { schema });

    // 1. Auto-migration and seed
    await initLocalDb(testDb);

    // Mock clients
    whatsAppProvider = new MockWhatsAppProvider();
    shopifyClient = new MockShopifyClient();
    for (const order of SEED_ORDERS) {
      shopifyClient.addMockOrder(SEED_SHOP_DOMAIN, order);
    }

    // 2. Build Fastify app with in-memory queue
    const memQueue = getInMemoryWhatsAppQueue();
    app = await buildApp({
      db: testDb,
      queue: memQueue,
      webhookSecret: TEST_WEBHOOK_SECRET,
    });
    await app.ready();

    // 3. Worker using local in-memory queue
    worker = createInboundWorker({
      db: testDb,
      shopifyClient,
      whatsAppProvider,
      encryptionKey: TEST_ENCRYPTION_KEY,
    });
  });

  afterAll(async () => {
    delete process.env.LOCAL_MODE;
    try {
      if (worker) await worker.close();
    } finally {
      try {
        if (app) await app.close();
      } finally {
        if (pgliteInstance) await pgliteInstance.close();
      }
    }
  });

  it('/health returns 200 ok with mode local and healthy db and redis in local mode', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.mode).toBe('local');
    expect(body.db).toBe('ok');
    expect(body.redis).toBe('ok');
  });

  it('runs complete end-to-end webhook and worker processing locally without Redis or external Postgres', async () => {
    const senderPhone = '+15559998888';
    const payload = JSON.stringify({
      eventId: 'evt_local_e2e_1',
      from: senderPhone,
      to: '+15550001111',
      body: 'Where is my order #1001?',
    });

    const signature = computeHmacSha256(payload, TEST_WEBHOOK_SECRET);

    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe('ok');

    // Wait for setImmediate in-memory queue worker execution
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify WhatsApp reply was dispatched by worker
    const lastMsg = whatsAppProvider.getLastMessage();
    expect(lastMsg).toBeDefined();
    expect(lastMsg?.body).toContain('Order #1001 Status: Delivered');
    expect(lastMsg?.body).toContain('https://track.carrier.com/1001');

    // Verify database record in PGlite
    const tenantRepo = createTenantRepository(testDb, 'merchant_acme_001');
    const conv = await tenantRepo.findConversationByCustomerPhone(senderPhone);
    expect(conv).toBeDefined();
    expect(conv?.verifiedOrderId).toBe('gid://shopify/Order/1001');
  });
});
