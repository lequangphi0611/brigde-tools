import type { TranslationRequest, TranslationResult, Translator } from "../application/translator.port.ts";
import { assertValidTranslationRequest } from "../application/translation-request.ts";
import { hasTranslatableText, protect } from "../domain/protected-spans.ts";

/**
 * Fake xác định (deterministic) cho unit test và e2e: "[vi] <text gốc>".
 * Giống adapter thật: đoạn rỗng hoặc chỉ gồm phần giữ nguyên thì trả text gốc; không có gì để dịch thì model = null.
 */
export class FakeTranslator implements Translator {
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    assertValidTranslationRequest(request);
    let translatedAny = false;
    const segments = request.segments.map((s) => {
      if (!hasTranslatableText(protect(s.text).masked)) return { id: s.id, text: s.text };
      translatedAny = true;
      return { id: s.id, text: `[${request.direction.to}] ${s.text}` };
    });
    return { segments, model: translatedAny ? "fake" : null };
  }
}
