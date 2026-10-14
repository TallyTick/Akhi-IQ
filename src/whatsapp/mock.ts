import { WhatsAppProvider, SentMessageResult } from './provider.js';
import { logger } from '../logger/index.js';
import { randomUUID } from 'node:crypto';

export interface RecordedOutboundMessage {
  messageId: string;
  to: string;
  from: string;
  body: string;
  sentAt: Date;
}

export class MockWhatsAppProvider implements WhatsAppProvider {
  public sentMessages: RecordedOutboundMessage[] = [];

  async sendMessage(to: string, from: string, body: string): Promise<SentMessageResult> {
    const messageId = `mock_msg_${randomUUID()}`;
    const record: RecordedOutboundMessage = {
      messageId,
      to,
      from,
      body,
      sentAt: new Date(),
    };

    this.sentMessages.push(record);
    logger.info({ messageId }, '[MockWhatsAppProvider] Outbound WhatsApp message sent');

    return { messageId };
  }

  public clear(): void {
    this.sentMessages = [];
  }

  public getLastMessage(): RecordedOutboundMessage | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  public getMessagesFor(to: string): RecordedOutboundMessage[] {
    const cleanTo = to.replace(/\s+/g, '');
    return this.sentMessages.filter((m) => m.to.replace(/\s+/g, '') === cleanTo);
  }
}

export const defaultMockWhatsAppProvider = new MockWhatsAppProvider();
