import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { getConfig } from '../config/env.js';
import { WHATSAPP_QUEUE_NAME, WhatsAppMessagePayload } from './types.js';
import { logger } from '../logger/index.js';

export type JobHandler = (job: { id: string; data: WhatsAppMessagePayload }) => Promise<void>;

export class InMemoryWhatsAppQueue {
  private handlers: JobHandler[] = [];
  private closed = false;

  async add(name: string, data: WhatsAppMessagePayload, opts?: { jobId?: string }) {
    if (this.closed) throw new Error('Queue is closed');
    const jobId = opts?.jobId || data.eventId;

    // Dispatch asynchronously to registered handlers
    setImmediate(async () => {
      for (const handler of this.handlers) {
        try {
          await handler({ id: jobId, data });
        } catch (err) {
          logger.error({ jobId, err }, '[InMemoryQueue] Job handler failed');
        }
      }
    });

    return { id: jobId };
  }

  process(handler: JobHandler) {
    this.handlers.push(handler);
  }

  async close() {
    this.closed = true;
    this.handlers = [];
  }
}

let redisClient: Redis | null = null;
let bullmqQueue: Queue<WhatsAppMessagePayload> | null = null;
let inMemoryQueue: InMemoryWhatsAppQueue | null = null;

export function getInMemoryWhatsAppQueue(): InMemoryWhatsAppQueue {
  if (!inMemoryQueue) {
    inMemoryQueue = new InMemoryWhatsAppQueue();
  }
  return inMemoryQueue;
}

export function getRedisClient(customUrl?: string): Redis {
  if (!redisClient) {
    const config = getConfig();
    const url = customUrl || config.REDIS_URL;
    redisClient = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    redisClient.on('error', (err) => {
      logger.error({ err }, 'Redis connection error');
    });
  }
  return redisClient;
}

export function getWhatsAppQueue(customConnection?: any): Queue<WhatsAppMessagePayload> | InMemoryWhatsAppQueue {
  const config = getConfig();
  if (config.LOCAL_MODE) {
    return getInMemoryWhatsAppQueue();
  }

  if (!bullmqQueue) {
    const connection = customConnection || getRedisClient();
    bullmqQueue = new Queue<WhatsAppMessagePayload>(WHATSAPP_QUEUE_NAME, {
      connection,
    });
  }
  return bullmqQueue;
}

export async function enqueueWhatsAppMessage(
  payload: WhatsAppMessagePayload,
  queue?: Queue<WhatsAppMessagePayload> | InMemoryWhatsAppQueue
): Promise<string> {
  const targetQueue = queue || getWhatsAppQueue();
  const job = await (targetQueue as any).add('process-inbound-whatsapp', payload, {
    jobId: payload.eventId,
    removeOnComplete: 1000,
    removeOnFail: 1000,
  });
  return job.id || payload.eventId;
}

export async function checkRedisHealth(client?: Redis): Promise<boolean> {
  const config = getConfig();
  if (config.LOCAL_MODE) {
    return true; // Local in-memory queue mode is always healthy
  }

  try {
    const redis = client || getRedisClient();
    const res = await redis.ping();
    return res === 'PONG';
  } catch (err) {
    return false;
  }
}

export async function closeQueue() {
  if (inMemoryQueue) {
    await inMemoryQueue.close();
    inMemoryQueue = null;
  }
  if (bullmqQueue) {
    await bullmqQueue.close();
    bullmqQueue = null;
  }
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
