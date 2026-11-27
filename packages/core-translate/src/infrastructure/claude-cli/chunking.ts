import { buildTranslationStdin, type PromptSegment } from "./translation-prompt.ts";

export interface BatchItem extends PromptSegment {
  /** Id của bên gọi, để map ngược. Không bao giờ vào prompt. */
  readonly id: string;
}

export type BatchPlan =
  | { readonly ok: true; readonly batches: ReadonlyArray<ReadonlyArray<BatchItem>> }
  | { readonly ok: false; readonly reason: "input_too_large" };

/**
 * Chia các segment cần gửi (đã che, đã bỏ đoạn rỗng) thành các lần gọi con: xếp tham lam theo thứ tự, mỗi stdin
 * (gồm `<context>` lặp lại) ≤ maxInputChars, không cắt đôi segment. Key sK duy nhất trong cả request (đánh số từ 1).
 * Có segment mà riêng nó đã vượt giới hạn → input_too_large, không lô nào được trả.
 */
export function planBatches(
  segments: ReadonlyArray<{ id: string; masked: string }>,
  hint: string | undefined,
  maxInputChars: number,
): BatchPlan {
  const items: BatchItem[] = segments.map((s, i) => ({ id: s.id, masked: s.masked, key: `s${i + 1}` }));
  const fits = (batch: ReadonlyArray<BatchItem>): boolean => buildTranslationStdin(hint, batch).length <= maxInputChars;
  if (items.some((it) => !fits([it]))) return { ok: false, reason: "input_too_large" };

  const batches: BatchItem[][] = [];
  let current: BatchItem[] = [];
  for (const it of items) {
    if (current.length > 0 && !fits([...current, it])) {
      batches.push(current);
      current = [];
    }
    current.push(it);
  }
  if (current.length > 0) batches.push(current);
  return { ok: true, batches };
}
