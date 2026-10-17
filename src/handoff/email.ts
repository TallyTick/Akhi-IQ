import { getConfig } from '../config/env.js';
import { createTenantLogger } from '../logger/index.js';
import { EmailMessage, EmailProvider, HandoffNotifier, HandoffNotificationData, MonthlySummaryEmailData } from './notifier.js';
import { ResendEmailProvider } from './resend.js';

export class EmailHandoffStub implements HandoffNotifier {
  public notifications: HandoffNotificationData[] = [];
  public monthlySummaries: MonthlySummaryEmailData[] = [];

  async notifyMerchant(data: HandoffNotificationData): Promise<void> {
    const log = createTenantLogger(data.tenantId);
    this.notifications.push(data);

    log.info(
      {
        conversationId: data.conversationId,
        reason: data.reason,
      },
      '[EmailHandoffStub] Handing off customer conversation to merchant support team'
    );
  }

  async sendMonthlySummary(data: MonthlySummaryEmailData): Promise<void> {
    const log = createTenantLogger(data.tenantId);
    this.monthlySummaries.push(data);

    log.info(
      {
        period: `${data.year}-${String(data.month).padStart(2, '0')}`,
        handledAutomatically: data.conversationsHandledAutomatically,
        handedOff: data.conversationsHandedOff,
        hoursSaved: data.estimatedHoursSaved,
      },
      '[EmailHandoffStub] Monthly automation summary report dispatched'
    );
  }

  public clear(): void {
    this.notifications = [];
    this.monthlySummaries = [];
  }

  public getLastNotification(): HandoffNotificationData | undefined {
    return this.notifications[this.notifications.length - 1];
  }

  public getLastMonthlySummary(): MonthlySummaryEmailData | undefined {
    return this.monthlySummaries[this.monthlySummaries.length - 1];
  }
}

export const defaultEmailHandoffStub = new EmailHandoffStub();

export class EmailHandoffNotifier implements HandoffNotifier {
  private readonly lastAlertSentAt = new Map<string, number>();
  private readonly pendingAlerts = new Map<string, Promise<void>>();

  constructor(private readonly emailProvider: EmailProvider) {}

  async notifyMerchant(data: HandoffNotificationData): Promise<void> {
    if (!data.merchantEmail) {
      throw new Error('Merchant handoff email is not configured');
    }

    const now = Date.now();
    const lastSentAt = this.lastAlertSentAt.get(data.conversationId);
    if (lastSentAt !== undefined && now - lastSentAt < 10 * 60 * 1000) {
      return;
    }

    const pendingAlert = this.pendingAlerts.get(data.conversationId);
    if (pendingAlert) {
      await pendingAlert;
      return;
    }

    const message = buildHandoffEmail(data);
    const sending = this.emailProvider.sendEmail(message).then(() => {
      this.lastAlertSentAt.set(data.conversationId, Date.now());
    });
    this.pendingAlerts.set(data.conversationId, sending);

    try {
      await sending;
    } finally {
      if (this.pendingAlerts.get(data.conversationId) === sending) {
        this.pendingAlerts.delete(data.conversationId);
      }
    }
  }

  async sendMonthlySummary(data: MonthlySummaryEmailData): Promise<void> {
    await this.emailProvider.sendEmail(buildMonthlySummaryEmail(data));
  }
}

export function createDefaultHandoffNotifier(): HandoffNotifier {
  const config = getConfig();
  if (config.EMAIL_PROVIDER === 'resend') {
    return new EmailHandoffNotifier(
      new ResendEmailProvider(config.RESEND_API_KEY!, config.EMAIL_FROM!)
    );
  }
  return defaultEmailHandoffStub;
}

export function buildHandoffEmail(data: HandoffNotificationData): EmailMessage {
  const orderLabel = data.orderNumber ? `order #${data.orderNumber.replace(/^#/, '')}` : 'your order';
  const subject = `Customer needs help - ${orderLabel}`;
  const occurredAt = (data.occurredAt || new Date()).toISOString();
  const message = data.customerMessage || '(No message provided)';
  const rows = [
    ['Reason', data.reason],
    ['Customer phone', data.customerPhone],
    ['Last message', message],
    ...(data.orderNumber ? [['Order number', `#${data.orderNumber.replace(/^#/, '')}`]] : []),
    ['Time', occurredAt],
  ];
  const text = rows.map(([label, value]) => `${label}: ${value}`).join('\n');
  const html = `<h2>Customer handoff requested</h2><dl>${rows
    .map(([label, value]) => `<dt><strong>${escapeHtml(label)}</strong></dt><dd>${escapeHtml(value)}</dd>`)
    .join('')}</dl>`;

  return { to: data.merchantEmail || '', subject, text, html };
}

export function buildMonthlySummaryEmail(data: MonthlySummaryEmailData): EmailMessage {
  const period = `${data.year}-${String(data.month).padStart(2, '0')}`;
  const rows: Array<[string, string | number]> = [
    ['Reporting period', period],
    ['Total conversations', data.totalConversations],
    ['Handled automatically', data.conversationsHandledAutomatically],
    ['Handed off to support', data.conversationsHandedOff],
    ['Estimated hours saved', data.estimatedHoursSaved],
  ];
  const text = `Monthly automation summary\n${rows.map(([label, value]) => `${label}: ${value}`).join('\n')}`;
  const html = `<h2>Monthly automation summary</h2><dl>${rows
    .map(([label, value]) => `<dt><strong>${escapeHtml(label)}</strong></dt><dd>${escapeHtml(String(value))}</dd>`)
    .join('')}</dl>`;
  return {
    to: data.merchantEmail,
    subject: `Monthly automation summary - ${period}`,
    text,
    html,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
