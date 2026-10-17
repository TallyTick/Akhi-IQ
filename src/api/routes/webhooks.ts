import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { verifyHmacSha256 } from '../../crypto/hmac.js';
import { whatsappNumbers } from '../../db/schema.js';
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
  options: {
    db: any;
    webhookSecret?: string;
    queue?: any;
    twilioAuthToken?: string;
    publicBaseUrl?: string;
    metaAppSecret?: string;
    metaVerifyToken?: string;
  }
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

      logger.info({ eventId }, 'Webhook event enqueued successfully');

      // Return 200 immediately
      return reply.status(200).send({ status: 'ok', eventId });
    }
  );

  app.post('/webhooks/twilio/whatsapp', async (request: FastifyRequest, reply: FastifyReply) => {
    const config = getConfig();
    const authToken = options.twilioAuthToken ?? config.TWILIO_AUTH_TOKEN ?? '';
    const publicBaseUrl = options.publicBaseUrl ?? config.PUBLIC_BASE_URL ?? '';
    const signature = request.headers['x-twilio-signature'];
    const url = `${publicBaseUrl.replace(/\/+$/, '')}/webhooks/twilio/whatsapp`;
    const parameters =
      request.body && typeof request.body === 'object'
        ? request.body as Record<string, string>
        : {};

    if (
      !authToken ||
      !publicBaseUrl ||
      typeof signature !== 'string' ||
      !verifyTwilioSignature(url, parameters, signature, authToken)
    ) {
      logger.warn('Rejected Twilio WhatsApp webhook: invalid or missing signature');
      return reply.status(403).send();
    }

    const stripWhatsAppPrefix = (value: unknown) =>
      typeof value === 'string' ? value.replace(/^whatsapp:/i, '') : '';
    const messageSid = typeof parameters?.MessageSid === 'string' ? parameters.MessageSid : '';
    const payload = {
      eventId: messageSid,
      from: stripWhatsAppPrefix(parameters?.From),
      to: stripWhatsAppPrefix(parameters?.To),
      body: typeof parameters?.Body === 'string' ? parameters.Body : '',
      whatsappMessageId: messageSid,
      timestamp: new Date().toISOString(),
      rawPayload: parameters,
    };

    if (!messageSid) {
      return reply.status(400).send();
    }

    const { isDuplicate } = await recordWebhookEventIfNew(
      options.db,
      messageSid,
      parameters,
      'whatsapp'
    );

    if (!isDuplicate) {
      await enqueueWhatsAppMessage(payload, options.queue);
    }

    return reply
      .type('text/xml; charset=utf-8')
      .status(200)
      .send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  });

  app.get('/webhooks/meta/whatsapp', async (request: FastifyRequest, reply: FastifyReply) => {
    const config = getConfig();
    const query = request.query as Record<string, unknown>;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    const verifyToken = options.metaVerifyToken ?? config.META_VERIFY_TOKEN ?? '';

    if (
      mode !== 'subscribe' ||
      typeof token !== 'string' ||
      !verifyMetaVerifyToken(token, verifyToken) ||
      typeof challenge !== 'string'
    ) {
      return reply.status(403).send();
    }

    return reply.type('text/plain').status(200).send(challenge);
  });

  app.post(
    '/webhooks/meta/whatsapp',
    {
      config: {
        rawBody: true,
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const config = getConfig();
      const appSecret = options.metaAppSecret ?? config.META_APP_SECRET ?? '';
      const signature = request.headers['x-hub-signature-256'];
      const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody;

      if (
        !appSecret ||
        typeof signature !== 'string' ||
        typeof rawBody !== 'string' ||
        !verifyMetaSignature(rawBody, signature, appSecret)
      ) {
        logger.warn({ ip: request.ip }, 'Rejected Meta WhatsApp webhook: invalid or missing signature');
        return reply.status(401).send();
      }

      const payload = request.body as {
        entry?: Array<{
          changes?: Array<{
            value?: {
              metadata?: { phone_number_id?: unknown };
              messages?: Array<{
                id?: unknown;
                from?: unknown;
                type?: unknown;
                text?: { body?: unknown };
                timestamp?: unknown;
              }>;
            };
          }>;
        }>;
      } | null;

      for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
        for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
          const value = change?.value;
          const providerNumberId = value?.metadata?.phone_number_id;
          if (typeof providerNumberId !== 'string' || !Array.isArray(value?.messages)) {
            continue;
          }

          const registeredNumbers = await options.db
            .select()
            .from(whatsappNumbers)
            .where(and(
              eq(whatsappNumbers.providerNumberId, providerNumberId),
              eq(whatsappNumbers.isActive, true)
            ))
            .limit(1);
          const registeredNumber = registeredNumbers[0];
          if (!registeredNumber) {
            continue;
          }

          for (const message of value.messages) {
            if (
              message?.type !== 'text' ||
              typeof message.id !== 'string' ||
              !message.id ||
              typeof message.from !== 'string' ||
              typeof message.text?.body !== 'string'
            ) {
              continue;
            }

            const senderDigits = message.from.replace(/\D/g, '');
            if (!senderDigits) {
              continue;
            }

            const inbound = {
              eventId: message.id,
              from: `+${senderDigits}`,
              to: registeredNumber.phoneNumber,
              body: message.text.body,
              whatsappMessageId: message.id,
              timestamp: typeof message.timestamp === 'string' ? message.timestamp : new Date().toISOString(),
              rawPayload: payload,
            };
            const { isDuplicate } = await recordWebhookEventIfNew(
              options.db,
              message.id,
              payload as Record<string, any>,
              'whatsapp'
            );

            if (!isDuplicate) {
              await enqueueWhatsAppMessage(inbound, options.queue);
            }
          }
        }
      }

      return reply.status(200).send('EVENT_RECEIVED');
    }
  );
}

export function verifyMetaSignature(rawBody: string, signature: string, appSecret: string): boolean {
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signature);
  if (!match) {
    return false;
  }

  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  const received = Buffer.from(match[1], 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function verifyMetaVerifyToken(receivedToken: string, expectedToken: string): boolean {
  if (!expectedToken) {
    return false;
  }

  const received = createHash('sha256').update(receivedToken, 'utf8').digest();
  const expected = createHash('sha256').update(expectedToken, 'utf8').digest();
  return timingSafeEqual(received, expected);
}

export function computeTwilioSignature(
  url: string,
  parameters: Record<string, string>,
  authToken: string
): string {
  const signedData = Object.keys(parameters)
    .sort()
    .reduce((data, name) => data + name + parameters[name], url);

  return createHmac('sha1', authToken).update(signedData).digest('base64');
}

export function verifyTwilioSignature(
  url: string,
  parameters: Record<string, string>,
  signature: string,
  authToken: string
): boolean {
  const expected = Buffer.from(computeTwilioSignature(url, parameters, authToken));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
