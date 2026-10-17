import pg from 'pg';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { sql, eq, and } from 'drizzle-orm';
import fs from 'node:fs';
import * as schema from './schema.js';
import { getConfig } from '../config/env.js';
import { runMigrations } from './migrate.js';
import { createTenantRepository } from './tenant.js';
import { encryptAES256GCM } from '../crypto/aes.js';
import { defaultMockShopifyClient } from '../shopify/mock.js';
import { getSeedOrders } from '../shopify/seed-orders.js';
import { logger } from '../logger/index.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let pgliteInstance: PGlite | null = null;
let dbInstance: any = null;

export function getPool(connectionString?: string): pg.Pool {
  if (!pool) {
    const config = getConfig();
    pool = new Pool({
      connectionString: connectionString || config.DATABASE_URL,
    });
  }
  return pool;
}

export function getDb(customPool?: pg.Pool) {
  if (customPool) {
    return drizzlePg(customPool, { schema });
  }

  if (dbInstance) {
    return dbInstance;
  }

  const config = getConfig();

  if (config.LOCAL_MODE) {
    logger.info({ dataDir: config.PGLITE_DATA_DIR }, 'Starting database in LOCAL_MODE using embedded PGlite');
    fs.mkdirSync(config.PGLITE_DATA_DIR, { recursive: true });
    pgliteInstance = new PGlite(config.PGLITE_DATA_DIR);
    dbInstance = drizzlePglite(pgliteInstance, { schema });
    return dbInstance;
  }

  const activePool = getPool();
  dbInstance = drizzlePg(activePool, { schema });
  return dbInstance;
}

export async function checkDbHealth(db: any): Promise<boolean> {
  try {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Database health check timed out')), 3000);
    });
    let result: unknown;
    try {
      result = await Promise.race([db.execute(sql`SELECT 1 as alive`), timeout]);
    } finally {
      clearTimeout(timeoutId!);
    }
    return Boolean(result);
  } catch (err) {
    return false;
  }
}

export async function initLocalDb(db: any) {
  const config = getConfig();
  logger.info('Initializing local database migrations...');
  await runMigrations(db);

  const merchantId = 'merchant_acme_001';
  const existing = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.id, merchantId))
    .limit(1);

  if (existing.length === 0) {
    logger.info({ merchantId }, 'Seeding default local merchant and credentials...');
    await db.insert(schema.merchants).values({
      id: merchantId,
      name: 'Acme Outdoor Outfitters',
    });

    const tenantRepo = createTenantRepository(db, merchantId);
    const encrypted = encryptAES256GCM('shpat_fake_live_token_for_acme_outdoor', config.encryptionKeyBuffer);

    await tenantRepo.saveShopifyInstallation({
      shopDomain: config.SHOPIFY_SHOP_DOMAIN,
      accessTokenEncrypted: encrypted.serialized,
      scope: 'read_orders,read_fulfillments',
    });

    await db.insert(schema.whatsappNumbers).values({
      id: 'wnum_acme_001',
      tenantId: merchantId,
      phoneNumber: '+15550001111',
      displayName: 'Acme Official Support',
      isActive: true,
    });

    await db.insert(schema.subscriptions).values({
      id: 'sub_acme_001',
      tenantId: merchantId,
      plan: 'pro',
      status: 'active',
    });
  }

  if (config.LOCAL_MODE && config.LOCAL_SANDBOX_NUMBER) {
    const existingSandboxNumber = await db
      .select()
      .from(schema.whatsappNumbers)
      .where(and(
        eq(schema.whatsappNumbers.tenantId, merchantId),
        eq(schema.whatsappNumbers.phoneNumber, config.LOCAL_SANDBOX_NUMBER)
      ))
      .limit(1);

    if (existingSandboxNumber.length > 0) {
      await db
        .update(schema.whatsappNumbers)
        .set({
          isActive: true,
          ...(config.WHATSAPP_PROVIDER === 'meta' && config.META_PHONE_NUMBER_ID
            ? { providerNumberId: config.META_PHONE_NUMBER_ID }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.whatsappNumbers.id, existingSandboxNumber[0].id));
    } else {
      await db.insert(schema.whatsappNumbers).values({
        id: `wnum_local_${merchantId}_${config.LOCAL_SANDBOX_NUMBER.replace(/\D/g, '')}`,
        tenantId: merchantId,
        phoneNumber: config.LOCAL_SANDBOX_NUMBER,
        ...(config.WHATSAPP_PROVIDER === 'meta' && config.META_PHONE_NUMBER_ID
          ? { providerNumberId: config.META_PHONE_NUMBER_ID }
          : {}),
        displayName: 'Acme Official Support',
        isActive: true,
      });
    }
  }

  // Populate mock orders in MockShopifyClient
  const orders = getSeedOrders(config.LOCAL_MODE ? config.LOCAL_TEST_CUSTOMER_PHONE : undefined);
  for (const order of orders) {
    defaultMockShopifyClient.addMockOrder(config.SHOPIFY_SHOP_DOMAIN, order);
  }
  logger.info({ count: orders.length }, 'Loaded fake orders into MockShopifyClient');
}

export async function closeDb() {
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (pgliteInstance) {
    await pgliteInstance.close();
    pgliteInstance = null;
  }
  dbInstance = null;
}
