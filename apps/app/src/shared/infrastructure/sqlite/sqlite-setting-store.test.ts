import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadMigrations, migrate } from "./migrations.ts";
import { openDatabase } from "./open-database.ts";
import { SqliteSettingStore } from "./sqlite-setting-store.ts";

const KEY = "notification.pausedUntil";

function fresh() {
  const db = openDatabase(":memory:");
  migrate(db);
  return { db, store: new SqliteSettingStore(db) };
}
const rows = (db: ReturnType<typeof openDatabase>) =>
  (db.raw.prepare("SELECT count(*) n FROM setting").get() as { n: number }).n;

describe("migration 0001 (AC-1 một phần)", () => {
  it("tạo bảng setting với key là khoá chính, schemaVersion = số migration cao nhất", () => {
    const { db } = fresh();
    expect(db.schemaVersion()).toBe(loadMigrations().length);
    const cols = db.raw.prepare("PRAGMA table_info(setting)").all() as Array<{ name: string; pk: number }>;
    expect(cols.map((c) => c.name)).toEqual(["key", "value"]);
    expect(cols.find((c) => c.name === "key")?.pk).toBe(1);
  });
});

describe("SqliteSettingStore (AC-8)", () => {
  it("get chưa có → null; set ghi đè chỉ một hàng", () => {
    const { db, store } = fresh();
    expect(store.get(KEY)).toBeNull();
    store.set(KEY, "2026-01-01T10:00:00.000Z");
    store.set(KEY, "2026-01-01T11:00:00.000Z");
    expect(store.get(KEY)).toBe("2026-01-01T11:00:00.000Z");
    expect(rows(db)).toBe(1);
  });

  it("giữ nguyên Unicode, ký tự đặc biệt, xuống dòng", () => {
    const { store } = fresh();
    const v = '課題「ログイン」— tiếng Việt có dấu ✓ "quote" \n dòng 2';
    store.set("tracking.note", v);
    expect(store.get("tracking.note")).toBe(v);
  });

  it("delete hai lần không lỗi", () => {
    const { store } = fresh();
    store.set(KEY, "x");
    store.delete(KEY);
    store.delete(KEY);
    expect(store.get(KEY)).toBeNull();
  });

  it("khoá sai mẫu → Error, không ghi gì", () => {
    const { db, store } = fresh();
    const bad = ["", "pausedUntil", "Notification.x", "notification.", `notification.${"a".repeat(101)}`];
    for (const k of bad) {
      expect(() => store.get(k), k).toThrow(Error);
      expect(() => store.set(k, "v"), k).toThrow(Error);
      expect(() => store.delete(k), k).toThrow(Error);
    }
    expect(rows(db)).toBe(0);
    store.set(`notification.${"a".repeat(100)}`, "ok");
    expect(rows(db)).toBe(1);
  });
});

describe("bền qua khởi động lại (AC-9)", () => {
  it("đóng rồi mở lại cùng file, không migration nào chạy lại", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ghit-set-"));
    try {
      const file = path.join(dir, "app.db");
      const first = openDatabase(file);
      expect(migrate(first).length).toBeGreaterThan(0);
      new SqliteSettingStore(first).set(KEY, "X");
      first.close();

      const second = openDatabase(file);
      expect(migrate(second)).toEqual([]);
      expect(new SqliteSettingStore(second).get(KEY)).toBe("X");
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
