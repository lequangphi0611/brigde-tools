import { spawn } from "node:child_process";
import { GitHubFailure, type GitHubFailureReason } from "../../../../shared/ports/github-gateway.port.ts";
import { classifyGhFailure } from "./gh-failure.ts";

// Chạy `gh api graphql --input -` (ADR-0010; mẫu runner an toàn của ADR-0003). Không shell, query + biến chỉ đi qua
// stdin (owner, số project, cursor, id không bao giờ ở argv hay trong chuỗi query), có timeout, giới hạn stdout.
// Mọi lỗi ném `GitHubFailure` không chứa stderr gốc (có thể có hostname/owner).

export interface GhCliConfig {
  /** Mặc định "gh" (tìm trong PATH; Windows: gh.exe). Test truyền process.execPath + argsPrefix. */
  readonly command: string;
  readonly argsPrefix: readonly string[];
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  /** Thêm vào process.env (test dùng cho fake gh). Ba biến cố định luôn thắng. */
  readonly env?: Readonly<Record<string, string>>;
  /** Nhận stderr gốc của gh (có thể chứa hostname/owner). Chỉ dùng cho `--raw` do người dùng chủ động bật. */
  readonly onStderr?: (text: string) => void;
}

export const DEFAULT_GH_CLI_CONFIG: GhCliConfig = {
  command: "gh",
  argsPrefix: [],
  timeoutMs: 60_000,
  maxStdoutBytes: 32 * 1024 * 1024,
};

export interface GhGraphqlRequest {
  readonly operationName: string;
  readonly query: string;
  readonly variables: Readonly<Record<string, unknown>>;
}

export interface GhGraphqlResult {
  /** `data` của phản hồi GraphQL (object không null). */
  readonly data: Record<string, unknown>;
  /** Có `errors` đi kèm `data` (lỗi một phần, vd. id không còn tồn tại). */
  readonly partial: boolean;
  /** Chỉ là mã reason (từ stderr + errors) khi partial; không chứa văn bản lỗi. Gateway dùng trước khi kết luận project_not_found. */
  readonly failureHint?: GitHubFailureReason;
}

interface Finished {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const STDERR_MAX = 8_000;

/** Ném `GitHubFailure`. Lỗi một phần (exit ≠ 0 nhưng stdout có JSON `data`) không ném mà trả `partial: true`. */
export async function runGhCli(config: GhCliConfig, request: GhGraphqlRequest): Promise<GhGraphqlResult> {
  const body = JSON.stringify({ operationName: request.operationName, query: request.query, variables: request.variables });
  const done = await spawnGh(config, body);
  if (config.onStderr && done.stderr) config.onStderr(done.stderr);
  const parsed = parseJson(done.stdout);
  const data = dataOf(parsed);
  if (data) {
    const partial = done.code !== 0 || hasErrors(parsed);
    const errors = isObject(parsed) && hasErrors(parsed) ? JSON.stringify(parsed.errors) : "";
    const hint = partial ? classifyGhFailure(`${done.stderr}\n${errors}`) : null;
    return { data, partial, ...(hint ? { failureHint: hint } : {}) };
  }

  const text = `${done.stderr}\n${done.stdout}`;
  if (done.code !== 0) throw new GitHubFailure(classifyGhFailure(text) ?? "process_failed", `exit=${done.code}`);
  // exit 0 nhưng không có data: JSON có errors thì phân loại theo errors, còn lại là output hỏng.
  if (isObject(parsed) && hasErrors(parsed)) throw new GitHubFailure(classifyGhFailure(JSON.stringify(parsed.errors)) ?? "process_failed");
  throw new GitHubFailure("bad_output");
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function dataOf(parsed: unknown): Record<string, unknown> | undefined {
  return isObject(parsed) && isObject(parsed.data) ? parsed.data : undefined;
}

function hasErrors(parsed: unknown): boolean {
  return isObject(parsed) && Array.isArray(parsed.errors) && parsed.errors.length > 0;
}

function spawnGh(config: GhCliConfig, stdin: string): Promise<Finished> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(config.command, [...config.argsPrefix, "api", "graphql", "--input", "-"], {
        env: { ...process.env, ...config.env, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1" },
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      reject(new GitHubFailure(isEnoent(e) ? "gh_not_found" : "process_failed"));
      return;
    }
    const out: Buffer[] = [];
    let size = 0;
    let err = "";
    let timedOut = false;
    let overflow = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, config.timeoutMs);
    const fail = (f: GitHubFailure) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(f);
    };
    child.stdout.on("data", (b: Buffer) => {
      if (overflow) return;
      size += b.length;
      if (size > config.maxStdoutBytes) {
        overflow = true;
        child.kill("SIGKILL");
      } else out.push(b);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (s: string) => {
      err = (err + s).slice(-STDERR_MAX);
    });
    child.on("error", (e) => fail(new GitHubFailure(isEnoent(e) ? "gh_not_found" : "process_failed")));
    child.on("close", (code) => {
      if (timedOut) return fail(new GitHubFailure("timeout"));
      if (overflow) return fail(new GitHubFailure("bad_output", "stdout_too_large"));
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out).toString("utf8"), stderr: err });
    });
    child.stdin.on("error", () => {}); // gh có thể thoát trước khi đọc hết; 'close' sẽ báo
    child.stdin.end(stdin, "utf8");
  });
}

function isEnoent(e: unknown): boolean {
  return isObject(e) && e.code === "ENOENT";
}
