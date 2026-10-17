import { logger } from '../logger/index.js';
import { retryWithBackoff } from '../utils/retry.js';
import { EmailMessage, EmailProvider } from './notifier.js';

export class ResendEmailError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = 'ResendEmailError';
  }
}

export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async sendEmail(message: EmailMessage): Promise<void> {
    await retryWithBackoff(
      () => this.sendOnce(message),
      {
        name: 'ResendEmailSend',
        shouldRetry: (error) => error instanceof ResendEmailError && error.retryable,
      }
    );
  }

  private async sendOnce(message: EmailMessage): Promise<void> {
    let response: Response;
    try {
      response = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ResendEmailError('Resend email network request failed', true);
    }

    if (!response.ok) {
      logger.error({ status: response.status }, 'Resend email request failed');
      throw new ResendEmailError(
        `Resend email request failed with status ${response.status}`,
        response.status >= 500
      );
    }
  }
}
