import { assertValidSettingKey, type SettingStore } from "../../ports/setting-store.port.ts";
import type { Database } from "./open-database.ts";

export class SqliteSettingStore implements SettingStore {
  constructor(private readonly db: Database) {}

  get(key: string): string | null {
    assertValidSettingKey(key);
    const row = this.db.raw.prepare("SELECT value FROM setting WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row ? row.value : null;
  }

  set(key: string, value: string): void {
    assertValidSettingKey(key);
    this.db.raw
      .prepare("INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  delete(key: string): void {
    assertValidSettingKey(key);
    this.db.raw.prepare("DELETE FROM setting WHERE key = ?").run(key);
  }
}
