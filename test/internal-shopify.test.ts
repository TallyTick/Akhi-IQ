import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/api/app.js';
import { decryptAES256GCM } from '../src/crypto/aes.js';
import { shopifyInstallations } from '../src/db/schema.js';
import { createTestDb, TEST_ENCRYPTION_KEY } from './helpers/test-db.js';

const internalSecret = process.env.INTERNAL_API_SECRET!;

describe('Internal Shopify installation API', () => {
  let app: FastifyInstance;
  let db: any;
  let pglite: any;

  beforeAll(async () => {
    ({ db, pglite } = await createTestDb());
    app = await buildApp({ db });
    await app.ready();
  });

  afterAll(async () => {
    try {
      if (app) await app.close();
    } finally {
      if (pglite) await pglite.close();
    }
  });

  it('rejects a wrong internal secret', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/shopify/installations',
      headers: { 'x-internal-secret': 'wrong-internal-secret-value' },
      payload: { shop: 'secure-shop.myshopify.com', accessToken: 'shpat_secret', scopes: 'read_orders' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects an invalid shop domain', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/shopify/installations',
      headers: { 'x-internal-secret': internalSecret },
      payload: { shop: 'secure-shop.example.com', accessToken: 'shpat_secret', scopes: 'read_orders' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('stores the access token encrypted', async () => {
    const token = 'shpat_internal_test_token';
    const response = await app.inject({
      method: 'POST',
      url: '/internal/shopify/installations',
      headers: { 'x-internal-secret': internalSecret },
      payload: { shop: 'secure-shop.myshopify.com', accessToken: token, scopes: ['read_orders', 'read_products'] },
    });

    expect(response.statusCode).toBe(200);
    const [installation] = await db
      .select()
      .from(shopifyInstallations)
      .where(eq(shopifyInstallations.shopDomain, 'secure-shop.myshopify.com'))
      .limit(1);

    expect(installation).toBeDefined();
    expect(installation.accessTokenEncrypted).not.toBe(token);
    expect(decryptAES256GCM(installation.accessTokenEncrypted, TEST_ENCRYPTION_KEY)).toBe(token);
    expect(installation.scope).toBe('read_orders,read_products');
    expect(installation.status).toBe('installed');
  });

  it('removes the stored token and marks the installation uninstalled', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/internal/shopify/uninstalled',
      headers: { 'x-internal-secret': internalSecret },
      payload: { shop: 'secure-shop.myshopify.com' },
    });

    expect(response.statusCode).toBe(200);
    const [installation] = await db
      .select()
      .from(shopifyInstallations)
      .where(eq(shopifyInstallations.shopDomain, 'secure-shop.myshopify.com'))
      .limit(1);

    expect(installation.accessTokenEncrypted).toBeNull();
    expect(installation.status).toBe('uninstalled');
  });
});
