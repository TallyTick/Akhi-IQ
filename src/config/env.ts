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
  REDIS_URL: z.string().default('redis://localhost:6379'),
  WHATSAPP_WEBHOOK_SECRET: z.string().default('whsec_test_whatsapp_secret_key_12345'),
  ENCRYPTION_KEY: z.string(),
  LOG_LEVEL: z.string().default('info'),
  LOCAL_MODE: z.preprocess((val) => val === 'true' || val === true || val === '1', z.boolean()).default(false),
  PGLITE_DATA_DIR: z.string().default('./data/pglite'),
  LLM_PROVIDER: z.enum(['openai', 'anthropic', 'gemini', 'groq', 'stub', 'mock']).default('stub'),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),
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
