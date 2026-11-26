import type { Direction } from "../domain/language.ts";

export interface TranslationContext {
  /** Thuật ngữ đã gộp (chung + project; project thắng khi trùng). */
  readonly glossary: ReadonlyArray<{ ja: string; vi: string }>;
  /** Ngữ cảnh tự do: tên project, title issue... */
  readonly hint?: string;
}

/**
 * Port: engine dịch. Adapter thật gọi `claude -p`; adapter fake dùng trong test/e2e.
 * Domain/application KHÔNG được biết adapter nào đang chạy.
 */
export interface Translator {
  translate(text: string, direction: Direction, context: TranslationContext): Promise<string>;
}
