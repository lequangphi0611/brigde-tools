import type { Direction } from "../domain/language.ts";
import type { TranslationContext, Translator } from "../application/translator.port.ts";

/** Fake xác định (deterministic) cho unit test và e2e: "[vi] <text gốc>". */
export class FakeTranslator implements Translator {
  async translate(text: string, direction: Direction, _context: TranslationContext): Promise<string> {
    return `[${direction.to}] ${text}`;
  }
}
