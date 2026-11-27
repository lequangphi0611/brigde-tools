import type { Direction } from "../domain/language.ts";

export interface TranslationContext {
  /** Thuật ngữ đã gộp (chung + project; project thắng khi trùng). */
  readonly glossary: ReadonlyArray<{ ja: string; vi: string }>;
  /** Ngữ cảnh tự do: tên project, title issue... Chỉ là ngữ cảnh, không được dịch. */
  readonly hint?: string;
}

/** Một đoạn cần dịch. `id` do bên gọi đặt và là chuỗi mờ với core-translate (vd "title", "comment:<nodeId>"). */
export interface TranslationSegment {
  readonly id: string;
  readonly text: string;
}

export interface TranslationRequest {
  readonly direction: Direction;
  readonly segments: ReadonlyArray<TranslationSegment>;
  readonly context: TranslationContext;
}

export interface TranslationResult {
  /** Cùng tập id, cùng thứ tự với request. */
  readonly segments: ReadonlyArray<TranslationSegment>;
  /** Model đã dịch; null nếu không phải gọi engine nào. */
  readonly model: string | null;
}

/**
 * Port: engine dịch theo lô (ADR-0006). Adapter thật gọi `claude -p`; adapter fake dùng trong test/e2e.
 * Lỗi vận hành ném `TranslationFailure`; request sai (id rỗng/trùng) là lỗi lập trình, ném Error thường.
 * Không có kết quả một phần.
 */
export interface Translator {
  translate(request: TranslationRequest): Promise<TranslationResult>;
}
