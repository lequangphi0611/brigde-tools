import type { Database } from "../shared/infrastructure/sqlite/open-database.ts";

/**
 * Xoá mọi hàng của mọi bảng người dùng; giữ schema và user_version. Tạm tắt kiểm khoá ngoại.
 * Xoá cả `sqlite_sequence` (nếu có) để id AUTOINCREMENT bắt đầu lại sau reset.
 */
export function clearAllTables(db: Database): void {
  const tables = db.raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND (name NOT LIKE 'sqlite\\_%' ESCAPE '\\' OR name = 'sqlite_sequence')")
    .all() as Array<{ name: string }>;
  db.raw.exec("PRAGMA foreign_keys = OFF");
  try {
    db.transaction(() => {
      for (const { name } of tables) db.raw.exec(`DELETE FROM "${name.replaceAll('"', '""')}"`);
    });
  } finally {
    db.raw.exec("PRAGMA foreign_keys = ON");
  }
}
