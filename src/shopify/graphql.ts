import { ShopifyClient, ShopifyOrder } from './types.js';

const ADMIN_GRAPHQL_VERSION = '2024-01';

const ORDER_QUERY = `
  query getOrderByNumber($query: String!) {
    orders(first: 1, query: $query) {
      edges {
        node {
          id
          name
          displayFulfillmentStatus
          displayFinancialStatus
          phone
          email
          customer {
            phone
            email
          }
          fulfillments(first: 5) {
            status
            trackingInfo(first: 5) {
              company
              number
              url
            }
          }
        }
      }
    }
  }
`;

const ORDERS_BY_PHONE_QUERY = `
  query getOrdersByPhone($query: String!) {
    orders(first: 5, query: $query, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          displayFulfillmentStatus
          displayFinancialStatus
          phone
          email
          customer {
            phone
            email
          }
          fulfillments(first: 5) {
            status
            trackingInfo(first: 5) {
              company
              number
              url
            }
          }
        }
      }
    }
  }
`;

export class ShopifyAdminGraphQLClient implements ShopifyClient {
  private apiVersion: string;

  constructor(apiVersion = ADMIN_GRAPHQL_VERSION) {
    this.apiVersion = apiVersion;
  }

  async getOrder(shopDomain: string, accessToken: string, orderNumber: string): Promise<ShopifyOrder | null> {
    const cleanNumber = orderNumber.replace(/^#/, '').trim();
    const endpoint = `https://${shopDomain}/admin/api/${this.apiVersion}/graphql.json`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        query: ORDER_QUERY,
        variables: {
          query: `name:#${cleanNumber}`,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Shopify GraphQL API error (${response.status}): ${errText}`);
    }

    const json: any = await response.json();
    if (json.errors && json.errors.length > 0) {
      throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
    }

    const edges = json?.data?.orders?.edges;
    if (!edges || edges.length === 0) {
      return null;
    }

    return this.mapNodeToOrder(edges[0].node);
  }

  async getRecentOrdersByPhone(
    shopDomain: string,
    accessToken: string,
    customerPhone: string
  ): Promise<ShopifyOrder[]> {
    const cleanPhone = customerPhone.replace(/[^0-9]/g, '');
    const endpoint = `https://${shopDomain}/admin/api/${this.apiVersion}/graphql.json`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        query: ORDERS_BY_PHONE_QUERY,
        variables: {
          query: `phone:*${cleanPhone}*`,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Shopify GraphQL API error (${response.status}): ${errText}`);
    }

    const json: any = await response.json();
    const edges = json?.data?.orders?.edges || [];
    return edges.map((e: any) => this.mapNodeToOrder(e.node));
  }

  private mapNodeToOrder(node: any): ShopifyOrder {
    const cleanNumber = String(node.name).replace(/^#/, '').trim();
    const fulfillment = node.fulfillments?.[0];
    const tracking = fulfillment?.trackingInfo?.[0];
    const customerPhone = node.phone || node.customer?.phone || null;
    const customerEmail = node.email || node.customer?.email || null;

    return {
      id: node.id,
      name: node.name,
      orderNumber: cleanNumber,
      customerPhone,
      customerEmail,
      financialStatus: node.displayFinancialStatus || 'UNKNOWN',
      fulfillmentStatus: node.displayFulfillmentStatus || 'UNFULFILLED',
      displayStatus: node.displayFulfillmentStatus || 'Processing',
      trackingUrl: tracking?.url || null,
      trackingCompany: tracking?.company || null,
      trackingNumber: tracking?.number || null,
    };
  }
}
