import { logger } from '../logger/index.js';
import { retryWithBackoff } from '../utils/retry.js';
import { SentMessageResult, WhatsAppProvider } from './provider.js';

interface MetaErrorDetails {
  code?: number | string;
  message?: string;
}

export class MetaWhatsAppError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = 'MetaWhatsAppError';
  }
}

export class MetaWhatsAppProvider implements WhatsAppProvider {
  private readonly messagesUrl: string;

  constructor(
    private readonly accessToken: string,
    phoneNumberId: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.messagesUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
  }

  async sendMessage(to: string, _from: string, body: string): Promise<SentMessageResult> {
    try {
      return await retryWithBackoff(() => this.sendOnce(to, body), {
        name: 'MetaWhatsAppSend',
        shouldRetry: (error) => error instanceof MetaWhatsAppError && error.retryable,
      });
    } catch (error) {
      if (error instanceof MetaWhatsAppError) {
        throw new MetaWhatsAppError(error.message, false);
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
          authorization: `Bearer ${this.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to.replace(/\D/g, ''),
          type: 'text',
          text: { body },
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new MetaWhatsAppError('Meta WhatsApp network request failed', true);
    }

    if (!response.ok) {
      const details = await this.readErrorDetails(response);
      const safeCode = this.redactSensitive(details.code, to, body);
      const safeMessage = this.redactSensitive(details.message, to, body);
      logger.error({
        code: safeCode,
        message: safeMessage,
      }, 'Meta WhatsApp request failed');

      const detailText = [
        safeCode !== undefined ? `code=${safeCode}` : undefined,
        safeMessage !== undefined ? `message=${safeMessage}` : undefined,
      ].filter((part) => part !== undefined).join(', ');
      throw new MetaWhatsAppError(
        `Meta WhatsApp request failed with status ${response.status}${detailText ? `: ${detailText}` : ''}`,
        response.status >= 500
      );
    }

    let result: { messages?: Array<{ id?: unknown }> };
    try {
      result = await response.json() as { messages?: Array<{ id?: unknown }> };
    } catch {
      throw new MetaWhatsAppError('Meta WhatsApp returned an invalid response', false);
    }

    const messageId = result.messages?.[0]?.id;
    if (typeof messageId !== 'string' || !messageId) {
      throw new MetaWhatsAppError('Meta WhatsApp response did not include a message ID', false);
    }

    return { messageId };
  }

  private async readErrorDetails(response: Response): Promise<MetaErrorDetails> {
    try {
      const payload = await response.json() as {
        error?: { code?: unknown; message?: unknown };
      };
      const error = payload?.error;
      return {
        ...(typeof error?.code === 'number' || typeof error?.code === 'string' ? { code: error.code } : {}),
        ...(typeof error?.message === 'string' ? { message: error.message } : {}),
      };
    } catch {
      return {};
    }
  }

  private redactSensitive(
    value: number | string | undefined,
    recipient: string,
    messageBody: string
  ): number | string | undefined {
    if (typeof value !== 'string') {
      return value;
    }

    const sensitiveValues = [this.accessToken, recipient, recipient.replace(/\D/g, ''), messageBody].filter(Boolean);
    const redacted = sensitiveValues.reduce(
      (safeValue, secret) => safeValue.split(secret).join('[REDACTED]'),
      value
    );
    return redacted.replace(/\+?\d[\d\s().-]{5,}\d/g, '[REDACTED]');
  }
}
