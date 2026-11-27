import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CliConfig } from "./cli-config.ts";

// Chạy Claude CLI cài trên máy người dùng (ADR-0003; chiến lược lấy từ p-quizzz). Dùng chung cho mọi tính năng AI.
// An toàn: không shell, nội dung đi qua stdin (không bao giờ ở argv), cwd là thư mục tạm rỗng (không CLAUDE.md,
// không file repo), model không có tool hay MCP server.

export type CliFailureReason = "timeout" | "bad_output" | "process_failed";

/** Một lần chạy thất bại. Adapter map sang lỗi của port mình. `stderrTail` chỉ để ghi log local khi chẩn đoán, không hiển thị UI. */
export class CliRunFailure extends Error {
  readonly hasCustomMessage: boolean;
  constructor(
    readonly reason: CliFailureReason,
    message?: string,
    readonly stderrTail: string = "",
  ) {
    super(message ?? reason);
    this.name = "CliRunFailure";
    this.hasCustomMessage = message !== undefined;
  }
}

/** Luôn nối SAU args của người dùng. */
export function fixedArgs(schema: object, systemPrompt: string): string[] {
  return [
    "-p",
    "--tools", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--output-format", "json",
    "--json-schema", JSON.stringify(schema),
    "--system-prompt", systemPrompt,
  ];
}

const MAX_OUTPUT = 2_000_000;
const STDERR_TAIL = 4_000;
const START_FAILED = "Không chạy được Claude CLI (kiểm tra cấu hình)";

type Envelope = { type?: unknown; is_error?: boolean; structured_output?: unknown; result?: unknown; modelUsage?: Record<string, unknown> };

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isObject(v: unknown): v is Envelope {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Với `--verbose`, output là mảng event; envelope là item `result` cuối cùng. */
function resultIn(v: unknown): Envelope | undefined {
  if (Array.isArray(v)) {
    for (let i = v.length - 1; i >= 0; i--) {
      const e: unknown = v[i];
      if (isObject(e) && e.type === "result") return e;
    }
    return undefined;
  }
  return isObject(v) ? v : undefined;
}

/** Envelope trong stdout. Script bọc CLI có thể in log riêng → lấy dòng cuối chứa object `type: "result"`. */
export function findEnvelope(stdout: string): Envelope | undefined {
  const whole = resultIn(tryParse(stdout.trim()));
  if (whole) return whole;
  const lines = stdout.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.startsWith("{") && !line.startsWith("[")) continue;
    const found = resultIn(tryParse(line));
    if (found?.type === "result") return found;
  }
  return undefined;
}

/** Kết quả `--output-format json`: structured output, hoặc JSON trong text result. Chưa validate theo schema. */
export function readCliResult(stdout: string): { body: unknown; model: string | null } {
  const envelope = findEnvelope(stdout);
  if (!envelope) throw new CliRunFailure("bad_output");
  if (envelope.is_error) throw new CliRunFailure("process_failed");
  let body = envelope.structured_output;
  if (body === undefined && typeof envelope.result === "string") {
    const m = /\{[\s\S]*\}/.exec(envelope.result);
    try {
      body = m ? JSON.parse(m[0]) : undefined;
    } catch {
      body = undefined;
    }
  }
  const model = envelope.modelUsage ? (Object.keys(envelope.modelUsage)[0] ?? null) : null;
  return { body, model };
}

export interface RunClaudeCliInput {
  config: Pick<CliConfig, "command" | "args" | "timeoutSeconds"> & Partial<Pick<CliConfig, "env">>;
  schema: object;
  systemPrompt: string;
  /** Toàn bộ user prompt. Chỉ đi qua stdin. */
  stdin: string;
}

/** Chạy CLI một lần từ thư mục tạm rỗng. Ném `CliRunFailure`. */
export async function runClaudeCli(input: RunClaudeCliInput): Promise<{ body: unknown; model: string | null }> {
  const { config } = input;
  const cwd = await mkdtemp(join(tmpdir(), "ghit-ai-"));
  try {
    const stdout = await run(config.command, [...config.args, ...fixedArgs(input.schema, input.systemPrompt)], input.stdin, cwd, config.timeoutSeconds * 1000, config.env ?? {});
    return readCliResult(stdout);
  } finally {
    // Dọn dẹp là phụ: trên Windows thư mục có thể còn bị giữ (hook/process con của CLI chưa thoát, antivirus) → EPERM.
    // Không được để lỗi dọn dẹp thay thế kết quả dịch hoặc CliRunFailure thật. Thư mục tạm rỗng sót lại là vô hại.
    await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

function run(command: string, args: string[], stdin: string, cwd: string, timeoutMs: number, env: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, { cwd, env: { ...process.env, ...env }, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch {
      reject(new CliRunFailure("process_failed", START_FAILED));
      return;
    }
    const out: Buffer[] = [];
    let size = 0;
    let err = "";
    let timedOut = false;
    let overflow = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (b: Buffer) => {
      if (overflow) return;
      size += b.length;
      if (size > MAX_OUTPUT) {
        overflow = true; // output quá lớn là output hỏng, không phải lỗi process
        child.kill("SIGKILL");
      } else out.push(b);
    });
    // Giữ đuôi stderr để chẩn đoán (Task Scheduler: PATH, xác thực, encoding). Không đưa ra UI.
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (s: string) => {
      err = (err + s).slice(-STDERR_TAIL);
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new CliRunFailure("process_failed", START_FAILED, err));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new CliRunFailure("timeout", undefined, err));
      if (overflow) return reject(new CliRunFailure("bad_output", undefined, err));
      if (code !== 0) return reject(new CliRunFailure("process_failed", undefined, err));
      resolve(Buffer.concat(out).toString("utf8"));
    });
    child.stdin.on("error", () => {}); // CLI có thể thoát trước khi đọc hết; 'close' sẽ báo
    child.stdin.end(stdin, "utf8");
  });
}
