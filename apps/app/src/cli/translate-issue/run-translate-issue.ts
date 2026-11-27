import { readdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLI_CONFIG_FIELDS, hasTranslatableText, protect, TranslationFailure, type CachingObserver, type TranslationRequest, type Translator } from "@app/core-translate";
import { openRealTranslationRuntime, type RealTranslationRuntime } from "../../composition-root.ts";
import { dataDirSource, resolveDataDir } from "../../shared/infrastructure/data-dir.ts";
import { StorageError } from "../../shared/infrastructure/sqlite/storage-error.ts";
import { countJapaneseChars, decodeInputBytes, parseIssueJson } from "./issue-input.ts";
import { formatStatusLine, type StatusFields } from "./status-line.ts";

export const USAGE = `Cách dùng:
  pnpm translate-issue <file.json> [--config <path>] [--out <file>]
  pnpm translate-issue --help

  <file.json>  title + body của issue, xuất bằng: cmd /c "gh issue view <số> --repo <owner/repo> --json title,body > issue.json"
  --config     cấu hình Claude CLI (mặc định: config/claude-cli.local.json trong repo)
  --out        ghi bản dịch ra file UTF-8 có BOM; stdout chỉ còn dòng trạng thái
`;

const DEFAULT_CONFIG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../config/claude-cli.local.json");

export interface Sink {
  write(chunk: string): void;
}

export interface RunTranslateIssueOptions {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  /** Thư mục người dùng đứng khi gõ lệnh; đường dẫn tương đối tính theo đây. */
  cwd: string;
  platform?: string;
  homedir?: string;
  tmpdir?: string;
  stdout: Sink;
  stderr: Sink;
}

type Parsed = { help: true } | { file: string; config?: string; out?: string } | { usage: true };

function parseArgv(argv: readonly string[]): Parsed {
  const args = argv.filter((a) => a !== "--");
  let file: string | undefined;
  let config: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--help" || a === "-h") return { help: true };
    if (a === "--config" || a === "--out") {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) return { usage: true };
      if (a === "--config") config = v;
      else out = v;
      i++;
    } else if (a.startsWith("-") || file !== undefined) {
      return { usage: true };
    } else {
      file = a;
    }
  }
  if (file === undefined) return { usage: true };
  return { file, ...(config !== undefined ? { config } : {}), ...(out !== undefined ? { out } : {}) };
}

/** Giá trị `code` an toàn từ lỗi Node/SQLite; không có hoặc lạ thì bỏ. */
function safeCode(e: unknown): string | undefined {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === "string" && /^[A-Za-z0-9_]+$/.test(c) ? c : undefined;
}

function sqliteErrcode(e: unknown): number | undefined {
  const c = (e as { errcode?: unknown } | null)?.errcode;
  return typeof c === "number" && Number.isSafeInteger(c) && c >= 0 ? c : undefined;
}

function countTmpLeft(dir: string): number {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith("ghit-ai-")).length;
  } catch {
    return 0;
  }
}

/** Điều phối `translate-issue` (003b). Trả exit code; không đụng `process`. */
export async function runTranslateIssue(options: RunTranslateIssueOptions): Promise<number> {
  const { env, cwd, stdout, stderr } = options;
  const platform = options.platform ?? process.platform;
  const homedir = options.homedir ?? os.homedir();
  const tmpdir = options.tmpdir ?? os.tmpdir();
  const fields: StatusFields = {};

  const finish = (exit: number, outcome: "OK" | "FAIL", code?: string): number => {
    stdout.write(formatStatusLine({ outcome, ...(code !== undefined ? { code } : {}), fields }) + "\n");
    return exit;
  };
  const fail = (exit: number, code: string, extra: StatusFields = {}): number => {
    Object.assign(fields, extra);
    return finish(exit, "FAIL", code);
  };

  // 1. argv, đọc file, giải mã, parse. Lỗi ở đây thì chưa mở DB, chưa đọc cấu hình CLI.
  const parsed = parseArgv(options.argv);
  if ("help" in parsed) {
    stdout.write(USAGE);
    return 0;
  }
  if ("usage" in parsed) {
    stderr.write(USAGE);
    return fail(2, "usage");
  }
  const filePath = path.resolve(cwd, parsed.file);
  const configPath = parsed.config !== undefined ? path.resolve(cwd, parsed.config) : DEFAULT_CONFIG;
  const outPath = parsed.out !== undefined ? path.resolve(cwd, parsed.out) : undefined;

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch (e) {
    const code = safeCode(e);
    return fail(2, (e as { code?: string }).code === "ENOENT" ? "input_not_found" : "input_unreadable", code ? { code } : {});
  }
  const decoded = decodeInputBytes(bytes);
  if ("error" in decoded) return fail(2, decoded.error);
  fields.enc = decoded.enc;
  const issue = parseIssueJson(decoded.text);
  if ("error" in issue) return fail(2, issue.error);
  fields.jaChars = countJapaneseChars(issue.title) + countJapaneseChars(issue.body);

  const request: TranslationRequest = {
    direction: { from: "ja", to: "vi" },
    segments: [
      { id: "title", text: issue.title },
      { id: "body", text: issue.body },
    ],
    context: { glossary: [] },
  };
  const translatable = request.segments.filter((s) => hasTranslatableText(protect(s.text).masked));
  fields.srcChars = translatable.reduce((n, s) => n + s.text.length, 0);
  fields.segments = translatable.length;

  // 2. dataDir và storage.
  let dataDir: string;
  try {
    dataDir = resolveDataDir(env, platform, homedir);
  } catch {
    return fail(2, "data_dir_invalid", { data: dataDirSource(env, platform) });
  }
  fields.data = dataDirSource(env, platform);

  // 3. Đếm cache/engine qua observer và wrapInner; không đổi hành vi dịch.
  let engineCalls = 0;
  let cacheWarn: string | undefined;
  const observer: CachingObserver = {
    lookedUp: (s) => {
      fields.hits = s.hits;
      fields.misses = s.misses;
    },
    cacheFailed: (stage, error) => {
      if (cacheWarn !== undefined) return;
      const code = sqliteErrcode(error);
      cacheWarn = `warn:${stage}${code !== undefined ? `/sqlite=${code}` : ""}`;
    },
  };
  const afterRun = (): void => {
    fields.engine = engineCalls > 0 ? "called" : "skipped";
    fields.cache = cacheWarn ?? "ok";
    fields.tmpLeft = countTmpLeft(tmpdir);
  };

  // 4. Mở storage + lắp translator thật — composition-root quyết định adapter.
  let runtime: RealTranslationRuntime;
  try {
    runtime = openRealTranslationRuntime({
      dataDir,
      configPath,
      observer,
      wrapInner: (inner): Translator => ({
        translate: (r) => {
          engineCalls++;
          return inner.translate(r);
        },
      }),
    });
  } catch (e) {
    return failFromError(e);
  }
  const { translator, storage } = runtime;

  // 5. Dịch, in kết quả.
  try {
    const t0 = performance.now();
    let result;
    try {
      result = await translator.translate(request);
    } finally {
      fields.ms = Math.round(performance.now() - t0);
    }
    afterRun();
    const textOf = (id: string): string => result.segments.find((s) => s.id === id)?.text ?? "";
    const block = `=== title ===\n${textOf("title")}\n=== body ===\n${textOf("body")}\n`;
    if (outPath === undefined) {
      stdout.write(block);
    } else {
      try {
        await writeFile(outPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(block, "utf8")]));
      } catch (e) {
        const code = safeCode(e);
        return fail(1, "output_write", code ? { code } : {});
      }
    }
    return finish(0, "OK");
  } catch (e) {
    afterRun();
    return failFromError(e);
  } finally {
    try {
      storage.close();
    } catch {
      // đang kết thúc; không để lỗi đóng che kết quả
    }
  }

  function failFromError(e: unknown): number {
    if (e instanceof StorageError) {
      const extra: StatusFields = {};
      if (e.migration !== undefined) extra.migration = e.migration;
      if (e.sqliteCode !== undefined) extra.sqlite = e.sqliteCode;
      return fail(1, `storage:${e.reason}`, extra);
    }
    if (e instanceof TranslationFailure) {
      const extra: StatusFields = {};
      if (e.detail !== undefined && /^[a-z_]+$/.test(e.detail)) extra.detail = e.detail;
      if (e.field !== undefined && CLI_CONFIG_FIELDS.some((f) => f === e.field)) extra.field = e.field;
      return fail(1, `translate:${e.reason}`, extra);
    }
    const name = e instanceof Error && /^[A-Za-z0-9_]+$/.test(e.name) ? e.name : undefined;
    return fail(1, "internal", name ? { code: name } : {});
  }
}

/** Lớp ngoài cùng cho `main`: lỗi không lường trước vẫn ra một dòng trạng thái `internal`, không in message/stack. */
export async function runTranslateIssueSafely(options: RunTranslateIssueOptions): Promise<number> {
  try {
    return await runTranslateIssue(options);
  } catch (e) {
    const name = e instanceof Error && /^[A-Za-z0-9_]+$/.test(e.name) ? e.name : undefined;
    try {
      options.stdout.write(formatStatusLine({ outcome: "FAIL", code: "internal", fields: name ? { code: name } : {} }) + "\n");
    } catch {
      // stdout hỏng: chỉ còn exit code
    }
    return 1;
  }
}
