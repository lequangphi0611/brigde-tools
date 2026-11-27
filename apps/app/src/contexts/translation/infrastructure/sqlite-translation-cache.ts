import { cacheKeyString, type CachedTranslation, type TranslationCache, type TranslationCacheKey } from "@app/core-translate";
import type { Clock } from "../../../shared/ports/clock.port.ts";
import type { Database } from "../../../shared/infrastructure/sqlite/open-database.ts";

const KEY_COLUMNS = "source_hash, direction, glossary_version, prompt_version, configured_model";
const CHUNK = 150; // 5 tham số mỗi khoá; giữ dưới giới hạn biến của SQLite

/** Adapter `TranslationCache` trên SQLite (spec 003, ADR-0009). `created_at` là ISO UTC từ `Clock` (ADR-0008). Không lưu text nguồn. */
export class SqliteTranslationCache implements TranslationCache {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  async lookup(keys: ReadonlyArray<TranslationCacheKey>): Promise<ReadonlyMap<string, CachedTranslation>> {
    const found = new Map<string, CachedTranslation>();
    for (let i = 0; i < keys.length; i += CHUNK) {
      const chunk = keys.slice(i, i + CHUNK);
      const where = chunk.map(() => "(source_hash = ? AND direction = ? AND glossary_version = ? AND prompt_version = ? AND configured_model = ?)").join(" OR ");
      const params = chunk.flatMap((k) => [k.sourceHash, k.direction, k.glossaryVersion, k.promptVersion, k.configuredModel]);
      const rows = this.db.raw.prepare(`SELECT ${KEY_COLUMNS}, text, model FROM translation WHERE ${where}`).all(...params) as Array<{
        source_hash: string;
        direction: string;
        glossary_version: string;
        prompt_version: string;
        configured_model: string;
        text: string;
        model: string | null;
      }>;
      for (const r of rows) {
        const key = {
          sourceHash: r.source_hash,
          direction: r.direction,
          glossaryVersion: r.glossary_version,
          promptVersion: r.prompt_version,
          configuredModel: r.configured_model,
        };
        found.set(cacheKeyString(key), { text: r.text, model: r.model });
      }
    }
    return found;
  }

  async store(entries: ReadonlyArray<{ key: TranslationCacheKey; value: CachedTranslation }>): Promise<void> {
    if (entries.length === 0) return;
    const createdAt = this.clock.now().toISOString();
    this.db.transaction(() => {
      const stmt = this.db.raw.prepare(
        `INSERT INTO translation (${KEY_COLUMNS}, text, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (${KEY_COLUMNS}) DO UPDATE SET text = excluded.text, model = excluded.model, created_at = excluded.created_at`,
      );
      for (const { key, value } of entries) {
        stmt.run(key.sourceHash, key.direction, key.glossaryVersion, key.promptVersion, key.configuredModel, value.text, value.model, createdAt);
      }
    });
  }
}
