import { OrderExtractor, ExtractionResult, detectLanguageFast } from './extractor.js';

export class RegexOrderExtractor implements OrderExtractor {
  async extractOrderNumber(text: string): Promise<string | null> {
    // 1. Matches "#1001" or "# 1001" or arabic/hindi hashes
    const hashMatch = text.match(/#\s*([0-9]{3,10})\b/);
    if (hashMatch) {
      return hashMatch[1];
    }

    // 2. Matches "order 1001", "pedido 1001", "ऑर्डर 1001", "طلب 1001"
    const orderMatch = text.match(
      /(?:order|pedido|ऑर्डर|طلب)\s*[:#-]?\s*([0-9]{3,10})\b/i
    );
    if (orderMatch) {
      return orderMatch[1];
    }

    // 3. Standalone numbers with 4 to 8 digits
    const digitsMatch = text.match(/\b([0-9]{4,8})\b/);
    if (digitsMatch) {
      return digitsMatch[1];
    }

    return null;
  }

  async extract(text: string): Promise<ExtractionResult> {
    const orderNumber = await this.extractOrderNumber(text);
    const language = detectLanguageFast(text);
    return {
      orderNumber,
      language,
      confidence: orderNumber ? 0.9 : 0.0,
    };
  }
}

export const defaultRegexOrderExtractor = new RegexOrderExtractor();
