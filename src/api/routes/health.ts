import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { checkDbHealth } from '../../db/index.js';
import { checkRedisHealth } from '../../queue/queue.js';

export function registerHealthRoutes(
  app: FastifyInstance,
  options: { db: any; redisClient?: any }
) {
  app.get('/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const [dbOk, redisOk] = await Promise.all([
      checkDbHealth(options.db),
      checkRedisHealth(options.redisClient),
    ]);

    const isHealthy = dbOk && redisOk;
    const statusCode = isHealthy ? 200 : 503;

    return reply.status(statusCode).send({
      status: isHealthy ? 'ok' : 'degraded',
      mode: process.env.LOCAL_MODE === 'true' ? 'local' : 'production',
      db: dbOk ? 'ok' : 'down',
      redis: redisOk ? 'ok' : 'down',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });
}
