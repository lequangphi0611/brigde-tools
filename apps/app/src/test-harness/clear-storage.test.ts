import { describe, expect, it } from "vitest";
import { openDatabase } from "../shared/infrastructure/sqlite/open-database.ts";
import { clearAllTables } from "./clear-storage.ts";

describe("clearAllTables (N3)", () => {
  it("xoá hết hàng của bảng có khoá ngoại, giữ schema, bật lại foreign_keys", () => {
    const db = openDatabase(":memory:");
    db.raw.exec(`
      CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id)) STRICT;
      INSERT INTO parent VALUES (1);
      INSERT INTO child VALUES (1, 1);
      PRAGMA user_version = 3;
    `);
    clearAllTables(db);
    const n = (t: string) => (db.raw.prepare(`SELECT count(*) n FROM ${t}`).get() as { n: number }).n;
    expect(n("parent")).toBe(0);
    expect(n("child")).toBe(0);
    expect(db.schemaVersion()).toBe(3);
    expect(db.raw.prepare("PRAGMA foreign_keys").get()).toMatchObject({ foreign_keys: 1 });
    expect(() => db.raw.exec("INSERT INTO child VALUES (1, 99)")).toThrow();
  });
});
