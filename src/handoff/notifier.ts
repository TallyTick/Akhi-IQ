export interface HandoffNotificationData {
  tenantId: string;
  conversationId: string;
  customerPhone: string;
  customerMessage?: string;
  reason: string;
  summary?: string;
  orderNumber?: string;
  occurredAt?: Date;
  merchantEmail?: string;
}

export interface MonthlySummaryEmailData {
  tenantId: string;
  merchantEmail: string;
  year: number;
  month: number;
  totalConversations: number;
  conversationsHandledAutomatically: number;
  conversationsHandedOff: number;
  estimatedHoursSaved: number;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailProvider {
  sendEmail(message: EmailMessage): Promise<void>;
}

export interface HandoffNotifier {
  notifyMerchant(data: HandoffNotificationData): Promise<void>;
  sendMonthlySummary(data: MonthlySummaryEmailData): Promise<void>;
}
