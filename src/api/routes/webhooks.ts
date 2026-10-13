import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyHmacSha256 } from '../../crypto/hmac.js';
import { extractEventId, recordWebhookEventIfNew } from '../../db/webhooks.js';
import { enqueueWhatsAppMessage } from '../../queue/queue.js';
import { WhatsAppMessagePayload } from '../../queue/types.js';
import { getConfig } from '../../config/env.js';
import { logger } from '../../logger/index.js';

export function parseWhatsAppPayload(body: any): WhatsAppMessagePayload {
  // 1. Direct/simplified format
  if (body?.from && body?.to && body?.body) {
    return {
      eventId: extractEventId(body),
      from: String(body.from),
      to: String(body.to),
      body: String(body.body),
      whatsappMessageId: body.whatsappMessageId || body.id || extractEventId(body),
      timestamp: body.timestamp ? String(body.timestamp) : new Date().toISOString(),
      rawPayload: body,
    };
  }

  // 2. Official WhatsApp Cloud API format
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0];
  const val = change?.value;
  const message = val?.messages?.[0];

  if (message) {
    const to = val?.metadata?.display_phone_number || '';
    const from = message.from || '';
    const textBody = message.text?.body || '';
    const whatsappMessageId = message.id;

    return {
      eventId: whatsappMessageId || extractEventId(body),
      from,
      to,
      body: textBody,
      whatsappMessageId,
      timestamp: message.timestamp ? String(message.timestamp) : new Date().toISOString(),
      rawPayload: body,
    };
  }

  // Fallback
  return {
    eventId: extractEventId(body),
    from: String(body?.from || ''),
    to: String(body?.to || ''),
    body: String(body?.text || body?.body || ''),
    whatsappMessageId: body?.id,
    timestamp: new Date().toISOString(),
    rawPayload: body,
  };
}

export function registerWebhookRoutes(
  app: FastifyInstance,
  options: { db: any; webhookSecret?: string; queue?: any }
) {
  app.post(
    '/webhooks/whatsapp',
    {
      config: {
        rawBody: true,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const config = getConfig();
      const secret = options.webhookSecret || config.WHATSAPP_WEBHOOK_SECRET;

      // Extract signature header
      const signatureHeader =
        (request.headers['x-hub-signature-256'] as string) ||
        (request.headers['x-whatsapp-signature'] as string) ||
        (request.headers['x-signature'] as string);

      const rawPayload = (request as any).rawBody || JSON.stringify(request.body || {});

      // 1. Verify HMAC signature
      const isValid = verifyHmacSha256(rawPayload, signatureHeader, secret);
      if (!isValid) {
        logger.warn({ ip: request.ip }, 'Rejected webhook: invalid or missing HMAC signature');
        return reply.status(401).send({ error: 'Unauthorized: Invalid HMAC signature' });
      }

      // 2. Parse payload
      const parsed = parseWhatsAppPayload(request.body);
      const eventId = parsed.eventId;

      // 3. Deduplicate using webhook_events table (idempotent)
      const { isDuplicate, event } = await recordWebhookEventIfNew(
        options.db,
        eventId,
        request.body as Record<string, any>,
        'whatsapp'
      );

      if (isDuplicate) {
        logger.info({ eventId }, 'Duplicate webhook event received - returning 200 without re-enqueuing');
        return reply.status(200).send({ status: 'ok', deduplicated: true, eventId });
      }

      // 4. Enqueue the job for worker processing
      await enqueueWhatsAppMessage(parsed, options.queue);

      logger.info({ eventId, from: parsed.from, to: parsed.to }, 'Webhook event enqueued successfully');

      // Return 200 immediately
      return reply.status(200).send({ status: 'ok', eventId });
    }
  );
}
