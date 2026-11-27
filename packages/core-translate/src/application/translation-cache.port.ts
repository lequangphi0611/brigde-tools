import type { TranslationCacheKey } from "../domain/translation-cache-key.ts";

/** Bản dịch đã lưu của một đoạn. Không lưu text nguồn. */
export interface CachedTranslation {
  /** Bản dịch đã khôi phục phần giữ nguyên, đúng như `Translator` trả. */
  readonly text: string;
  /** Model thực tế đã dịch; null nếu không biết. */
  readonly model: string | null;
}

/**
 * Port: kho bản dịch theo đoạn (spec 003, ADR-0009). Adapter: `InMemoryTranslationCache` (trong package), SQLite (app).
 * `lookup` trả map theo `cacheKeyString(key)`, chỉ gồm khoá có; `store` là upsert, khoá trùng thì ghi đè.
 */
export interface TranslationCache {
  lookup(keys: ReadonlyArray<TranslationCacheKey>): Promise<ReadonlyMap<string, CachedTranslation>>;
  store(entries: ReadonlyArray<{ key: TranslationCacheKey; value: CachedTranslation }>): Promise<void>;
}
