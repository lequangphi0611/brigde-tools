// Khoá cache bản dịch theo đoạn (spec 003, ADR-0009): logic thuần, không I/O.

import { createHash } from "node:crypto"; // chỉ tính băm thuần, không I/O
import { glossaryVersion, relevantTerms, type Glossary } from "./glossary.ts";
import type { Direction } from "./language.ts";
import { protect } from "./protected-spans.ts";

/** Phiên bản engine dịch: mẫu dịch và model đã cấu hình (giá trị cờ `--model`, "" nếu không khai báo). */
export interface EngineVersion {
  readonly promptVersion: string;
  readonly configuredModel: string;
}

export interface TranslationCacheKey {
  /** sha256 hex (64 ký tự) của text gốc, UTF-8, không chuẩn hoá. */
  readonly sourceHash: string;
  /** Dạng "ja-vi". */
  readonly direction: string;
  /** `glossaryVersion` của thuật ngữ liên quan của riêng đoạn. */
  readonly glossaryVersion: string;
  readonly promptVersion: string;
  readonly configuredModel: string;
}

/** `hint` và model thực tế không vào khoá. */
export function translationCacheKey(
  text: string,
  direction: Direction,
  glossary: Glossary,
  engineVersion: EngineVersion,
): TranslationCacheKey {
  return {
    sourceHash: createHash("sha256").update(text, "utf8").digest("hex"),
    direction: `${direction.from}-${direction.to}`,
    glossaryVersion: glossaryVersion(relevantTerms(glossary, [protect(text).masked], direction)),
    promptVersion: engineVersion.promptVersion,
    configuredModel: engineVersion.configuredModel,
  };
}

/** Chuỗi khoá không nhập nhằng: hai khoá bằng nhau ⇔ chuỗi bằng nhau. */
export function cacheKeyString(key: TranslationCacheKey): string {
  return JSON.stringify([key.sourceHash, key.direction, key.glossaryVersion, key.promptVersion, key.configuredModel]);
}
