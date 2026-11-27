// Glossary hai tầng (spec 002, ADR-0007): logic thuần, không I/O. Tầng chung và tầng project là hai danh sách đầu vào;
// kết quả là `Glossary` đã chuẩn hoá, khoá duy nhất, sắp theo `termKey`.

import { createHash } from "node:crypto"; // chỉ tính băm thuần, không I/O
import { defuseFakeTags } from "./fake-tag.ts";
import type { Direction } from "./language.ts";

export interface GlossaryTermInput {
  readonly ja: string;
  readonly vi: string;
  /** Ghi chú cho người dùng; không vào prompt (spec 002, câu hỏi 4). */
  readonly note?: string;
}

/** Glossary đã gộp: đã chuẩn hoá, khoá (`termKey`) duy nhất, sắp theo khoá. */
export type Glossary = ReadonlyArray<{ readonly ja: string; readonly vi: string }>;

/** NFKC → mọi chuỗi khoảng trắng thành một dấu cách → trim. */
export function normalizeTermText(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim();
}

/** Khoá thuật ngữ: hai thuật ngữ trùng ⇔ cùng khoá. Không phân biệt hoa thường. */
export function termKey(ja: string): string {
  return normalizeTermText(ja).toLowerCase();
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Chuẩn hoá và kiểm một tầng. Sai (rỗng, trùng khoá) là lỗi lập trình/dữ liệu → Error thường; message không chứa `vi`. */
function normalizeLayer(terms: ReadonlyArray<{ ja: string; vi: string }>, layer: string): Map<string, { ja: string; vi: string }> {
  const out = new Map<string, { ja: string; vi: string }>();
  terms.forEach((t, index) => {
    const ja = normalizeTermText(t.ja);
    const vi = normalizeTermText(t.vi);
    if (ja === "") throw new Error(`Glossary (${layer}) thuật ngữ #${index}: ja rỗng`);
    if (vi === "") throw new Error(`Glossary (${layer}) thuật ngữ #${index}: vi rỗng`);
    const key = ja.toLowerCase();
    if (out.has(key)) throw new Error(`Glossary (${layer}) có hai thuật ngữ trùng khoá: ${key}`);
    out.set(key, { ja, vi });
  });
  return out;
}

/** Kiểm glossary hợp lệ (dùng cho `context.glossary` của request). Không trả gì; sai thì ném Error. */
export function assertValidGlossary(terms: ReadonlyArray<{ ja: string; vi: string }>): void {
  normalizeLayer(terms, "request");
}

/** Gộp hai tầng; project thắng khi trùng khoá (cả `ja` lẫn `vi` lấy từ project). */
export function mergeGlossary(common: ReadonlyArray<GlossaryTermInput>, project: ReadonlyArray<GlossaryTermInput>): Glossary {
  const merged = normalizeLayer(common, "chung");
  for (const [key, term] of normalizeLayer(project, "project")) merged.set(key, term);
  return [...merged.entries()].sort(([a], [b]) => compareCodeUnits(a, b)).map(([, term]) => term);
}

/**
 * Vô hiệu hoá một `ja`/`vi` trước khi render vào prompt: thẻ giả `source|segment|context|glossary` (kể cả dạng tương đương NFKC)
 * mất dấu mở, và ký tự chỗ giữ `⟦ ⟧` thành `⟨ ⟩` để không giả được chỗ giữ thật. Nhận chuỗi đã chuẩn hoá.
 */
export function neutralizeTerm(s: string): string {
  return defuseFakeTags(s)
    .replaceAll("⟦", "⟨")
    .replaceAll("⟧", "⟩");
}

/**
 * Thuật ngữ liên quan: dạng render của phía nguồn (sau chuẩn hoá, hạ chữ thường) là chuỗi con của text đã che của ít nhất
 * một đoạn. So trên text đã che nên thuật ngữ chỉ nằm trong phần giữ nguyên không được chọn. Giữ thứ tự của `glossary`.
 */
export function relevantTerms(glossary: Glossary, maskedTexts: ReadonlyArray<string>, direction: Direction): Glossary {
  // Chỗ giữ `⟦N⟧` thành "\n": thuật ngữ đã chuẩn hoá không chứa "\n" nên không khớp được vào số của chỗ giữ.
  const haystacks = maskedTexts.map((t) => normalizeTermText(t).toLowerCase().replace(/⟦\d+⟧/g, "\n"));
  return glossary.filter((term) => {
    const needle = neutralizeTerm(normalizeTermText(term[direction.from])).toLowerCase();
    return needle !== "" && haystacks.some((h) => h.includes(needle));
  });
}

/** Phiên bản của một tập thuật ngữ: không đổi khi đổi thứ tự hay dạng full/half-width, đổi khi thêm/xoá/đổi `vi`. */
export function glossaryVersion(terms: Glossary): string {
  assertValidGlossary(terms); // trùng khoá/rỗng → Error, để kết quả không phụ thuộc thứ tự
  const canonical = JSON.stringify(
    terms
      .map((t) => ({ ja: normalizeTermText(t.ja), vi: normalizeTermText(t.vi) }))
      .sort((a, b) => compareCodeUnits(a.ja.toLowerCase(), b.ja.toLowerCase()))
      .map((t) => [t.ja, t.vi]),
  );
  return `g1-${createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 16)}`;
}

export const GLOSSARY_VERSION_EMPTY: string = glossaryVersion([]);
