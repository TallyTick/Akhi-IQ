import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { createTestDb } from './helpers/test-db.js';
import RedisMock from 'ioredis-mock';
import { FastifyInstance } from 'fastify';

describe('Health Check Route Tests (/health)', () => {
  let app: FastifyInstance;
  let testDb: any;
  let pgliteInstance: any;
  let redisMock: any;

  beforeAll(async () => {
    const { db, pglite } = await createTestDb();
    testDb = db;
    pgliteInstance = pglite;
    redisMock = new RedisMock();

    const mockQueue = { add: async () => ({ id: '1' }), close: async () => {} };
    app = await buildApp({
      db: testDb,
      redisClient: redisMock,
      queue: mockQueue as any,
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (pgliteInstance) {
      await pgliteInstance.close();
    }
  });

  it('returns 200 with status ok and checks both db and redis', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.status).toBe('ok');
    expect(json.db).toBe('ok');
    expect(json.redis).toBe('ok');
    expect(json.uptime).toBeGreaterThanOrEqual(0);
  });

  it('returns 503 degraded when redis ping fails', async () => {
    // Failing redis mock
    const failingRedis = {
      ping: async () => {
        throw new Error('Connection refused');
      },
    };

    const mockQueue = { add: async () => ({ id: '1' }), close: async () => {} };
    const failingApp = await buildApp({
      db: testDb,
      redisClient: failingRedis as any,
      queue: mockQueue as any,
    });
    await failingApp.ready();

    const res = await failingApp.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(503);
    const json = JSON.parse(res.body);
    expect(json.status).toBe('degraded');
    expect(json.redis).toBe('down');
    expect(json.db).toBe('ok');

    await failingApp.close();
  });
});
