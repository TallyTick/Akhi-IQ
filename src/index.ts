import { buildApp } from './api/app.js';
import { createInboundWorker } from './worker/worker.js';
import { getConfig } from './config/env.js';
import { getDb, initLocalDb } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { logger } from './logger/index.js';

async function main() {
  try {
    const config = getConfig();
    logger.info('Starting Akhi-IQ WhatsApp backend (API + Worker)...');

    const db = getDb();

    // Auto-migrate and seed in local mode
    if (config.LOCAL_MODE) {
      logger.info('LOCAL_MODE enabled: running auto-migrations and seeding local database...');
      await initLocalDb(db);
    } else {
      logger.info('Running database migrations...');
      await runMigrations(db);
    }

    // 1. Start Fastify API server
    const app = await buildApp({ db, enableLogging: true });
    await app.listen({
      port: config.PORT,
      host: config.HOST,
    });
    logger.info(`Fastify API listening on http://${config.HOST}:${config.PORT}`);

    // 2. Start worker (BullMQ in prod, in-memory queue in local mode)
    const worker = createInboundWorker({ db });
    logger.info(
      config.LOCAL_MODE
        ? 'In-memory worker started processing WhatsApp events (LOCAL_MODE)'
        : 'BullMQ worker started processing WhatsApp events'
    );

    const shutdown = async () => {
      logger.info('Shutting down gracefully...');
      await worker.close();
      await app.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    logger.fatal({ err }, 'Fatal error during application startup');
    process.exit(1);
  }
}

main();
