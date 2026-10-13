import { ShopifyOrder } from './types.js';

export const SEED_SHOP_DOMAIN = 'acme-store.myshopify.com';

export const SEED_ORDERS: ShopifyOrder[] = [
  {
    id: 'gid://shopify/Order/1001',
    name: '#1001',
    orderNumber: '1001',
    customerPhone: '+15559998888',
    customerEmail: 'alice@example.com',
    financialStatus: 'PAID',
    fulfillmentStatus: 'FULFILLED',
    displayStatus: 'Delivered',
    trackingUrl: 'https://track.carrier.com/1001',
    trackingCompany: 'FedEx',
    trackingNumber: 'FDX-1001-XYZ',
  },
  {
    id: 'gid://shopify/Order/1002',
    name: '#1002',
    orderNumber: '1002',
    customerPhone: '+15557776666',
    customerEmail: 'bob@example.com',
    financialStatus: 'PAID',
    fulfillmentStatus: 'IN_TRANSIT',
    displayStatus: 'In Transit',
    trackingUrl: 'https://track.carrier.com/1002',
    trackingCompany: 'DHL',
    trackingNumber: 'DHL-1002-ABC',
  },
  {
    id: 'gid://shopify/Order/1003',
    name: '#1003',
    orderNumber: '1003',
    customerPhone: '+15559998888',
    customerEmail: 'alice@example.com',
    financialStatus: 'PAID',
    fulfillmentStatus: 'UNFULFILLED',
    displayStatus: 'Processing',
    trackingUrl: null,
    trackingCompany: null,
    trackingNumber: null,
  },
];
