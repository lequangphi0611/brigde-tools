import { mkdirSync } from "node:fs";
import path from "node:path";
import { assertSchemaNotTooNew, loadMigrations, runMigrations } from "./migrations.ts";
import { isCorruptionCode, openDatabase, type Database } from "./open-database.ts";
import { StorageError, sqliteErrorInfo } from "./storage-error.ts";

/** Tạo dataDir (nếu là file), mở DB, chạy migration. Lỗi nào cũng ném ngay, không thử lại. */
export function openAppStorage(opts: { path: string }): Database {
  if (opts.path !== ":memory:") {
    try {
      mkdirSync(path.dirname(opts.path), { recursive: true });
    } catch (e) {
      const code = (e as { code?: string }).code;
      throw new StorageError("open_failed", `Không tạo được thư mục dữ liệu${code ? ` (${code})` : ""}`, sqliteErrorInfo(e));
    }
  }
  const migrations = loadMigrationsOrThrow();
  // Không ghi gì (kể cả đổi sang WAL) trước khi quick_check OK và biết schema không quá mới.
  const db = openDatabase(opts.path, { wal: false });
  try {
    assertSchemaNotTooNew(db, migrations.length);
    db.enableWal();
    runMigrations(db, migrations);
  } catch (e) {
    try {
      db.close();
    } catch {
      // bỏ qua: đang báo lỗi gốc
    }
    throw toStorageError(e);
  }
  return db;
}

/** Lỗi đọc thư mục migrations (vd bundle thiếu `migrations/`) cũng thành StorageError, không crash thô. */
function loadMigrationsOrThrow() {
  try {
    return loadMigrations();
  } catch (e) {
    if (e instanceof StorageError) throw e;
    const code = (e as { code?: string }).code;
    throw new StorageError("invalid_migrations", `Không đọc được thư mục migration${code ? ` (${code})` : ""}`);
  }
}

/** Lỗi SQLite thô (vd BUSY khi bật WAL) thành StorageError để main.ts in dòng [storage] thay vì crash. */
function toStorageError(e: unknown): StorageError {
  if (e instanceof StorageError) return e;
  const info = sqliteErrorInfo(e);
  if (isCorruptionCode(info.sqliteCode)) return new StorageError("corrupt", "File DB hỏng hoặc không phải SQLite", info);
  if (info.sqliteCode === undefined) throw e; // lỗi lập trình, không phải SQLite
  return new StorageError("open_failed", "Không chuẩn bị được DB", info);
}
