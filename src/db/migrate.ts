import { sql } from 'drizzle-orm';

export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  handoff_email TEXT,
  custom_templates TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE merchants ADD COLUMN IF NOT EXISTS handoff_email TEXT;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS custom_templates TEXT;

CREATE TABLE IF NOT EXISTS shopify_installations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES merchants(id),
  shop_domain TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_numbers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES merchants(id),
  phone_number TEXT NOT NULL,
  display_name TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES merchants(id),
  customer_phone TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  verified_at TIMESTAMPTZ,
  verified_order_id TEXT,
  verified_email TEXT,
  pending_order_number TEXT,
  failed_order_lookup_count INTEGER NOT NULL DEFAULT 0,
  last_customer_message_at TIMESTAMPTZ,
  language TEXT NOT NULL DEFAULT 'en',
  metadata TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS failed_order_lookup_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_customer_message_at TIMESTAMPTZ;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en';

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES merchants(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  direction TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  body TEXT NOT NULL,
  whatsapp_message_id TEXT,
  inbound_trigger_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS inbound_trigger_event_id TEXT;

CREATE TABLE IF NOT EXISTS handoffs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES merchants(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  customer_phone TEXT,
  customer_message TEXT,
  reason TEXT NOT NULL,
  summary TEXT,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE handoffs ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE handoffs ADD COLUMN IF NOT EXISTS customer_message TEXT;

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES merchants(id),
  plan TEXT NOT NULL DEFAULT 'starter',
  status TEXT NOT NULL DEFAULT 'active',
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT REFERENCES merchants(id),
  event_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'whatsapp',
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES merchants(id),
  metric TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

export async function runMigrations(db: any) {
  const statements = SCHEMA_DDL.split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const statement of statements) {
    await db.execute(sql.raw(statement));
  }
}
