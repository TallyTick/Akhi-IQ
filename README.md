# Akhi-IQ: WhatsApp Order-Status Support Backend for Shopify

A production-ready backend service providing automated WhatsApp order-status tracking for Shopify merchants. Built with **TypeScript**, **Node.js**, **Fastify**, **PostgreSQL with Drizzle ORM**, **Redis with BullMQ**, and tested using **Vitest**.

Architectured as a clean modular monolith: **one API service and one worker, no microservices**.

---

## Zero-Dependency Local Mode (Windows / No Docker)

If you don't have Docker installed, Akhi-IQ includes a dedicated **`LOCAL_MODE=true`** mode designed to run the complete vertical slice with **zero external dependencies**:
- **Database**: Uses embedded **PGlite** (WASM PostgreSQL) storing database files in `./data/pglite`.
- **Automatic Migrations & Seed**: Automatically creates all 9 tables, seeds the default merchant, encrypted Shopify credentials, WhatsApp business number, subscription, and mock orders on startup.
- **Queue**: Uses an embedded in-memory queue implementing the exact same queue interface, so worker execution and logging remain completely identical to BullMQ.
- **Health Probing**: `GET /health` reports healthy (`status: "ok"`, `mode: "local"`, `db: "ok"`, `redis: "ok"`).

### How to Run Locally (Exact Windows Commands)

#### Step 1: Start the Entire Application in One Command

In your Windows terminal (PowerShell or Command Prompt):

```powershell
npm run dev:local
```

You will see:
```text
{"level":"info", ... "dataDir":"./data/pglite","msg":"Starting database in LOCAL_MODE using embedded PGlite"}
{"level":"info", ... "msg":"LOCAL_MODE enabled: running auto-migrations and seeding local database..."}
{"level":"info", ... "count":3,"msg":"Loaded fake orders into MockShopifyClient"}
{"level":"info", ... "msg":"Fastify API listening on http://0.0.0.0:3000"}
{"level":"info", ... "msg":"Creating in-memory WhatsApp worker (LOCAL_MODE active)"}
{"level":"info", ... "msg":"In-memory worker started processing WhatsApp events (LOCAL_MODE)"}
```

#### Step 2: Verify Health Check

In a second terminal window (or browser):

```powershell
curl http://localhost:3000/health
```

Output:
```json
{
  "status": "ok",
  "mode": "local",
  "db": "ok",
  "redis": "ok",
  "uptime": 12.34,
  "timestamp": "2026-10-14T01:21:44.596Z"
}
```

#### Step 3: Simulate Inbound WhatsApp Messages

Open a second terminal window and run:

```powershell
# 1. Verified Order Status (Sender phone matches Order #1001)
npm run simulate -- --from "+15559998888" --message "Where is my order #1001?"

# 2. Unverified Phone (Order #1002 has different phone) -> prompts for email verification
npm run simulate -- --from "+15559998888" --message "Where is order #1002?"

# 3. Email Verification Follow-up -> identity verified, reveals Order #1002 status
npm run simulate -- --from "+15559998888" --message "bob@example.com"

# 4. Human Agent Request -> flags conversation 'needs_human' and alerts merchant support
npm run simulate -- --from "+15559998888" --message "I want to talk to a human agent"
```

The server console will immediately display the structured logs, HMAC verification, identity check, and deterministic outbound WhatsApp replies.

---

## Production Mode (Docker / PostgreSQL & Redis)

For production or containerized environments:

### 1. Start Services via Docker Compose
```bash
docker compose up -d
```

### 2. Seed Database
```bash
npm run seed
```

### 3. Start Application
```bash
# Start both API and Worker in one process:
npm start

# Or start API and Worker as separate processes:
npm run start:api
npm run start:worker
```

---

## Architecture & Flow

```
+---------------------------------------------------------------------------------------------+
|                                    Inbound Webhook                                          |
|                                                                                             |
|   WhatsApp Cloud API                                                                        |
|          |                                                                                  |
|          | (POST /webhooks/whatsapp with X-Hub-Signature-256)                               |
|          v                                                                                  |
|   +-------------------------------------------------------------------------------------+   |
|   | Fastify API Server                                                                  |   |
|   | 1. Verifies HMAC-SHA256 timing-safely against raw body bytes                        |   |
|   | 2. Checks idempotency via webhook_events table (deduplicates duplicate deliveries)  |   |
|   | 3. Enqueues job into Queue ('whatsapp-inbound' via BullMQ or InMemoryQueue)         |   |
|   | 4. Returns HTTP 200 immediately to WhatsApp                                         |   |
|   +-------------------------------------------------------------------------------------+   |
+---------------------------------------------+-----------------------------------------------+
                                              |
                                              | Queue
                                              v
+---------------------------------------------------------------------------------------------+
|                                      Worker Pipeline                                        |
|                                                                                             |
|   1. Map receiving WhatsApp number to merchant (tenant_id) via whatsapp_numbers table       |
|   2. Initialize tenant-scoped DB repository & structured logger with { tenantId }           |
|   3. Record inbound message in messages table and update usage metrics                      |
|   4. Intent & Entity Detection:                                                             |
|      - Human agent request ("human", "agent", "support") -> Escalates to Handoff            |
|      - Order status intent -> Extracted order number via pluggable OrderExtractor (Regex/LLM)|
|   5. Shopify Order Lookup:                                                                  |
|      - Decrypts merchant access token using AES-256-GCM                                     |
|      - Queries ShopifyClient (MockShopifyClient or ShopifyAdminGraphQLClient)               |
|   6. IDENTITY VERIFICATION CHECK (Strict Non-Negotiable):                                    |
|      - Match: Sender phone matches order customer phone -> IDENTITY VERIFIED                |
|      - Mismatch: Phone does NOT match:                                                      |
|        * If customer provided email -> Verifies against order customer email                |
|        * If unverified or email mismatch -> NEVER reveals order data!                       |
|        * If no email provided yet -> Prompts for order number + email verification          |
|   7. Response:                                                                              |
|      - Deterministic status + tracking template dispatched via WhatsAppProvider            |
|   8. Escalation (Handoff):                                                                  |
|      - Unclear intent / human request / failed identity verification flags conversation     |
|        as 'needs_human', inserts into handoffs table, and dispatches EmailHandoffStub       |
+---------------------------------------------------------------------------------------------+
```

---

## Database Tables (9 Tables)

All multi-tenant queries strictly enforce `tenant_id` at the repository layer.

| Table | Purpose |
|---|---|
| `merchants` | Root merchant record (`id`, `name`, timestamps) |
| `shopify_installations` | Tenant-scoped store domain and AES-256-GCM encrypted access token (`access_token_encrypted`) |
| `whatsapp_numbers` | Maps inbound WhatsApp business numbers to merchant `tenant_id` |
| `conversations` | Customer interaction thread (`status`, `verified_at`, `pending_order_number`, etc.) |
| `messages` | Audit log of inbound and outbound messages (`direction`, `sender`, `recipient`, `body`) |
| `handoffs` | Escalation audit log (`reason`, `summary`, `notified_at`) |
| `subscriptions` | Merchant subscription and billing state (`plan`, `status`) |
| `webhook_events` | Idempotency log guaranteeing at-most-once processing of incoming webhook IDs |
| `usage` | Multi-tenant metric telemetry (`messages_inbound`, `messages_outbound`, `orders_looked_up`, etc.) |

---

## Non-Negotiables Built Into the System

1. **`tenant_id` Enforced on Every Query**:
   Every tenant database operation is encapsulated within `createTenantRepository(db, tenantId)`. Passing an empty or invalid tenant ID immediately throws an exception. All SQL queries and mutations apply `tenant_id` filters.
2. **HMAC Verification**:
   The `POST /webhooks/whatsapp` endpoint captures unparsed raw request payload bytes (`@fastify/raw-body`) and validates `X-Hub-Signature-256` using `crypto.timingSafeEqual`. Missing or invalid signatures are rejected with HTTP 401.
3. **AES-256-GCM Authenticated Encryption**:
   Shopify API tokens are encrypted with 96-bit IVs and 128-bit authentication tags (`iv:tag:ciphertext`). Any payload tampering triggers an immediate decryption failure.
4. **Config Validation Refuses Startup Without 32-Byte Key**:
   During startup, `loadConfig()` verifies that `ENCRYPTION_KEY` is exactly 32 bytes (256 bits), accepting either 64 hexadecimal characters or 32 raw bytes. If absent or invalid length, the process refuses to boot and throws a fatal error.
5. **Structured Logs With Tenant ID**:
   Using `pino`, contextual tenant loggers (`createTenantLogger(tenantId)`) attach `tenantId` to all operations within the worker and repository layers.
6. **Health Check Endpoint (`GET /health`)**:
   Actively checks database connectivity (`SELECT 1`) and Redis/queue connectivity. Returns HTTP 200 with JSON details when healthy, or HTTP 503 if degraded.

---

## Identity Verification Rules

To protect customer privacy, **no order status or tracking details are ever disclosed to an unverified sender**:

1. **Direct Phone Match**:
   If the WhatsApp sender phone matches the phone number attached to the Shopify order, identity is verified immediately, and the deterministic status template is sent.
2. **Phone Mismatch (Fallback Request)**:
   If the sender's phone does not match the order's phone, the order details are withheld. The system saves the pending order state and requests the customer's email address.
3. **Email Verification**:
   When the customer replies with an email address matching the order records, identity is verified, and the order status is released.
4. **Email Mismatch**:
   If the provided email does not match, the order is withheld, the conversation is marked `needs_human`, a handoff record is logged, and the merchant support desk is alerted.

---

## Testing

The test suite runs with **Vitest** and uses an in-memory **PGlite** instance (WASM Postgres) and **ioredis-mock**, allowing comprehensive database and worker integration tests to run with zero external Docker dependencies.

```powershell
npm test
```

### Test Suites Included (26 Tests):
- **`test/local-mode.test.ts`**: End-to-end test of `LOCAL_MODE=true` zero-dependency flow, testing auto-migration, in-memory queue, and local `/health`.
- **`test/crypto-config.test.ts`**: Validates 32-byte encryption key enforcement, AES-256-GCM authenticated encryption/decryption, anti-tampering auth tag checks, and tenant ID enforcement.
- **`test/hmac.test.ts`**: Verifies rejection of missing signatures (401), forged signatures (401), and modified payloads (401), plus acceptance of valid HMAC signatures (200).
- **`test/idempotency.test.ts`**: Verifies that duplicate webhook deliveries with the same `event_id` return 200 without duplicate queue jobs or duplicate database inserts.
- **`test/identity.test.ts`**: Verifies matching phone verification, unverified phone fallback prompts (withholding order data), email matching verification, and email mismatch escalation to handoff.
- **`test/handoff.test.ts`**: Verifies explicit human support requests, unclear intent classification, handoff creation, and `EmailHandoffStub` alerts.
- **`test/health.test.ts`**: Verifies `/health` database and Redis probe responses.

---

## Pluggable Interfaces

- **`ShopifyClient`** (`src/shopify/types.ts`):
  - `MockShopifyClient`: In-memory store for development and testing.
  - `ShopifyAdminGraphQLClient`: Production skeleton querying Shopify's Admin GraphQL API (`orders(first: 1, query: "name:#...")`).
- **`OrderExtractor`** (`src/extractor/extractor.ts`):
  - `RegexOrderExtractor`: Pattern matching for `#1001`, `order 1001`, etc.
  - `LLMOrderExtractor`: Entity extraction stub behind a pluggable interface for LLM completions.
- **`WhatsAppProvider`** (`src/whatsapp/provider.ts`):
  - `MockWhatsAppProvider`: In-memory message recording and structured logging.
  - `TwilioWhatsAppProvider`: Sends messages through the Twilio REST API using `fetch`. Select it with `WHATSAPP_PROVIDER=twilio` and set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, and `PUBLIC_BASE_URL`. Inbound Twilio messages are accepted at `POST /webhooks/twilio/whatsapp`; the existing signed generic webhook remains available for mock integrations.
- **`HandoffNotifier`** (`src/handoff/notifier.ts`):
  - `EmailHandoffStub`: Dispatches structured email notifications to merchant support desks.
