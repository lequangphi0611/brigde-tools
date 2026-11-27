import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./open-database.ts";
import { StorageError, sqliteErrorInfo } from "./storage-error.ts";

export interface Migration {
  readonly number: number;
  readonly name: string;
  readonly sql: string;
}

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

const FILE_PATTERN = /^(\d{4})-([a-z0-9-]+)\.sql$/;

/** Thuần: từ danh sách tên file trong thư mục migrations → danh sách (số, tên file) đã sắp. Ném `invalid_migrations`. */
export function parseMigrationFileNames(fileNames: readonly string[]): Array<{ number: number; fileName: string }> {
  const parsed: Array<{ number: number; fileName: string }> = [];
  for (const fileName of fileNames) {
    if (!fileName.endsWith(".sql")) continue;
    const match = FILE_PATTERN.exec(fileName);
    if (!match) {
      throw new StorageError("invalid_migrations", `Tên file migration sai mẫu: ${fileName}`);
    }
    parsed.push({ number: Number(match[1]), fileName });
  }
  parsed.sort((a, b) => a.number - b.number);
  assertContiguous(parsed.map((p) => p.number));
  return parsed;
}

function assertContiguous(numbers: readonly number[]): void {
  numbers.forEach((n, i) => {
    if (n === numbers[i - 1]) {
      throw new StorageError("invalid_migrations", `Hai migration cùng số ${n}`);
    }
    if (n !== i + 1) {
      throw new StorageError("invalid_migrations", `Chuỗi migration không liên tục: thiếu số ${i + 1}`);
    }
  });
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const files = parseMigrationFileNames(readdirSync(dir));
  return files.map(({ number, fileName }) => ({
    number,
    name: fileName.replace(/\.sql$/, ""),
    sql: readFileSync(path.join(dir, fileName), "utf8"),
  }));
}

/**
 * Áp dụng các migration chưa chạy theo `PRAGMA user_version`. Mỗi migration một transaction.
 * Trả danh sách số migration vừa áp dụng.
 */
export function runMigrations(db: Database, migrations: readonly Migration[]): number[] {
  const sorted = [...migrations].sort((a, b) => a.number - b.number);
  assertContiguous(sorted.map((m) => m.number));

  const current = db.schemaVersion();
  const latest = sorted.length;
  if (current > latest) {
    throw new StorageError(
      "schema_too_new",
      `DB ở phiên bản schema ${current}, app chỉ biết tới ${latest}`,
    );
  }

  const applied: number[] = [];
  for (const migration of sorted) {
    if (migration.number <= current) continue;
    try {
      db.transaction(() => {
        db.raw.exec(migration.sql);
        db.raw.exec(`PRAGMA user_version = ${migration.number}`);
      });
    } catch (e) {
      throw new StorageError("migration_failed", `Migration ${migration.number} (${migration.name}) lỗi`, {
        migration: migration.number,
        ...sqliteErrorInfo(e),
      });
    }
    applied.push(migration.number);
  }
  return applied;
}

/** Nạp thư mục migrations rồi chạy. */
export function migrate(db: Database, dir: string = MIGRATIONS_DIR): number[] {
  return runMigrations(db, loadMigrations(dir));
}
