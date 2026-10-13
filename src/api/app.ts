import Fastify, { FastifyInstance } from 'fastify';
import fastifyRawBody from 'fastify-raw-body';
import { registerHealthRoutes } from './routes/health.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { getDb } from '../db/index.js';
import { getRedisClient, getWhatsAppQueue } from '../queue/queue.js';
import { getConfig } from '../config/env.js';
import { logger } from '../logger/index.js';

export interface AppOptions {
  db?: any;
  redisClient?: any;
  queue?: any;
  webhookSecret?: string;
  enableLogging?: boolean;
}

export async function buildApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.enableLogging ?? false,
  });

  // Enable rawBody preservation for HMAC signature checks
  await app.register(fastifyRawBody, {
    field: 'rawBody',
    global: false,
    encoding: 'utf8',
    runFirst: true,
  });

  // Native urlencoded form parser for HTML settings form
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const params = new URLSearchParams(body as string);
      const parsed: Record<string, string> = {};
      for (const [key, value] of params.entries()) {
        parsed[key] = value;
      }
      done(null, parsed);
    } catch (err: any) {
      done(err, undefined);
    }
  });

  const config = getConfig();
  const db = options.db || getDb();
  const redisClient = options.redisClient || (config.LOCAL_MODE ? undefined : getRedisClient());
  const queue = options.queue || getWhatsAppQueue();

  // Register routes
  registerHealthRoutes(app, { db, redisClient });
  registerWebhookRoutes(app, { db, queue, webhookSecret: options.webhookSecret });
  registerSettingsRoutes(app, { db });

  return app;
}
