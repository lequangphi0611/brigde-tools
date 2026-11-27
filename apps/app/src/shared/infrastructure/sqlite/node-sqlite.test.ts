import { describe, expect, it } from "vitest";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

// Spike 004 (bước 1): Vitest và tsx nạp được node:sqlite bằng import tĩnh lẫn getBuiltinModule; kiểu TS đủ dùng.
describe("node:sqlite dưới Vitest", () => {
  it("nạp bằng process.getBuiltinModule và chạy SELECT sqlite_version()", () => {
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
    const db: DatabaseSyncType = new DatabaseSync(":memory:");
    const row = db.prepare("SELECT sqlite_version() AS v").get() as { v: string };
    expect(row.v).toMatch(/^\d+\.\d+/);
    expect(db.isTransaction).toBe(false);
    db.close();
  });

  it("lỗi SQLite có errcode và errstr", () => {
    const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("NOT SQL");
      expect.unreachable();
    } catch (e) {
      const err = e as { code?: string; errcode?: number; errstr?: string };
      expect(err.code).toBe("ERR_SQLITE_ERROR");
      expect(typeof err.errcode).toBe("number");
      expect(typeof err.errstr).toBe("string");
    }
    db.close();
  });

  it("import tĩnh node:sqlite cũng được Vitest resolve", async () => {
    const mod = await import("node:sqlite");
    expect(typeof mod.DatabaseSync).toBe("function");
  });
});
