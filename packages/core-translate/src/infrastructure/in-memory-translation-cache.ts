import { cacheKeyString, type TranslationCacheKey } from "../domain/translation-cache-key.ts";
import type { CachedTranslation, TranslationCache } from "../application/translation-cache.port.ts";

/** Cache trong process, cho unit test và tool dịch chat. App không dùng (ADR-0008: chế độ fake dùng SQLite thật). */
export class InMemoryTranslationCache implements TranslationCache {
  private readonly entries = new Map<string, CachedTranslation>();

  async lookup(keys: ReadonlyArray<TranslationCacheKey>): Promise<ReadonlyMap<string, CachedTranslation>> {
    const found = new Map<string, CachedTranslation>();
    for (const key of keys) {
      const id = cacheKeyString(key);
      const value = this.entries.get(id);
      if (value) found.set(id, { text: value.text, model: value.model });
    }
    return found;
  }

  async store(entries: ReadonlyArray<{ key: TranslationCacheKey; value: CachedTranslation }>): Promise<void> {
    for (const { key, value } of entries) this.entries.set(cacheKeyString(key), { text: value.text, model: value.model });
  }

  /** Số mục hiện có (tiện cho test). */
  get size(): number {
    return this.entries.size;
  }
}
