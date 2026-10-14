import { getConfig } from '../config/env.js';
import { ShopifyAppProxyClient } from './app-proxy.js';
import { defaultMockShopifyClient } from './mock.js';
import { ShopifyClient } from './types.js';

export function createShopifyClient(): ShopifyClient {
  const config = getConfig();
  if (config.SHOPIFY_MODE === 'app') {
    return new ShopifyAppProxyClient(config.SHOPIFY_APP_URL!, config.INTERNAL_API_SECRET);
  }

  return defaultMockShopifyClient;
}
