import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "./open-database.ts";
import { StorageError } from "./storage-error.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ghit-open-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const pragma = (db: ReturnType<typeof openDatabase>, name: string) =>
  Object.values(db.raw.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>)[0];

async function expectCorrupt(file: string) {
  const before = sha(file);
  const filesBefore = readdirSync(dir).sort();
  let caught: unknown;
  try {
    openDatabase(file);
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(StorageError);
  const err = caught as StorageError;
  expect(err.reason).toBe("corrupt");
  expect(err.message).not.toMatch(/garbage/);
  expect(sha(file)).toBe(before);
  expect(readdirSync(dir).sort()).toEqual(filesBefore);
  return err;
}

describe("openDatabase: file hỏng (AC-6)", () => {
  it("file rác 4 KB", async () => {
    const f = path.join(dir, "app.db");
    writeFileSync(f, "garbage".repeat(600).slice(0, 4096));
    const err = await expectCorrupt(f);
    expect(err.sqliteCode).toBeTypeOf("number");
  });

  it("DB hợp lệ bị ghi đè byte giữa file", async () => {
    const f = path.join(dir, "app.db");
    const db = openDatabase(f);
    db.raw.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    const ins = db.raw.prepare("INSERT INTO t (v) VALUES (?)");
    for (let i = 0; i < 2000; i++) ins.run("x".repeat(100) + i);
    db.raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
    rmSync(`${f}-wal`, { force: true });
    rmSync(`${f}-shm`, { force: true });
    const buf = readFileSync(f);
    buf.fill(0xff, 8192, 8192 + 4096);
    writeFileSync(f, buf);
    await expectCorrupt(f);
  });
});

describe("openDatabase: pragma (AC-7)", () => {
  it("file: wal, foreign_keys, busy_timeout", () => {
    const db = openDatabase(path.join(dir, "app.db"));
    expect(pragma(db, "journal_mode")).toBe("wal");
    expect(pragma(db, "foreign_keys")).toBe(1);
    expect(pragma(db, "busy_timeout") as number).toBeGreaterThanOrEqual(5000);
    db.close();
  });

  it(":memory: vẫn foreign_keys = 1, không lỗi", () => {
    const db = openDatabase(":memory:");
    expect(pragma(db, "foreign_keys")).toBe(1);
    expect(db.schemaVersion()).toBe(0);
    db.close();
  });
});

describe("transaction (AC-11)", () => {
  const setup = () => {
    const db = openDatabase(":memory:");
    db.raw.exec("CREATE TABLE t (k TEXT PRIMARY KEY) STRICT");
    return db;
  };
  const count = (db: ReturnType<typeof openDatabase>) =>
    (db.raw.prepare("SELECT count(*) c FROM t").get() as { c: number }).c;

  it("commit và trả giá trị", () => {
    const db = setup();
    const v = db.transaction(() => {
      db.raw.exec("INSERT INTO t VALUES ('a')");
      db.raw.exec("INSERT INTO t VALUES ('b')");
      return 42;
    });
    expect(v).toBe(42);
    expect(count(db)).toBe(2);
  });

  it("ném lỗi thì rollback và ném lại nguyên vẹn", () => {
    const db = setup();
    const boom = new Error("boom");
    expect(() =>
      db.transaction(() => {
        db.raw.exec("INSERT INTO t VALUES ('a')");
        throw boom;
      }),
    ).toThrow(boom);
    expect(count(db)).toBe(0);
    expect(db.raw.isTransaction).toBe(false);
  });

  it("transaction lồng thì ném Error và rollback transaction ngoài", () => {
    const db = setup();
    expect(() =>
      db.transaction(() => {
        db.raw.exec("INSERT INTO t VALUES ('a')");
        db.transaction(() => 1);
      }),
    ).toThrow(Error);
    expect(count(db)).toBe(0);
    expect(db.raw.isTransaction).toBe(false);
  });
});
