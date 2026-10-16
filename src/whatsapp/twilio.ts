import { retryWithBackoff } from '../utils/retry.js';
import { SentMessageResult, WhatsAppProvider } from './provider.js';

export class TwilioWhatsAppError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = 'TwilioWhatsAppError';
  }
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
        throw new TwilioWhatsAppError(error.message, false);
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
      throw new TwilioWhatsAppError(
        `Twilio WhatsApp request failed with status ${response.status}`,
        retryable
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
