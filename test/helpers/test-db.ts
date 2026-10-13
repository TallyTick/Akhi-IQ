import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../../src/db/schema.js';
import { runMigrations } from '../../src/db/migrate.js';
import { encryptAES256GCM } from '../../src/crypto/aes.js';
import { SEED_SHOP_DOMAIN } from '../../src/shopify/seed-orders.js';

export const TEST_TENANT_ID = 'tenant_test_001';
export const TEST_WHATSAPP_NUMBER = '+15550001111';
export const TEST_ENCRYPTION_KEY = Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex');
export const TEST_WEBHOOK_SECRET = 'whsec_test_secret_key_999';

export async function createTestDb() {
  const pglite = new PGlite();
  const db = drizzle(pglite, { schema });

  // Run schema migration DDL
  await runMigrations(db);

  // Seed test merchant
  await db.insert(schema.merchants).values({
    id: TEST_TENANT_ID,
    name: 'Test Merchant Store',
  });

  // Seed encrypted Shopify installation
  const encryptedToken = encryptAES256GCM('shpat_test_token_secret', TEST_ENCRYPTION_KEY);
  await db.insert(schema.shopifyInstallations).values({
    id: 'shopify_inst_001',
    tenantId: TEST_TENANT_ID,
    shopDomain: SEED_SHOP_DOMAIN,
    accessTokenEncrypted: encryptedToken.serialized,
    scope: 'read_orders,read_fulfillments',
  });

  // Seed WhatsApp business number
  await db.insert(schema.whatsappNumbers).values({
    id: 'wnum_001',
    tenantId: TEST_TENANT_ID,
    phoneNumber: TEST_WHATSAPP_NUMBER,
    displayName: 'Test WhatsApp Business',
    isActive: true,
  });

  // Seed subscription
  await db.insert(schema.subscriptions).values({
    id: 'sub_001',
    tenantId: TEST_TENANT_ID,
    plan: 'pro',
    status: 'active',
  });

  return { db, pglite };
}

export async function resetTestDb(db: any) {
  await db.delete(schema.handoffs);
  await db.delete(schema.messages);
  await db.delete(schema.conversations);
  await db.delete(schema.webhookEvents);
  await db.delete(schema.usage);
}
