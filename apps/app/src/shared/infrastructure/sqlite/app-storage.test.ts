import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openAppStorage } from "./app-storage.ts";
import { loadMigrations } from "./migrations.ts";
import { openDatabase } from "./open-database.ts";
import { StorageError } from "./storage-error.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ghit-app-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("openAppStorage", () => {
  it("AC-1: tạo thư mục, file DB, chạy mọi migration", () => {
    const file = path.join(dir, "data", "app.db");
    const db = openAppStorage({ path: file });
    expect(existsSync(file)).toBe(true);
    expect(db.schemaVersion()).toBe(loadMigrations().length);
    const cols = db.raw.prepare("PRAGMA table_info(setting)").all() as Array<{ name: string; pk: number }>;
    expect(cols.map((c) => [c.name, c.pk])).toEqual([["key", 1], ["value", 0]]);
    db.close();
  });

  it(":memory: không đụng hệ thống file", () => {
    const db = openAppStorage({ path: ":memory:" });
    expect(db.schemaVersion()).toBeGreaterThan(0);
    db.close();
  });

  it("AC-5: DB mới hơn app thì schema_too_new, file không đổi", () => {
    const file = path.join(dir, "app.db");
    const raw = openDatabase(file);
    raw.raw.exec("PRAGMA user_version = 5");
    raw.raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    raw.close();
    const sha = () => createHash("sha256").update(readFileSync(file)).digest("hex");
    const before = sha();
    try {
      openAppStorage({ path: file });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(StorageError);
      expect((e as StorageError).reason).toBe("schema_too_new");
    }
    expect(sha()).toBe(before);
  });
});
