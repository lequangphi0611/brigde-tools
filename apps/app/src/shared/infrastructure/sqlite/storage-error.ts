export type StorageErrorReason =
  | "open_failed"
  | "corrupt"
  | "invalid_migrations"
  | "migration_failed"
  | "schema_too_new";

export interface StorageErrorDetails {
  migration?: number;
  sqliteCode?: number;
  sqliteMessage?: string;
}

/** Lỗi lưu trữ (ADR-0008). Message không chứa giá trị hàng dữ liệu hay nội dung SQL. */
export class StorageError extends Error {
  readonly reason: StorageErrorReason;
  readonly migration: number | undefined;
  readonly sqliteCode: number | undefined;
  readonly sqliteMessage: string | undefined;

  constructor(reason: StorageErrorReason, message: string, details: StorageErrorDetails = {}) {
    super(message);
    this.name = "StorageError";
    this.reason = reason;
    this.migration = details.migration;
    this.sqliteCode = details.sqliteCode;
    this.sqliteMessage = details.sqliteMessage;
  }
}

/** Trích errcode/errstr từ lỗi của node:sqlite (chỉ lấy hai trường này, không lấy message có thể chứa SQL). */
export function sqliteErrorInfo(e: unknown): { sqliteCode?: number; sqliteMessage?: string } {
  const info: { sqliteCode?: number; sqliteMessage?: string } = {};
  if (typeof e === "object" && e !== null) {
    const { errcode, errstr } = e as { errcode?: unknown; errstr?: unknown };
    if (typeof errcode === "number") info.sqliteCode = errcode;
    if (typeof errstr === "string") info.sqliteMessage = errstr;
  }
  return info;
}
