import { HandoffNotifier, HandoffNotificationData, MonthlySummaryEmailData } from './notifier.js';
import { createTenantLogger } from '../logger/index.js';

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
