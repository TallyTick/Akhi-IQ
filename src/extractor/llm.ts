import { OrderExtractor, ExtractionResult, detectLanguageFast } from './extractor.js';
import { SupportedLanguage } from '../templates/templates.js';
import { getConfig } from '../config/env.js';
import { logger } from '../logger/index.js';

export interface LLMExtractorOptions {
  provider?: 'openai' | 'anthropic' | 'gemini' | 'groq' | 'stub' | 'mock';
  apiKey?: string;
  model?: string;
}

export class LLMOrderExtractor implements OrderExtractor {
  private provider: string;
  private apiKey?: string;
  private model?: string;

  constructor(options?: LLMExtractorOptions) {
    const config = getConfig();
    this.provider = options?.provider || config.LLM_PROVIDER || 'stub';
    this.apiKey = options?.apiKey || config.LLM_API_KEY;
    this.model = options?.model || config.LLM_MODEL;
  }

  async extract(text: string): Promise<ExtractionResult> {
    // 1. If configured for real OpenAI or Groq with an API key
    if ((this.provider === 'openai' || this.provider === 'groq') && this.apiKey) {
      try {
        const endpoint =
          this.provider === 'groq'
            ? 'https://api.groq.com/openai/v1/chat/completions'
            : 'https://api.openai.com/v1/chat/completions';
        const model = this.model || (this.provider === 'groq' ? 'llama-3.1-8b-instant' : 'gpt-4o-mini');

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model,
            response_format: { type: 'json_object' },
            temperature: 0.0,
            messages: [
              {
                role: 'system',
                content:
                  'You are an e-commerce assistant. Extract the order number (digits only, between 3 and 10 digits; null if missing, unclear, or invalid). Detect the language (one of: "en", "es", "pt", "hi", "ar"). Return strictly JSON: {"orderNumber": string | null, "language": string, "confidence": number}.',
              },
              { role: 'user', content: text },
            ],
          }),
        });

        if (response.ok) {
          const json: any = await response.json();
          const content = json?.choices?.[0]?.message?.content;
          if (content) {
            const parsed = JSON.parse(content);
            return this.validateAndFormat(parsed, text);
          }
        }
      } catch (err: any) {
        logger.warn({ err: err?.message }, '[LLMOrderExtractor] Provider API failed, falling back to local analysis');
      }
    }

    // 2. Local fallback / stub extractor: Handles typos, messy formats, and multilingual language detection
    return this.fallbackAnalysis(text);
  }

  async extractOrderNumber(text: string): Promise<string | null> {
    const res = await this.extract(text);
    return res.orderNumber;
  }

  private validateAndFormat(raw: any, originalText: string): ExtractionResult {
    let orderNumber: string | null = null;

    if (raw.orderNumber) {
      const digitsOnly = String(raw.orderNumber).replace(/[^0-9]/g, '');
      // Strict pattern validation: strictly 3 to 10 numeric digits
      if (/^[0-9]{3,10}$/.test(digitsOnly)) {
        orderNumber = digitsOnly;
      }
    }

    const validLangs: SupportedLanguage[] = ['en', 'es', 'pt', 'hi', 'ar'];
    const detectedLang = validLangs.includes(raw.language)
      ? (raw.language as SupportedLanguage)
      : detectLanguageFast(originalText);

    return {
      orderNumber,
      language: detectedLang,
      confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.9,
    };
  }

  private fallbackAnalysis(text: string): ExtractionResult {
    const lang = detectLanguageFast(text);

    // Typo tolerance: e.g. "ordr #1001", "ordr1001", "peddo 1001", "orde 1001", "# 1001"
    const orderPatterns = [
      /#\s*([0-9]{3,10})\b/,
      /(?:order|ordr|orde|pedido|peddo|ऑर्डर|طلب)\s*[:#-]?\s*([0-9]{3,10})\b/i,
      /\b([0-9]{4,8})\b/,
    ];

    let extractedNum: string | null = null;
    for (const pat of orderPatterns) {
      const match = text.match(pat);
      if (match) {
        const digits = match[1].replace(/[^0-9]/g, '');
        // Strict pattern check: 3 to 10 digits
        if (/^[0-9]{3,10}$/.test(digits)) {
          extractedNum = digits;
          break;
        }
      }
    }

    return {
      orderNumber: extractedNum,
      language: lang,
      confidence: extractedNum ? 0.85 : 0.4,
    };
  }
}

export const defaultLLMOrderExtractor = new LLMOrderExtractor();
