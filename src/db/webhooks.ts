import { eq } from 'drizzle-orm';
import { randomUUID, createHash } from 'node:crypto';
import { webhookEvents } from './schema.js';

export interface WebhookEventRecord {
  id: string;
  tenantId: string | null;
  eventId: string;
  source: string;
  payload: string;
  status: string;
  createdAt: Date;
  processedAt: Date | null;
}

export function extractEventId(payload: any): string {
  if (typeof payload === 'object' && payload !== null) {
    if (typeof payload.eventId === 'string' && payload.eventId.trim()) {
      return payload.eventId.trim();
    }
    if (typeof payload.id === 'string' && payload.id.trim()) {
      return payload.id.trim();
    }
    const metaMsgId = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;
    if (typeof metaMsgId === 'string' && metaMsgId.trim()) {
      return metaMsgId.trim();
    }
    if (typeof payload?.message?.id === 'string' && payload.message.id.trim()) {
      return payload.message.id.trim();
    }
    if (typeof payload?.messageId === 'string' && payload.messageId.trim()) {
      return payload.messageId.trim();
    }
  }

  // Fallback: SHA-256 hash of raw JSON string
  const rawString = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return createHash('sha256').update(rawString).digest('hex');
}

export async function recordWebhookEventIfNew(
  db: any,
  eventId: string,
  rawPayload: string | Record<string, any>,
  source = 'whatsapp'
): Promise<{ isDuplicate: boolean; event: typeof webhookEvents.$inferSelect }> {
  // Check if event already exists
  const existing = await db
    .select()
    .from(webhookEvents)
    .where(eq(webhookEvents.eventId, eventId))
    .limit(1);

  if (existing.length > 0) {
    return {
      isDuplicate: true,
      event: existing[0],
    };
  }

  const payloadString = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);

  try {
    const [inserted] = await db
      .insert(webhookEvents)
      .values({
        id: randomUUID(),
        eventId,
        source,
        payload: payloadString,
        status: 'received',
      })
      .returning();

    return {
      isDuplicate: false,
      event: inserted,
    };
  } catch (err: any) {
    // Unique violation catch for race condition
    if (err?.code === '23505' || err?.message?.includes('unique') || err?.message?.includes('duplicate')) {
      const raceExisting = await db
        .select()
        .from(webhookEvents)
        .where(eq(webhookEvents.eventId, eventId))
        .limit(1);
      if (raceExisting.length > 0) {
        return {
          isDuplicate: true,
          event: raceExisting[0],
        };
      }
    }
    throw err;
  }
}
