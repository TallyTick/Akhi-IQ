import { logger } from '../logger/index.js';

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  name?: string;
  shouldRetry?: (error: unknown) => boolean;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 100;
  const maxDelayMs = options.maxDelayMs ?? 2000;
  const backoffFactor = options.backoffFactor ?? 2;
  const name = options.name ?? 'Operation';

  let attempt = 0;
  let delay = initialDelayMs;

  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      if (options.shouldRetry && !options.shouldRetry(err)) {
        throw err;
      }
      if (attempt > maxRetries) {
        logger.error({ name, attempt, maxRetries, err: err?.message }, `${name} failed after maximum retry attempts`);
        throw err;
      }

      // Add small jitter
      const jitter = Math.random() * 50;
      const waitTime = Math.min(delay + jitter, maxDelayMs);

      logger.warn(
        { name, attempt, nextRetryInMs: Math.round(waitTime), err: err?.message },
        `${name} attempt failed; retrying with backoff`
      );

      await new Promise((resolve) => setTimeout(resolve, waitTime));
      delay *= backoffFactor;
    }
  }
}
