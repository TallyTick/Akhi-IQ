import { eq, and, sql, desc, gte, lt } from 'drizzle-orm';
import {
  merchants,
  shopifyInstallations,
  whatsappNumbers,
  conversations,
  messages,
  handoffs,
  subscriptions,
  webhookEvents,
  usage,
} from './schema.js';
import { randomUUID } from 'node:crypto';

export interface MonthlySummaryReport {
  tenantId: string;
  year: number;
  month: number;
  totalConversations: number;
  conversationsHandledAutomatically: number;
  conversationsHandedOff: number;
  estimatedHoursSaved: number; // e.g. 10 minutes saved per automated conversation
}

export interface TenantRepository {
  tenantId: string;
  getMerchant(): Promise<typeof merchants.$inferSelect | null>;
  updateMerchant(data: {
    name?: string;
    handoffEmail?: string;
    customTemplates?: string;
  }): Promise<typeof merchants.$inferSelect>;
  getShopifyInstallation(): Promise<typeof shopifyInstallations.$inferSelect | null>;
  saveShopifyInstallation(data: {
    shopDomain: string;
    accessTokenEncrypted: string;
    scope?: string;
  }): Promise<typeof shopifyInstallations.$inferSelect>;
  findWhatsAppNumber(phoneNumber: string): Promise<typeof whatsappNumbers.$inferSelect | null>;
  findConversationByCustomerPhone(customerPhone: string): Promise<typeof conversations.$inferSelect | null>;
  getConversation(conversationId: string): Promise<typeof conversations.$inferSelect | null>;
  createConversation(data: {
    customerPhone: string;
    status?: string;
    pendingOrderNumber?: string;
    failedOrderLookupCount?: number;
    lastCustomerMessageAt?: Date;
    language?: string;
    metadata?: string;
  }): Promise<typeof conversations.$inferSelect>;
  updateConversation(
    conversationId: string,
    data: Partial<Omit<typeof conversations.$inferInsert, 'id' | 'tenantId' | 'createdAt'>>
  ): Promise<typeof conversations.$inferSelect>;
  createMessage(data: {
    conversationId: string;
    direction: 'inbound' | 'outbound';
    sender: string;
    recipient: string;
    body: string;
    whatsappMessageId?: string;
    inboundTriggerEventId?: string;
    status?: string;
  }): Promise<typeof messages.$inferSelect>;
  hasRepliedToInboundEvent(inboundTriggerEventId: string): Promise<boolean>;
  listMessages(conversationId: string): Promise<(typeof messages.$inferSelect)[]>;
  createHandoff(data: {
    conversationId: string;
    customerPhone?: string;
    customerMessage?: string;
    reason: string;
    summary?: string;
    notifiedAt?: Date;
  }): Promise<typeof handoffs.$inferSelect>;
  listHandoffs(): Promise<(typeof handoffs.$inferSelect)[]>;
  getSubscription(): Promise<typeof subscriptions.$inferSelect | null>;
  recordUsage(metric: string, count?: number): Promise<typeof usage.$inferSelect>;
  linkWebhookEvent(eventId: string, status?: string): Promise<void>;
  getMonthlySummary(year: number, month: number): Promise<MonthlySummaryReport>;
}

export function createTenantRepository(db: any, tenantId: string): TenantRepository {
  if (!tenantId || typeof tenantId !== 'string' || tenantId.trim() === '') {
    throw new Error('Tenant enforcement violation: valid non-empty tenant_id is required on every operation.');
  }

  const tid = tenantId.trim();

  return {
    tenantId: tid,

    async getMerchant() {
      const rows = await db
        .select()
        .from(merchants)
        .where(eq(merchants.id, tid))
        .limit(1);
      return rows[0] || null;
    },

    async updateMerchant(data) {
      const [updated] = await db
        .update(merchants)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(eq(merchants.id, tid))
        .returning();
      return updated;
    },

    async getShopifyInstallation() {
      const rows = await db
        .select()
        .from(shopifyInstallations)
        .where(eq(shopifyInstallations.tenantId, tid))
        .limit(1);
      return rows[0] || null;
    },

    async saveShopifyInstallation(data) {
      const existing = await this.getShopifyInstallation();
      if (existing) {
        const [updated] = await db
          .update(shopifyInstallations)
          .set({
            shopDomain: data.shopDomain,
            accessTokenEncrypted: data.accessTokenEncrypted,
            scope: data.scope,
            updatedAt: new Date(),
          })
          .where(and(eq(shopifyInstallations.tenantId, tid), eq(shopifyInstallations.id, existing.id)))
          .returning();
        return updated;
      }

      const [inserted] = await db
        .insert(shopifyInstallations)
        .values({
          id: randomUUID(),
          tenantId: tid,
          shopDomain: data.shopDomain,
          accessTokenEncrypted: data.accessTokenEncrypted,
          scope: data.scope,
        })
        .returning();
      return inserted;
    },

    async findWhatsAppNumber(phoneNumber: string) {
      const clean = phoneNumber.replace(/\s+/g, '');
      const rows = await db
        .select()
        .from(whatsappNumbers)
        .where(and(eq(whatsappNumbers.tenantId, tid), eq(whatsappNumbers.phoneNumber, clean)))
        .limit(1);
      return rows[0] || null;
    },

    async findConversationByCustomerPhone(customerPhone: string) {
      const clean = customerPhone.replace(/\s+/g, '');
      const rows = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.tenantId, tid), eq(conversations.customerPhone, clean)))
        .orderBy(desc(conversations.createdAt))
        .limit(1);
      return rows[0] || null;
    },

    async getConversation(conversationId: string) {
      const rows = await db
        .select()
        .from(conversations)
        .where(and(eq(conversations.tenantId, tid), eq(conversations.id, conversationId)))
        .limit(1);
      return rows[0] || null;
    },

    async createConversation(data) {
      const cleanPhone = data.customerPhone.replace(/\s+/g, '');
      const [inserted] = await db
        .insert(conversations)
        .values({
          id: randomUUID(),
          tenantId: tid,
          customerPhone: cleanPhone,
          status: data.status || 'active',
          pendingOrderNumber: data.pendingOrderNumber,
          failedOrderLookupCount: data.failedOrderLookupCount || 0,
          lastCustomerMessageAt: data.lastCustomerMessageAt || new Date(),
          language: data.language || 'en',
          metadata: data.metadata,
        })
        .returning();
      return inserted;
    },

    async updateConversation(conversationId: string, data) {
      const [updated] = await db
        .update(conversations)
        .set({
          ...data,
          updatedAt: new Date(),
        })
        .where(and(eq(conversations.tenantId, tid), eq(conversations.id, conversationId)))
        .returning();
      return updated;
    },

    async createMessage(data) {
      const [inserted] = await db
        .insert(messages)
        .values({
          id: randomUUID(),
          tenantId: tid,
          conversationId: data.conversationId,
          direction: data.direction,
          sender: data.sender,
          recipient: data.recipient,
          body: data.body,
          whatsappMessageId: data.whatsappMessageId,
          inboundTriggerEventId: data.inboundTriggerEventId,
          status: data.status || 'received',
        })
        .returning();
      return inserted;
    },

    async hasRepliedToInboundEvent(inboundTriggerEventId: string) {
      if (!inboundTriggerEventId) return false;
      const rows = await db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.tenantId, tid),
            eq(messages.inboundTriggerEventId, inboundTriggerEventId),
            eq(messages.direction, 'outbound')
          )
        )
        .limit(1);
      return rows.length > 0;
    },

    async listMessages(conversationId: string) {
      return db
        .select()
        .from(messages)
        .where(and(eq(messages.tenantId, tid), eq(messages.conversationId, conversationId)))
        .orderBy(messages.createdAt);
    },

    async createHandoff(data) {
      const [inserted] = await db
        .insert(handoffs)
        .values({
          id: randomUUID(),
          tenantId: tid,
          conversationId: data.conversationId,
          customerPhone: data.customerPhone,
          customerMessage: data.customerMessage,
          reason: data.reason,
          summary: data.summary,
          notifiedAt: data.notifiedAt,
        })
        .returning();
      return inserted;
    },

    async listHandoffs() {
      return db
        .select()
        .from(handoffs)
        .where(eq(handoffs.tenantId, tid))
        .orderBy(desc(handoffs.createdAt));
    },

    async getSubscription() {
      const rows = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.tenantId, tid))
        .limit(1);
      return rows[0] || null;
    },

    async recordUsage(metric: string, count = 1) {
      const [inserted] = await db
        .insert(usage)
        .values({
          id: randomUUID(),
          tenantId: tid,
          metric,
          count,
        })
        .returning();
      return inserted;
    },

    async linkWebhookEvent(eventId: string, status?: string) {
      await db
        .update(webhookEvents)
        .set({
          tenantId: tid,
          ...(status ? { status, processedAt: new Date() } : {}),
        })
        .where(eq(webhookEvents.eventId, eventId));
    },

    async getMonthlySummary(year: number, month: number): Promise<MonthlySummaryReport> {
      // month is 1-indexed (1 to 12)
      const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
      const endDate = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1, 0, 0, 0));

      const convs = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.tenantId, tid),
            gte(conversations.createdAt, startDate),
            lt(conversations.createdAt, endDate)
          )
        );

      const totalConversations = convs.length;
      const conversationsHandedOff = convs.filter((c: any) => c.status === 'needs_human').length;
      const conversationsHandledAutomatically = totalConversations - conversationsHandedOff;
      // Assume each automated resolution saves 10 minutes (0.1667 hours) of human agent time
      const estimatedHoursSaved = Number(((conversationsHandledAutomatically * 10) / 60).toFixed(1));

      return {
        tenantId: tid,
        year,
        month,
        totalConversations,
        conversationsHandledAutomatically,
        conversationsHandedOff,
        estimatedHoursSaved,
      };
    },
  };
}

export async function lookupTenantByWhatsAppNumber(db: any, receivingNumber: string): Promise<string | null> {
  const cleanNumber = receivingNumber.replace(/\s+/g, '');
  const rows = await db
    .select({ tenantId: whatsappNumbers.tenantId })
    .from(whatsappNumbers)
    .where(and(eq(whatsappNumbers.phoneNumber, cleanNumber), eq(whatsappNumbers.isActive, true)))
    .limit(1);

  if (rows.length === 0) {
    return null;
  }
  return rows[0].tenantId;
}
