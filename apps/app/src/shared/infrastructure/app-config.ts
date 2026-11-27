import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { isAbsoluteFor } from "./data-dir.ts";

/** Cấu hình app tạm ở `<dataDir>/config.json` tới khi 013 có UI (005c). */
export const CONFIG_FILE_NAME = "config.json";

export const DEFAULT_CLAUDE_CLI_CONFIG = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../config/claude-cli.local.json",
);

export interface AppConfig {
  readonly project: {
    readonly owner: string;
    readonly ownerType: "org" | "user";
    readonly number: number;
    readonly statusField: string;
    readonly closedStatuses: readonly string[];
  };
  readonly pollIntervalMin: number;
  readonly claudeCliConfig: string;
}

export type AppConfigError =
  | { readonly code: "config_missing"; readonly path: string }
  | { readonly code: "config_invalid"; readonly field: string };

export type AppConfigResult = { readonly ok: true; readonly config: AppConfig } | { readonly ok: false; readonly error: AppConfigError };

// Khoá lạ bị bỏ qua (zod object mặc định strip) để thêm khoá ở story sau không làm hỏng file cũ.
const schema = z.object({
  project: z.object({
    owner: z.string().min(1),
    ownerType: z.enum(["org", "user"]).default("org"),
    number: z.number().int().positive(),
    statusField: z.string().default("Status"),
    closedStatuses: z.array(z.string().min(1)).default([]),
  }),
  pollIntervalMin: z.number().int().min(1).max(60).default(5),
  claudeCliConfig: z.string().min(1).optional(),
});

export interface LoadAppConfigOptions {
  dataDir: string;
  /** Đọc file UTF-8; ném lỗi có `code` (ENOENT = không có file). */
  readFile: (filePath: string) => string;
  defaultClaudeCliConfig?: string;
  /** Mặc định `process.platform`; quyết định "tuyệt đối" cho `claudeCliConfig`. */
  platform?: string;
}

/** Đọc + kiểm `<dataDir>/config.json`. Lỗi chỉ có mã và đường dẫn field, không bao giờ chứa giá trị đã nhập. */
export function loadAppConfig(options: LoadAppConfigOptions): AppConfigResult {
  const file = path.join(options.dataDir, CONFIG_FILE_NAME);
  let text: string;
  try {
    text = options.readFile(file);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return { ok: false, error: { code: "config_missing", path: file } };
    return { ok: false, error: { code: "config_invalid", field: "(root)" } };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, error: { code: "config_invalid", field: "(root)" } };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issuePath = parsed.error.issues[0]?.path ?? [];
    return { ok: false, error: { code: "config_invalid", field: issuePath.length === 0 ? "(root)" : issuePath.join(".") } };
  }
  const d = parsed.data;
  const platform = options.platform ?? process.platform;
  const claude = d.claudeCliConfig ?? options.defaultClaudeCliConfig ?? DEFAULT_CLAUDE_CLI_CONFIG;
  return {
    ok: true,
    config: {
      project: d.project,
      pollIntervalMin: d.pollIntervalMin,
      // Đường dẫn tương đối tính từ dataDir (không phụ thuộc cwd).
      claudeCliConfig: isAbsoluteFor(platform, claude) ? claude : (platform === "win32" ? path.win32 : path.posix).resolve(options.dataDir, claude),
    },
  };
}
