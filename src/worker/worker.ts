import { Worker, Job } from 'bullmq';
import { WHATSAPP_QUEUE_NAME, WhatsAppMessagePayload } from '../queue/types.js';
import { getRedisClient, getInMemoryWhatsAppQueue } from '../queue/queue.js';
import { getDb } from '../db/index.js';
import { getConfig } from '../config/env.js';
import { processInboundMessage } from '../conversation/processor.js';
import { ShopifyClient } from '../shopify/types.js';
import { defaultMockShopifyClient } from '../shopify/mock.js';
import { WhatsAppProvider } from '../whatsapp/provider.js';
import { defaultMockWhatsAppProvider } from '../whatsapp/mock.js';
import { OrderExtractor } from '../extractor/extractor.js';
import { defaultRegexOrderExtractor } from '../extractor/regex.js';
import { HandoffNotifier } from '../handoff/notifier.js';
import { defaultEmailHandoffStub } from '../handoff/email.js';
import { logger } from '../logger/index.js';

export interface WorkerInstance {
  close(): Promise<void>;
}

export interface WorkerDependencies {
  db?: any;
  shopifyClient?: ShopifyClient;
  whatsAppProvider?: WhatsAppProvider;
  orderExtractor?: OrderExtractor;
  handoffNotifier?: HandoffNotifier;
  encryptionKey?: Buffer;
  redisConnection?: any;
}

export function createInboundWorker(deps: WorkerDependencies = {}): WorkerInstance {
  const config = getConfig();
  const db = deps.db || getDb();
  const shopifyClient = deps.shopifyClient || defaultMockShopifyClient;
  const whatsAppProvider = deps.whatsAppProvider || defaultMockWhatsAppProvider;
  const orderExtractor = deps.orderExtractor || defaultRegexOrderExtractor;
  const handoffNotifier = deps.handoffNotifier || defaultEmailHandoffStub;
  const encryptionKey = deps.encryptionKey || config.encryptionKeyBuffer;

  if (config.LOCAL_MODE) {
    logger.info('Creating in-memory WhatsApp worker (LOCAL_MODE active)');
    const memQueue = getInMemoryWhatsAppQueue();

    memQueue.process(async (job) => {
      logger.info({ jobId: job.id, eventId: job.data.eventId }, 'Worker picked up WhatsApp message job');

      await processInboundMessage({
        eventId: job.data.eventId,
        from: job.data.from,
        to: job.data.to,
        body: job.data.body,
        whatsappMessageId: job.data.whatsappMessageId,
        db,
        shopifyClient,
        whatsAppProvider,
        orderExtractor,
        handoffNotifier,
        encryptionKey,
      });

      logger.info({ jobId: job.id, eventId: job.data.eventId }, 'Worker completed WhatsApp message job');
    });

    return {
      close: async () => {
        await memQueue.close();
      },
    };
  }

  const connection = deps.redisConnection || getRedisClient();

  const worker = new Worker<WhatsAppMessagePayload>(
    WHATSAPP_QUEUE_NAME,
    async (job: Job<WhatsAppMessagePayload>) => {
      logger.info({ jobId: job.id, eventId: job.data.eventId }, 'Worker picked up WhatsApp message job');

      await processInboundMessage({
        eventId: job.data.eventId,
        from: job.data.from,
        to: job.data.to,
        body: job.data.body,
        whatsappMessageId: job.data.whatsappMessageId,
        db,
        shopifyClient,
        whatsAppProvider,
        orderExtractor,
        handoffNotifier,
        encryptionKey,
      });

      logger.info({ jobId: job.id, eventId: job.data.eventId }, 'Worker completed WhatsApp message job');
    },
    {
      connection,
      concurrency: 5,
    }
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'Worker job failed');
  });

  return worker;
}
