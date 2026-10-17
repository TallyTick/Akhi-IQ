import 'dotenv/config';
import { z } from 'zod';

export function parseEncryptionKey(rawKey: string | undefined): Buffer {
  if (!rawKey) {
    throw new Error('Config fatal error: ENCRYPTION_KEY is required and must be exactly 32 bytes (256 bits).');
  }

  // Check if it's a 64-char hex string
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    const buf = Buffer.from(rawKey, 'hex');
    if (buf.length === 32) {
      return buf;
    }
  }

  // Check if raw string is 32 bytes
  const buf = Buffer.from(rawKey, 'utf8');
  if (buf.length === 32) {
    return buf;
  }

  throw new Error(
    `Config fatal error: ENCRYPTION_KEY must be exactly 32 bytes (256 bits). Received key of ${buf.length} bytes. Provide either 64 hex characters or a 32-character UTF-8 string.`
  );
}

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().default('postgresql://akhi_user:akhi_password@localhost:5432/akhi_db'),
  REDIS_URL: z.string().min(1),
  WHATSAPP_WEBHOOK_SECRET: z.string().default('whsec_test_whatsapp_secret_key_12345'),
  WHATSAPP_PROVIDER: z.enum(['mock', 'twilio', 'meta']).default('mock'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  PUBLIC_BASE_URL: z.string().url().optional(),
  META_APP_SECRET: z.string().optional(),
  META_ACCESS_TOKEN: z.string().optional(),
  META_PHONE_NUMBER_ID: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  EMAIL_PROVIDER: z.enum(['stub', 'resend']).default('stub'),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  INTERNAL_API_SECRET: z.string().min(32),
  SHOPIFY_MODE: z.enum(['mock', 'app']).default('mock'),
  SHOPIFY_APP_URL: z.string().url().optional(),
  SHOPIFY_SHOP_DOMAIN: z.string().default('acme-store.myshopify.com'),
  ENCRYPTION_KEY: z.string(),
  LOG_LEVEL: z.string().default('info'),
  LOCAL_MODE: z.preprocess((val) => val === 'true' || val === true || val === '1', z.boolean()).default(false),
  LOCAL_SANDBOX_NUMBER: z.string().optional(),
  LOCAL_TEST_CUSTOMER_PHONE: z.string().optional(),
  PGLITE_DATA_DIR: z.string().default('./data/pglite'),
  LLM_PROVIDER: z.enum(['openai', 'anthropic', 'gemini', 'groq', 'stub', 'mock']).default('stub'),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
}).superRefine((config, context) => {
  if (config.SHOPIFY_MODE === 'app' && !config.SHOPIFY_APP_URL) {
    context.addIssue({
      code: 'custom',
      path: ['SHOPIFY_APP_URL'],
      message: 'SHOPIFY_APP_URL is required when SHOPIFY_MODE is "app"',
    });
  }
  if (config.LOCAL_MODE) {
    for (const key of ['LOCAL_SANDBOX_NUMBER', 'LOCAL_TEST_CUSTOMER_PHONE'] as const) {
      const phoneNumber = config[key];
      if (phoneNumber !== undefined && !/^\+[1-9]\d{1,14}$/.test(phoneNumber)) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} must be a valid E.164 phone number`,
        });
      }
    }
  }
  if (config.WHATSAPP_PROVIDER === 'twilio') {
    for (const key of [
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_WHATSAPP_FROM',
      'PUBLIC_BASE_URL',
    ] as const) {
      if (!config[key]?.trim()) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when WHATSAPP_PROVIDER is "twilio"`,
        });
      }
    }
  }
  if (config.WHATSAPP_PROVIDER === 'meta') {
    for (const key of [
      'META_APP_SECRET',
      'META_ACCESS_TOKEN',
      'META_PHONE_NUMBER_ID',
      'META_VERIFY_TOKEN',
    ] as const) {
      if (!config[key]?.trim()) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when WHATSAPP_PROVIDER is "meta"`,
        });
      }
    }
  }
  if (config.EMAIL_PROVIDER === 'resend') {
    for (const key of ['RESEND_API_KEY', 'EMAIL_FROM'] as const) {
      if (!config[key]?.trim()) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required when EMAIL_PROVIDER is "resend"`,
        });
      }
    }
  }
});

export function loadConfig(customEnv?: Record<string, string | undefined>) {
  const envSource = customEnv || process.env;
  const parsed = envSchema.safeParse(envSource);

  if (!parsed.success) {
    throw new Error(`Config validation failed: ${JSON.stringify(parsed.error.issues, null, 2)}`);
  }

  // Enforce valid 32-byte encryption key
  const encryptionKeyBuffer = parseEncryptionKey(parsed.data.ENCRYPTION_KEY);

  return {
    ...parsed.data,
    encryptionKeyBuffer,
  };
}

// Lazy-loaded or default singleton config for app execution
let currentConfig: ReturnType<typeof loadConfig> | null = null;

export function getConfig() {
  if (!currentConfig) {
    currentConfig = loadConfig();
  }
  return currentConfig;
}
