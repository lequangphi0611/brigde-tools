import type { DatabaseSync } from "node:sqlite";
import { DatabaseSync as Sqlite } from "node:sqlite";
import { StorageError, sqliteErrorInfo } from "./storage-error.ts";

const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

export interface Database {
  /** Truy cập `DatabaseSync` bên dưới cho repository adapter. */
  readonly raw: DatabaseSync;
  /** Chạy fn trong `BEGIN IMMEDIATE … COMMIT`; ném lỗi thì ROLLBACK và ném lại nguyên vẹn. Không lồng. */
  transaction<T>(fn: () => T): T;
  schemaVersion(): number;
  close(): void;
}

function isCorruptionCode(code: number | undefined): boolean {
  if (code === undefined) return false;
  const primary = code & 0xff;
  return primary === SQLITE_CORRUPT || primary === SQLITE_NOTADB;
}

export function transactionOn(raw: DatabaseSync, fn: () => unknown): unknown {
  if (raw.isTransaction) throw new Error("transaction lồng nhau không được hỗ trợ");
  raw.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    raw.exec("COMMIT");
    return result;
  } catch (e) {
    // node:sqlite để transaction mở khi exec lỗi giữa chừng: rollback tường minh.
    if (raw.isTransaction) raw.exec("ROLLBACK");
    throw e;
  }
}

/**
 * Mở DB (file hoặc ":memory:") với pragma chuẩn và kiểm hỏng. Không xoá/đổi tên/ghi đè file.
 * node:sqlite mở file rác không lỗi ngay; lỗi chỉ xuất hiện ở câu lệnh đầu tiên nên mọi bước nằm trong try.
 */
export function openDatabase(path: string): Database {
  let raw: DatabaseSync | undefined;
  try {
    raw = new Sqlite(path);
    if (path !== ":memory:") raw.exec("PRAGMA journal_mode = WAL");
    raw.exec("PRAGMA foreign_keys = ON");
    raw.exec("PRAGMA busy_timeout = 5000");
    const check = raw.prepare("PRAGMA quick_check").all() as Array<Record<string, unknown>>;
    const ok = check.length === 1 && Object.values(check[0] ?? {})[0] === "ok";
    if (!ok) {
      throw new StorageError("corrupt", "File DB không qua quick_check", { sqliteCode: SQLITE_CORRUPT });
    }
  } catch (e) {
    try {
      raw?.close();
    } catch {
      // bỏ qua: đang báo lỗi gốc
    }
    if (e instanceof StorageError) throw e;
    const info = sqliteErrorInfo(e);
    if (isCorruptionCode(info.sqliteCode)) {
      throw new StorageError("corrupt", "File DB hỏng hoặc không phải SQLite", info);
    }
    throw new StorageError("open_failed", "Không mở được DB", info);
  }
  const db = raw;
  return {
    raw: db,
    transaction: <T>(fn: () => T): T => transactionOn(db, fn) as T,
    schemaVersion: () => {
      const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
      return row.user_version;
    },
    close: () => db.close(),
  };
}
