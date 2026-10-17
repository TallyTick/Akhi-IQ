import { retryWithBackoff } from '../utils/retry.js';
import { logger } from '../logger/index.js';
import { SentMessageResult, WhatsAppProvider } from './provider.js';

interface TwilioErrorDetails {
  code?: number | string;
  message?: string;
  more_info?: string;
}

export class TwilioWhatsAppError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly details: TwilioErrorDetails = {}
  ) {
    super(message);
    this.name = 'TwilioWhatsAppError';
  }
}

function maskPhoneNumber(value: string): string {
  const visibleDigits = Math.min(4, (value.match(/\d/g) || []).length);
  let digitsToMask = (value.match(/\d/g) || []).length - visibleDigits;
  return value.replace(/\d/g, (digit) => {
    if (digitsToMask > 0) {
      digitsToMask -= 1;
      return '*';
    }
    return digit;
  });
}

function readTwilioErrorDetails(payload: unknown): TwilioErrorDetails {
  if (typeof payload !== 'object' || payload === null) {
    return {};
  }

  const fields = payload as Record<string, unknown>;
  return {
    ...(typeof fields.code === 'number' || typeof fields.code === 'string' ? { code: fields.code } : {}),
    ...(typeof fields.message === 'string' ? { message: fields.message } : {}),
    ...(typeof fields.more_info === 'string' ? { more_info: fields.more_info } : {}),
  };
}

export class TwilioWhatsAppProvider implements WhatsAppProvider {
  private readonly messagesUrl: string;
  private readonly authorization: string;

  constructor(
    accountSid: string,
    authToken: string,
    private readonly whatsAppFrom: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.messagesUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    this.authorization = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
  }

  async sendMessage(to: string, _from: string, body: string): Promise<SentMessageResult> {
    try {
      return await retryWithBackoff(() => this.sendOnce(to, body), {
        name: 'TwilioWhatsAppSend',
        shouldRetry: (error) => error instanceof TwilioWhatsAppError && error.retryable,
      });
    } catch (error) {
      if (error instanceof TwilioWhatsAppError) {
        throw new TwilioWhatsAppError(error.message, false, error.details);
      }
      throw error;
    }
  }

  private async sendOnce(to: string, body: string): Promise<SentMessageResult> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.messagesUrl, {
        method: 'POST',
        headers: {
          authorization: this.authorization,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: `whatsapp:${this.whatsAppFrom}`,
          To: `whatsapp:${to}`,
          Body: body,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new TwilioWhatsAppError('Twilio WhatsApp network request failed', true);
    }

    if (!response.ok) {
      const retryable = response.status >= 500;
      let details: TwilioErrorDetails = {};
      try {
        details = readTwilioErrorDetails(await response.json());
      } catch {
        // Twilio may return a non-JSON error body.
      }

      const from = `whatsapp:${this.whatsAppFrom}`;
      const destination = `whatsapp:${to}`;
      const detailSummary = [
        details.code !== undefined ? `code=${details.code}` : undefined,
        details.message !== undefined ? `message=${details.message}` : undefined,
        details.more_info !== undefined ? `more_info=${details.more_info}` : undefined,
      ].filter((value) => value !== undefined).join(', ');
      const errorMessage = `Twilio WhatsApp request failed with status ${response.status}${detailSummary ? `: ${detailSummary}` : ''}`;

      logger.error({
        status: response.status,
        code: details.code,
        message: details.message,
        more_info: details.more_info,
        from: maskPhoneNumber(from),
        to: maskPhoneNumber(destination),
      }, 'Twilio WhatsApp request failed');

      throw new TwilioWhatsAppError(
        errorMessage,
        retryable,
        details
      );
    }

    let result: { sid?: unknown };
    try {
      result = await response.json() as { sid?: unknown };
    } catch {
      throw new TwilioWhatsAppError('Twilio WhatsApp returned an invalid response', false);
    }

    if (typeof result.sid !== 'string' || !result.sid) {
      throw new TwilioWhatsAppError('Twilio WhatsApp response did not include a message ID', false);
    }

    return { messageId: result.sid };
  }
}
