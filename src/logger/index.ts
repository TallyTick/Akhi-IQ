import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function createTenantLogger(tenantId: string, additionalContext?: Record<string, unknown>) {
  return logger.child({
    tenantId,
    ...additionalContext,
  });
}
