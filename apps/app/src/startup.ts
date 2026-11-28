import { readFileSync } from "node:fs";
import path from "node:path";
import { dataDirSource, resolveDataDir, type DataDirSource } from "./shared/infrastructure/data-dir.ts";
import { loadAppConfig, type AppConfig, type AppConfigError } from "./shared/infrastructure/app-config.ts";
import { openAppStorage } from "./shared/infrastructure/sqlite/app-storage.ts";
import type { Database } from "./shared/infrastructure/sqlite/open-database.ts";
import { StorageError } from "./shared/infrastructure/sqlite/storage-error.ts";

export type StartupError =
  | { readonly code: "gh_host_unset" }
  | { readonly code: "data_dir_invalid"; readonly data: DataDirSource }
  | AppConfigError;

/** Dòng lỗi khởi động. Dòng `FAIL` không chứa đường dẫn, owner, số project hay GH_HOST; đường dẫn ở dòng riêng. */
export function formatStartupError(error: StartupError): string[] {
  switch (error.code) {
    case "gh_host_unset":
      return ["[startup] FAIL gh_host_unset"];
    case "data_dir_invalid":
      return [`[startup] FAIL data_dir_invalid data=${error.data}`];
    case "config_missing":
      return ["[startup] FAIL config_missing", `[startup] config=${error.path}`];
    case "config_invalid":
      return [`[startup] FAIL config_invalid field=${error.field}`];
  }
}

/** Hai dòng: mã + message (không chứa đường dẫn) rồi `db=` (để tự đọc, không gõ lại). */
export function formatStorageError(e: StorageError, dbPath: string): string[] {
  const mig = e.migration !== undefined ? ` migration=${e.migration}` : "";
  const sqlite = e.sqliteCode !== undefined ? ` sqlite=${e.sqliteCode}` : "";
  return [`[storage] FAIL ${e.reason}${mig}${sqlite}: ${e.message}`, `[storage] db=${dbPath}`];
}

export interface StartupOptions {
  env: Readonly<Record<string, string | undefined>>;
  platform: string;
  homedir: string;
  readFile?: (filePath: string) => string;
  openStorage?: (opts: { path: string }) => Database;
}

export type StartupResult =
  | { readonly ok: true; readonly dataDir: string; readonly config: AppConfig; readonly storage: Database }
  | { readonly ok: false; readonly lines: string[]; readonly exitCode: 1 | 2 };

/** Chuỗi kiểm khởi động nhánh thật (005c): GH_HOST → dataDir → config → storage; dừng ở lỗi đầu tiên. */
export function startup(options: StartupOptions): StartupResult {
  const { env, platform, homedir } = options;
  const userError = (error: StartupError): StartupResult => ({ ok: false, lines: formatStartupError(error), exitCode: 2 });

  if (!env["GH_HOST"]) return userError({ code: "gh_host_unset" });

  let dataDir: string;
  try {
    dataDir = resolveDataDir(env, platform, homedir);
  } catch {
    return userError({ code: "data_dir_invalid", data: dataDirSource(env, platform) });
  }

  const loaded = loadAppConfig({ dataDir, readFile: options.readFile ?? ((p) => readFileSync(p, "utf8")) });
  if (!loaded.ok) return userError(loaded.error);

  const dbPath = path.join(dataDir, "app.db");
  try {
    const storage = (options.openStorage ?? openAppStorage)({ path: dbPath });
    return { ok: true, dataDir, config: loaded.config, storage };
  } catch (e) {
    if (e instanceof StorageError) return { ok: false, lines: formatStorageError(e, dbPath), exitCode: 1 };
    throw e;
  }
}
