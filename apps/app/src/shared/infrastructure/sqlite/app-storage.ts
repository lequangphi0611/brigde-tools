import { mkdirSync } from "node:fs";
import path from "node:path";
import { assertSchemaNotTooNew, loadMigrations, runMigrations } from "./migrations.ts";
import { openDatabase, type Database } from "./open-database.ts";
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
  const migrations = loadMigrations();
  // Không ghi gì (kể cả đổi sang WAL) trước khi quick_check OK và biết schema không quá mới.
  const db = openDatabase(opts.path, { wal: false });
  try {
    assertSchemaNotTooNew(db, migrations.length);
    db.enableWal();
    runMigrations(db, migrations);
  } catch (e) {
    db.close();
    throw e;
  }
  return db;
}
