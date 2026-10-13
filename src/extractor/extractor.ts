import { SupportedLanguage } from '../templates/templates.js';

export interface ExtractionResult {
  orderNumber: string | null;
  language: SupportedLanguage;
  confidence: number;
}

export interface OrderExtractor {
  extractOrderNumber(text: string): Promise<string | null>;
  extract(text: string): Promise<ExtractionResult>;
}

export type DetectedIntent =
  | 'human_request'
  | 'order_status'
  | 'refund_or_cancel'
  | 'angry_complaint'
  | 'unclear';

const HUMAN_INTENT_PATTERNS = [
  /\bhuman\b/i,
  /\bagent\b/i,
  /\bsupport\b/i,
  /\brepresentative\b/i,
  /\btalk to a person\b/i,
  /\breal person\b/i,
  /\bspeak to someone\b/i,
  /\bcustomer service\b/i,
  /\batendente\b/i,
  /\bhumano\b/i,
  /\bagente\b/i,
  /\bpersona\b/i,
  /\bप्रतिनिधि\b/,
  /\bइंसान\b/,
  /\bबात करनी\b/,
  /\bعميل\b/,
  /\bشخص\b/,
  /\bإنسان\b/,
  /\bخدمة العملاء\b/,
];

const REFUND_CANCEL_PATTERNS = [
  /\brefund\b/i,
  /\bcancel\b/i,
  /\breturn\b/i,
  /\breembolso\b/i,
  /\bcancelar\b/i,
  /\bdevoluci[oó]n\b/i,
  /\bdevolder\b/i,
  /\brestitui[cç][aã]o\b/i,
  /\bवापसी\b/,
  /\bरिफंड\b/,
  /\bरद्द\b/,
  /\bاسترداد\b/,
  /\bإلغاء\b/,
  /\bترجيع\b/,
];

const ANGRY_COMPLAINT_PATTERNS = [
  /\bscam\b/i,
  /\bfraud\b/i,
  /\bterrible\b/i,
  /\bhorrible\b/i,
  /\bwaste of money\b/i,
  /\bsue\b/i,
  /\blawyer\b/i,
  /\bestafa\b/i,
  /\bfraude\b/i,
  /\bp[eé]simo\b/i,
  /\bgolpe\b/i,
  /\bधोखा\b/,
  /\bघटिया\b/,
  /\bاحتيال\b/,
  /\bنصب\b/,
  /\bسيء جدا\b/,
];

const ORDER_STATUS_PATTERNS = [
  /where('?s|\s+is)\s+(my\s+)?order/i,
  /order\s+status/i,
  /track(\s+my)?\s+order/i,
  /track(\s+my)?\s+package/i,
  /status\s+of\s+(my\s+)?order/i,
  /when\s+will\s+(my\s+)?order\s+arrive/i,
  /order\s*#?\s*\d{3,10}/i,
  /#\d{3,10}/,
  /has\s+(my\s+)?order\s+shipped/i,
  /delivery\s+update/i,
  /d[oó]nde\s+est[aá]\s+(mi\s+)?pedido/i,
  /rastrear\s+(mi\s+)?pedido/i,
  /estado\s+del\s+pedido/i,
  /onde\s+est[aá]\s+(o\s+meu|meu)?\s+pedido/i,
  /rastrear\s+(o\s+)?pedido/i,
  /status\s+do\s+pedido/i,
  /मेरा\s+ऑर्डर\s+कहाँ\s+है/i,
  /ऑर्डर\s+स्टेटस/i,
  /ऑर्डर\s+ट्रैक/i,
  /أين\s+طلبي/i,
  /تتبع\s+الطلب/i,
  /حالة\s+الطلب/i,
];

export function detectIntent(text: string): DetectedIntent {
  const clean = text.trim();

  // 1. Check for refund or cancellation request
  for (const pattern of REFUND_CANCEL_PATTERNS) {
    if (pattern.test(clean)) {
      return 'refund_or_cancel';
    }
  }

  // 2. Check for angry complaints
  for (const pattern of ANGRY_COMPLAINT_PATTERNS) {
    if (pattern.test(clean)) {
      return 'angry_complaint';
    }
  }

  // 3. Check for human agent escalation request
  for (const pattern of HUMAN_INTENT_PATTERNS) {
    if (pattern.test(clean)) {
      return 'human_request';
    }
  }

  // 4. Check for order status intent
  for (const pattern of ORDER_STATUS_PATTERNS) {
    if (pattern.test(clean)) {
      return 'order_status';
    }
  }

  return 'unclear';
}

export function detectLanguageFast(text: string): SupportedLanguage {
  // Arabic Unicode block
  if (/[\u0600-\u06FF]/.test(text)) {
    return 'ar';
  }
  // Devanagari (Hindi) Unicode block
  if (/[\u0900-\u097F]/.test(text)) {
    return 'hi';
  }
  // Spanish keywords
  if (/\b(dónde|donde|pedido|rastrear|estado|hola|gracias|correo|por favor|ayuda)\b/i.test(text)) {
    return 'es';
  }
  // Portuguese keywords
  if (/\b(onde|meu|pedido|rastreamento|olá|obrigado|ajuda|está|atendimento)\b/i.test(text)) {
    return 'pt';
  }

  return 'en';
}

export function extractEmail(text: string): string | null {
  const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
  const match = text.match(emailRegex);
  return match ? match[1].toLowerCase().trim() : null;
}
