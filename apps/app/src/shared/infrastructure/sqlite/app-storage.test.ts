import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

  const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");

  it("S1: DB rollback-journal có user_version lớn hơn → schema_too_new, file không đổi byte nào", () => {
    const file = path.join(dir, "old.db");
    const raw = new DatabaseSync(file);
    raw.exec("CREATE TABLE x (a TEXT); PRAGMA user_version = 5");
    raw.close();
    const before = sha(file);
    expect(() => openAppStorage({ path: file })).toThrowError(expect.objectContaining({ reason: "schema_too_new" }));
    expect(sha(file)).toBe(before);
    expect(existsSync(`${file}-wal`)).toBe(false);
  });

  it("S1: DB rollback-journal hỏng giữa file → corrupt, file không đổi", () => {
    const file = path.join(dir, "bad.db");
    const raw = new DatabaseSync(file);
    raw.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    const ins = raw.prepare("INSERT INTO t (v) VALUES (?)");
    for (let i = 0; i < 2000; i++) ins.run("x".repeat(100) + i);
    raw.close();
    const buf = readFileSync(file);
    buf.fill(0xff, 8192, 8192 + 4096);
    writeFileSync(file, buf);
    const before = sha(file);
    expect(() => openAppStorage({ path: file })).toThrowError(expect.objectContaining({ reason: "corrupt" }));
    expect(sha(file)).toBe(before);
  });

  it("lỗi bật WAL (kết nối khác giữ khoá đọc) → StorageError open_failed, file không đổi", () => {
    const file = path.join(dir, "locked.db");
    const holder = new DatabaseSync(file);
    holder.exec("CREATE TABLE t (a TEXT); INSERT INTO t VALUES ('x')");
    const before = sha(file);
    holder.exec("BEGIN");
    holder.prepare("SELECT * FROM t").all();
    try {
      openAppStorage({ path: file });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(StorageError);
      expect((e as StorageError).reason).toBe("open_failed");
      expect((e as StorageError).sqliteCode).toBe(5);
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }
    expect(sha(file)).toBe(before);
  }, 20_000);

  it("DB mới tạo bằng openAppStorage ở chế độ wal", () => {
    const db = openAppStorage({ path: path.join(dir, "n.db") });
    expect(db.raw.prepare("PRAGMA journal_mode").get()).toMatchObject({ journal_mode: "wal" });
    db.close();
  });
});
