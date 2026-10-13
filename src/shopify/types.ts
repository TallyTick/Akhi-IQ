export interface ShopifyOrder {
  id: string;
  name: string; // e.g. "#1001"
  orderNumber: string; // e.g. "1001"
  customerPhone?: string | null;
  customerEmail?: string | null;
  financialStatus: string; // e.g. "PAID", "PENDING", "REFUNDED"
  fulfillmentStatus: string; // e.g. "FULFILLED", "UNFULFILLED", "IN_TRANSIT"
  displayStatus: string; // e.g. "Delivered", "In Transit", "Processing"
  trackingUrl?: string | null;
  trackingCompany?: string | null;
  trackingNumber?: string | null;
}

export interface ShopifyClient {
  getOrder(shopDomain: string, accessToken: string, orderNumber: string): Promise<ShopifyOrder | null>;
  getRecentOrdersByPhone(shopDomain: string, accessToken: string, customerPhone: string): Promise<ShopifyOrder[]>;
}
