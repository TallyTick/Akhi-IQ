import { buildApp } from './app.js';
import { getConfig } from '../config/env.js';
import { logger } from '../logger/index.js';

async function start() {
  try {
    const config = getConfig();
    const app = await buildApp({ enableLogging: true });

    await app.listen({
      port: config.PORT,
      host: config.HOST,
    });

    logger.info(`API server running at http://${config.HOST}:${config.PORT}`);

    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    for (const signal of signals) {
      process.on(signal, async () => {
        logger.info(`Received ${signal}, closing API server...`);
        await app.close();
        process.exit(0);
      });
    }
  } catch (err) {
    logger.fatal({ err }, 'Failed to start API server');
    process.exit(1);
  }
}

// Execute if run directly
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  start();
}

export { start };
