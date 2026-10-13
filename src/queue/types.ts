export interface WhatsAppMessagePayload {
  eventId: string;
  from: string;
  to: string;
  body: string;
  whatsappMessageId?: string;
  timestamp?: string;
  rawPayload?: any;
}

export const WHATSAPP_QUEUE_NAME = 'whatsapp-inbound';
