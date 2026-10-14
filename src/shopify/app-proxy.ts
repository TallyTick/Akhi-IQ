import { z } from 'zod';
import { ShopifyClient, ShopifyOrder } from './types.js';

const lookupResponseSchema = z.object({
  found: z.boolean(),
  orderNumber: z.union([z.string(), z.number()]).optional(),
  financialStatus: z.string().nullable().optional(),
  fulfillmentStatus: z.string().nullable().optional(),
  cancelled: z.boolean().optional(),
  trackingCompany: z.string().nullable().optional(),
  trackingNumber: z.string().nullable().optional(),
  trackingUrl: z.string().nullable().optional(),
  phones: z.array(z.string()).nullable().optional(),
  email: z.string().nullable().optional(),
});

export class ShopifyAppProxyError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = 'ShopifyAppProxyError';
  }
}

export class ShopifyAppProxyClient implements ShopifyClient {
  private readonly lookupUrl: string;

  constructor(
    appUrl: string,
    private readonly internalSecret: string,
    private readonly timeoutMs = 5000
  ) {
    this.lookupUrl = new URL(`${appUrl.replace(/\/+$/, '')}/internal/orders/lookup`).toString();
  }

  async getOrder(shopDomain: string, _accessToken: string, orderNumber: string): Promise<ShopifyOrder | null> {
    let response: Response;
    try {
      response = await fetch(this.lookupUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-secret': this.internalSecret,
        },
        body: JSON.stringify({ shop: shopDomain, orderNumber }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ShopifyAppProxyError('Shopify app order lookup network request failed', true);
    }

    if (response.status >= 500) {
      throw new ShopifyAppProxyError(`Shopify app order lookup failed (${response.status})`, true);
    }
    if (!response.ok) {
      throw new ShopifyAppProxyError(`Shopify app order lookup rejected (${response.status})`, false);
    }

    let result: z.infer<typeof lookupResponseSchema>;
    try {
      result = lookupResponseSchema.parse(await response.json());
    } catch {
      throw new ShopifyAppProxyError('Shopify app order lookup returned an invalid response', false);
    }

    if (!result.found) return null;

    const mappedOrderNumber = String(result.orderNumber ?? orderNumber).replace(/^#/, '').trim();
    const fulfillmentStatus = result.fulfillmentStatus || 'UNFULFILLED';
    return {
      id: `gid://shopify/Order/${mappedOrderNumber}`,
      name: `#${mappedOrderNumber}`,
      orderNumber: mappedOrderNumber,
      customerPhone: result.phones?.[0] ?? null,
      phones: result.phones ?? [],
      customerEmail: result.email ?? null,
      financialStatus: result.financialStatus || 'UNKNOWN',
      fulfillmentStatus,
      displayStatus: getDisplayStatus(fulfillmentStatus, result.cancelled ?? false),
      cancelled: result.cancelled ?? false,
      trackingCompany: result.trackingCompany ?? null,
      trackingNumber: result.trackingNumber ?? null,
      trackingUrl: result.trackingUrl ?? null,
    };
  }

  async getRecentOrdersByPhone(): Promise<ShopifyOrder[]> {
    return [];
  }
}

function getDisplayStatus(fulfillmentStatus: string, cancelled: boolean): string {
  if (cancelled) return 'Cancelled';

  switch (fulfillmentStatus.toUpperCase()) {
    case 'FULFILLED':
      return 'Fulfilled';
    case 'IN_TRANSIT':
      return 'In Transit';
    case 'DELIVERED':
      return 'Delivered';
    case 'UNFULFILLED':
      return 'Processing';
    default:
      return fulfillmentStatus;
  }
}
