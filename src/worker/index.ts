import { createInboundWorker } from './worker.js';
import { logger } from '../logger/index.js';

async function start() {
  try {
    const worker = createInboundWorker();
    logger.info('BullMQ WhatsApp worker started and waiting for jobs...');

    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    for (const signal of signals) {
      process.on(signal, async () => {
        logger.info(`Received ${signal}, closing worker...`);
        await worker.close();
        process.exit(0);
      });
    }
  } catch (err) {
    logger.fatal({ err }, 'Failed to start BullMQ worker');
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  start();
}

export { start };
