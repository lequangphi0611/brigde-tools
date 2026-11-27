import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMigrations, migrate, parseMigrationFileNames, runMigrations, type Migration } from "./migrations.ts";
import { openDatabase } from "./open-database.ts";
import { StorageError } from "./storage-error.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ghit-mig-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const m1: Migration = { number: 1, name: "0001-a", sql: "CREATE TABLE a (id INTEGER PRIMARY KEY, v TEXT) STRICT;" };
const m2: Migration = { number: 2, name: "0002-probe", sql: "CREATE TABLE probe (id INTEGER PRIMARY KEY) STRICT;" };
const tableExists = (db: ReturnType<typeof openDatabase>, name: string) =>
  db.raw.prepare("SELECT 1 x FROM sqlite_master WHERE type='table' AND name=?").get(name) !== undefined;

function catchStorage(fn: () => unknown): StorageError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(StorageError);
    return e as StorageError;
  }
  throw new Error("không ném lỗi");
}

describe("AC-2 chỉ chạy migration chưa áp dụng", () => {
  it("giữ dữ liệu cũ, chạy lại không làm gì", () => {
    const db = openDatabase(path.join(dir, "app.db"));
    expect(runMigrations(db, [m1])).toEqual([1]);
    db.raw.exec("INSERT INTO a (v) VALUES ('giữ')");
    expect(runMigrations(db, [m1, m2])).toEqual([2]);
    expect(db.schemaVersion()).toBe(2);
    expect(db.raw.prepare("SELECT v FROM a").get()).toMatchObject({ v: "giữ" });
    expect(runMigrations(db, [m1, m2])).toEqual([]);
    expect(db.schemaVersion()).toBe(2);
    db.close();
  });
});

describe("AC-3 migration lỗi rollback trọn vẹn", () => {
  it("giữ migration trước, không chạy migration sau", () => {
    const db = openDatabase(":memory:");
    runMigrations(db, [m1]);
    const bad: Migration = {
      number: 2,
      name: "0002-bad",
      sql: "CREATE TABLE probe (id INTEGER); THIS IS NOT SQL;",
    };
    const m3: Migration = { number: 3, name: "0003-c", sql: "CREATE TABLE c (id INTEGER) STRICT;" };
    const err = catchStorage(() => runMigrations(db, [m1, bad, m3]));
    expect(err.reason).toBe("migration_failed");
    expect(err.migration).toBe(2);
    expect(err.sqliteCode).toBeTypeOf("number");
    expect(err.message).not.toMatch(/NOT SQL/);
    expect(db.schemaVersion()).toBe(1);
    expect(tableExists(db, "probe")).toBe(false);
    expect(tableExists(db, "c")).toBe(false);
    expect(db.raw.isTransaction).toBe(false);
    expect(db.raw.prepare("SELECT count(*) n FROM a").get()).toMatchObject({ n: 0 });
  });
});

describe("AC-4 danh sách migration không hợp lệ", () => {
  it("thuần: số trùng, thiếu số, tên sai mẫu", () => {
    for (const names of [
      ["0001-a.sql", "0002-b.sql", "0002-c.sql"],
      ["0001-a.sql", "0003-c.sql"],
      ["0001-a.sql", "2-setting.sql"],
      ["0001-a.sql", "0002_Setting.sql"],
      ["0002-b.sql"],
    ]) {
      expect(catchStorage(() => parseMigrationFileNames(names)).reason).toBe("invalid_migrations");
    }
  });

  it("bỏ qua file không có đuôi .sql, sắp theo số", () => {
    expect(parseMigrationFileNames(["README.md", "0002-b.sql", "0001-a.sql"]).map((p) => p.number)).toEqual([1, 2]);
  });

  it("thư mục lỗi: từ chối trước khi áp dụng bất cứ gì", () => {
    const mdir = path.join(dir, "m");
    mkdirSync(mdir);
    writeFileSync(path.join(mdir, "0001-a.sql"), m1.sql);
    writeFileSync(path.join(mdir, "0003-c.sql"), "CREATE TABLE c (id INTEGER);");
    writeFileSync(path.join(mdir, "README.md"), "bỏ qua");
    const db = openDatabase(":memory:");
    expect(catchStorage(() => migrate(db, mdir)).reason).toBe("invalid_migrations");
    expect(db.schemaVersion()).toBe(0);
    expect(tableExists(db, "a")).toBe(false);
  });

  it("thư mục hợp lệ có README.md vẫn chạy", () => {
    const mdir = path.join(dir, "m");
    mkdirSync(mdir);
    writeFileSync(path.join(mdir, "0001-a.sql"), m1.sql);
    writeFileSync(path.join(mdir, "README.md"), "x");
    expect(loadMigrations(mdir)).toHaveLength(1);
    const db = openDatabase(":memory:");
    expect(migrate(db, mdir)).toEqual([1]);
  });

  it("runner cũng từ chối danh sách không liên tục", () => {
    const db = openDatabase(":memory:");
    expect(catchStorage(() => runMigrations(db, [m1, { ...m2, number: 3 }])).reason).toBe("invalid_migrations");
    expect(db.schemaVersion()).toBe(0);
  });
});

describe("AC-5 DB mới hơn app (mức runner)", () => {
  it("schema_too_new, không chạy gì", () => {
    const db = openDatabase(":memory:");
    db.raw.exec("PRAGMA user_version = 5");
    expect(catchStorage(() => runMigrations(db, [m1])).reason).toBe("schema_too_new");
    expect(db.schemaVersion()).toBe(5);
    expect(tableExists(db, "a")).toBe(false);
  });
});
