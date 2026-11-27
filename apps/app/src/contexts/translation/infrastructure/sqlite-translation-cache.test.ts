import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTranslationCacheContract } from "@app/core-translate/testing";
import { cacheKeyString, type TranslationCacheKey } from "@app/core-translate";
import { openAppStorage } from "../../../shared/infrastructure/sqlite/app-storage.ts";
import { openDatabase } from "../../../shared/infrastructure/sqlite/open-database.ts";
import { loadMigrations, runMigrations } from "../../../shared/infrastructure/sqlite/migrations.ts";
import { ControllableClock } from "../../../test-harness/fakes.ts";
import { clearAllTables } from "../../../test-harness/clear-storage.ts";
import { SqliteTranslationCache } from "./sqlite-translation-cache.ts";

runTranslationCacheContract("SqliteTranslationCache", {
  create: () => new SqliteTranslationCache(openAppStorage({ path: ":memory:" }), new ControllableClock()),
});

const key: TranslationCacheKey = { sourceHash: "b".repeat(64), direction: "ja-vi", glossaryVersion: "g1-x", promptVersion: "fake/1", configuredModel: "" };

describe("AC-15 bảng translation", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "ghit-tcache-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("schemaVersion = 2, đúng các cột, không có cột chứa text nguồn", () => {
    const db = openAppStorage({ path: ":memory:" });
    expect(db.schemaVersion()).toBe(2);
    const cols = (db.raw.prepare("PRAGMA table_info(translation)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toEqual(["source_hash", "direction", "glossary_version", "prompt_version", "configured_model", "text", "model", "created_at"]);
  });

  it("created_at lấy từ Clock, bền qua đóng/mở lại, clearAllTables xoá hết", async () => {
    const file = path.join(dir, "app.db");
    const clock = new ControllableClock();
    clock.set("2026-03-01T08:00:00Z");
    let db = openAppStorage({ path: file });
    await new SqliteTranslationCache(db, clock).store([{ key, value: { text: "[vi] x", model: "fake" } }]);
    expect(db.raw.prepare("SELECT created_at FROM translation").get()).toEqual({ created_at: "2026-03-01T08:00:00.000Z" });
    db.close();

    db = openAppStorage({ path: file });
    const found = await new SqliteTranslationCache(db, clock).lookup([key]);
    expect(found.get(cacheKeyString(key))).toEqual({ text: "[vi] x", model: "fake" });
    clearAllTables(db);
    expect((db.raw.prepare("SELECT count(*) n FROM translation").get() as { n: number }).n).toBe(0);
    db.close();
  });

  it("migration 0002 áp dụng lên DB đã ở phiên bản 1", () => {
    const db = openDatabase(":memory:");
    const all = loadMigrations();
    expect(runMigrations(db, all.slice(0, 1))).toEqual([1]);
    expect(runMigrations(db, all)).toEqual([2]);
    expect(db.schemaVersion()).toBe(2);
  });
});
