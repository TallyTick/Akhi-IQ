import { pgTable, text, timestamp, boolean, integer, uniqueIndex } from 'drizzle-orm/pg-core';

export const merchants = pgTable('merchants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  handoffEmail: text('handoff_email'),
  customTemplates: text('custom_templates'), // JSON-serialized custom wording
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const shopifyInstallations = pgTable(
  'shopify_installations',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => merchants.id),
    shopDomain: text('shop_domain').notNull(),
    accessTokenEncrypted: text('access_token_encrypted'),
    scope: text('scope'),
    status: text('status').notNull().default('installed'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('shopify_installations_shop_domain_unique').on(table.shopDomain)]
);

export const whatsappNumbers = pgTable('whatsapp_numbers', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => merchants.id),
  phoneNumber: text('phone_number').notNull(),
  displayName: text('display_name'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => merchants.id),
  customerPhone: text('customer_phone').notNull(),
  status: text('status').notNull().default('active'), // 'active', 'needs_human', 'resolved', 'closed'
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  verifiedOrderId: text('verified_order_id'),
  verifiedEmail: text('verified_email'),
  pendingOrderNumber: text('pending_order_number'),
  failedOrderLookupCount: integer('failed_order_lookup_count').notNull().default(0),
  lastCustomerMessageAt: timestamp('last_customer_message_at', { withTimezone: true }),
  language: text('language').notNull().default('en'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => merchants.id),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  direction: text('direction').notNull(), // 'inbound', 'outbound'
  sender: text('sender').notNull(),
  recipient: text('recipient').notNull(),
  body: text('body').notNull(),
  whatsappMessageId: text('whatsapp_message_id'),
  inboundTriggerEventId: text('inbound_trigger_event_id'), // Deduplication lock to prevent duplicate replies
  status: text('status').notNull().default('received'), // 'received', 'sent', 'delivered', 'failed'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const handoffs = pgTable('handoffs', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => merchants.id),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  customerPhone: text('customer_phone'),
  customerMessage: text('customer_message'),
  reason: text('reason').notNull(), // 'unclear_intent', 'human_requested', 'order_not_found', 'unverified', 'system_error'
  summary: text('summary'),
  notifiedAt: timestamp('notified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => merchants.id),
  plan: text('plan').notNull().default('starter'), // 'starter', 'pro', 'enterprise'
  status: text('status').notNull().default('active'), // 'active', 'past_due', 'canceled'
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const webhookEvents = pgTable('webhook_events', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').references(() => merchants.id),
  eventId: text('event_id').notNull().unique(),
  source: text('source').notNull().default('whatsapp'), // 'whatsapp', 'shopify'
  payload: text('payload').notNull(),
  status: text('status').notNull().default('received'), // 'received', 'processing', 'completed', 'failed'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
});

export const usage = pgTable('usage', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull().references(() => merchants.id),
  metric: text('metric').notNull(), // 'messages_inbound', 'messages_outbound', 'orders_looked_up', 'handoffs'
  count: integer('count').notNull().default(1),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
});
