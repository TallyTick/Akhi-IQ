import { getDb, closeDb } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { createTenantRepository } from '../src/db/tenant.js';
import { merchants, whatsappNumbers, subscriptions } from '../src/db/schema.js';
import { encryptAES256GCM } from '../src/crypto/aes.js';
import { getConfig } from '../src/config/env.js';
import { defaultMockShopifyClient } from '../src/shopify/mock.js';
import { SEED_SHOP_DOMAIN, getSeedOrders } from '../src/shopify/seed-orders.js';
import { logger } from '../src/logger/index.js';
import { eq } from 'drizzle-orm';

async function seed() {
  const config = getConfig();
  const db = getDb();

  logger.info('Running database migrations to ensure all 9 tables exist...');
  await runMigrations(db);

  const merchantId = 'merchant_acme_001';
  const merchantName = 'Acme Outdoor Outfitters';
  const whatsappPhone = '+15550001111';

  logger.info({ merchantId }, 'Seeding merchant...');

  // 1. Merchant
  const existingMerchant = await db
    .select()
    .from(merchants)
    .where(eq(merchants.id, merchantId))
    .limit(1);

  if (existingMerchant.length === 0) {
    await db.insert(merchants).values({
      id: merchantId,
      name: merchantName,
    });
  }

  // 2. Tenant Repo
  const tenantRepo = createTenantRepository(db, merchantId);

  // 3. Shopify Installation with AES-256-GCM encrypted access token
  const plainToken = 'shpat_fake_live_token_for_acme_outdoor';
  const encrypted = encryptAES256GCM(plainToken, config.encryptionKeyBuffer);

  await tenantRepo.saveShopifyInstallation({
    shopDomain: SEED_SHOP_DOMAIN,
    accessTokenEncrypted: encrypted.serialized,
    scope: 'read_orders,read_fulfillments',
  });
  logger.info('Shopify installation saved with AES-256-GCM encrypted token');

  // 4. WhatsApp Number
  const existingNumber = await tenantRepo.findWhatsAppNumber(whatsappPhone);
  if (!existingNumber) {
    await db.insert(whatsappNumbers).values({
      id: 'wnum_acme_001',
      tenantId: merchantId,
      phoneNumber: whatsappPhone,
      displayName: 'Acme Official Support',
      isActive: true,
    });
    logger.info({ whatsappPhone }, 'Registered official WhatsApp business number');
  }

  if (config.LOCAL_MODE && config.LOCAL_SANDBOX_NUMBER) {
    const existingSandboxNumber = await tenantRepo.findWhatsAppNumber(config.LOCAL_SANDBOX_NUMBER);
    if (existingSandboxNumber) {
      await db
        .update(whatsappNumbers)
        .set({
          isActive: true,
          ...(config.WHATSAPP_PROVIDER === 'meta' && config.META_PHONE_NUMBER_ID
            ? { providerNumberId: config.META_PHONE_NUMBER_ID }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(whatsappNumbers.id, existingSandboxNumber.id));
    } else {
      await db.insert(whatsappNumbers).values({
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

  // 5. Subscription
  const existingSub = await tenantRepo.getSubscription();
  if (!existingSub) {
    await db.insert(subscriptions).values({
      id: 'sub_acme_001',
      tenantId: merchantId,
      plan: 'pro',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    logger.info('Created active Pro subscription');
  }

  // 6. Register fake orders into MockShopifyClient
  const orders = getSeedOrders(config.LOCAL_MODE ? config.LOCAL_TEST_CUSTOMER_PHONE : undefined);
  for (const order of orders) {
    defaultMockShopifyClient.addMockOrder(SEED_SHOP_DOMAIN, order);
  }
  logger.info({ count: orders.length }, 'Loaded fake orders into MockShopifyClient');

  logger.info('Database and mock client seeded successfully!');
  await closeDb();
}

seed().catch((err) => {
  logger.fatal({ err }, 'Seed failed');
  process.exit(1);
});
