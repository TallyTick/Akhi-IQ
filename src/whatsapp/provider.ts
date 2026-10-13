export interface SentMessageResult {
  messageId: string;
}

export interface WhatsAppProvider {
  sendMessage(to: string, from: string, body: string): Promise<SentMessageResult>;
}
