import { ShopifyClient, ShopifyOrder } from './types.js';

export class MockShopifyClient implements ShopifyClient {
  private orders: Map<string, ShopifyOrder> = new Map();

  constructor(initialOrders?: { shopDomain: string; order: ShopifyOrder }[]) {
    if (initialOrders) {
      for (const item of initialOrders) {
        this.addMockOrder(item.shopDomain, item.order);
      }
    }
  }

  private makeKey(shopDomain: string, orderNumber: string): string {
    const cleanNumber = orderNumber.replace(/^#/, '').trim();
    return `${shopDomain.toLowerCase()}:${cleanNumber}`;
  }

  public addMockOrder(shopDomain: string, order: ShopifyOrder): void {
    const cleanNumber = order.orderNumber.replace(/^#/, '').trim();
    this.orders.set(this.makeKey(shopDomain, cleanNumber), order);
  }

  public clearOrders(): void {
    this.orders.clear();
  }

  async getOrder(shopDomain: string, accessToken: string, orderNumber: string): Promise<ShopifyOrder | null> {
    const cleanNumber = orderNumber.replace(/^#/, '').trim();
    const key = this.makeKey(shopDomain, cleanNumber);
    const order = this.orders.get(key);
    return order ? { ...order } : null;
  }

  async getRecentOrdersByPhone(
    shopDomain: string,
    accessToken: string,
    customerPhone: string
  ): Promise<ShopifyOrder[]> {
    const cleanPhone = customerPhone.replace(/[^0-9]/g, '');
    const prefix = `${shopDomain.toLowerCase()}:`;
    const matched: ShopifyOrder[] = [];

    for (const [key, order] of this.orders.entries()) {
      if (key.startsWith(prefix) && order.customerPhone) {
        const orderPhone = order.customerPhone.replace(/[^0-9]/g, '');
        if (
          cleanPhone === orderPhone ||
          cleanPhone.endsWith(orderPhone) ||
          orderPhone.endsWith(cleanPhone)
        ) {
          matched.push({ ...order });
        }
      }
    }

    return matched;
  }
}

export const defaultMockShopifyClient = new MockShopifyClient();
