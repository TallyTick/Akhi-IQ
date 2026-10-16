import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      DOTENV_CONFIG_PATH: 'test/.env.test',
      LOCAL_MODE: 'false',
      SHOPIFY_MODE: 'mock',
      SHOPIFY_SHOP_DOMAIN: 'acme-store.myshopify.com',
      WHATSAPP_PROVIDER: 'mock',
      WHATSAPP_WEBHOOK_SECRET: 'test-only-whatsapp-webhook-secret',
      ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      INTERNAL_API_SECRET: 'test-only-internal-api-secret-at-least-32-characters',
      REDIS_URL: 'redis://127.0.0.1:6379',
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
      LOG_LEVEL: 'silent',
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    maxWorkers: 1,
    setupFiles: ['test/setup.ts'],
    include: ['test/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
  },
});
