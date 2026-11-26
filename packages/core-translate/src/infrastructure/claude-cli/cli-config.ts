import { readFile } from "node:fs/promises";
import { z } from "zod";

// Cấu hình cách gọi Claude CLI trên máy người dùng (ADR-0003). Đọc lại mỗi lần dùng → sửa không cần restart.
// Nội dung không bao giờ được log hay trả qua API: lỗi chỉ nói sai gì, không nói file chứa gì.

const CliConfigSchema = z.object({
  /** Đường dẫn TUYỆT ĐỐI tới `claude.exe` hoặc `node` (kèm cli.js ở đầu args). Task Scheduler không có PATH của terminal. */
  command: z.string().trim().min(1),
  args: z.array(z.string()).max(50).default([]),
  timeoutSeconds: z.number().int().min(10).max(1800).default(120),
  concurrency: z.number().int().min(1).max(4).default(2),
  maxInputChars: z.number().int().min(100).max(200_000).default(30_000),
});

export type CliConfig = z.infer<typeof CliConfigSchema>;

// Cờ app tự đặt, hoặc cờ cấp tool/thư mục/plugin/bỏ quyền cho model — nội dung issue là dữ liệu bên thứ ba, model không được có tool.
const FORBIDDEN = [
  "-p", "--print", "--mcp-config", "--tools", "--allowedtools", "--allowed-tools", "--disallowedtools", "--disallowed-tools",
  "--dangerously-skip-permissions", "--allow-dangerously-skip-permissions", "--add-dir", "--plugin-dir", "--agents",
  "--permission-mode", "--system-prompt", "--system-prompt-file", "--append-system-prompt", "--append-system-prompt-file",
  "--json-schema", "--output-format", "--input-format", "--resume", "-r", "--continue", "-c",
];

export type CliConfigResult = { ok: true; config: CliConfig } | { ok: false; problem: string };

/** Kiểm tra thuần, tách khỏi việc đọc file để test được. */
export function checkCliConfig(raw: unknown, platform: NodeJS.Platform = process.platform): CliConfigResult {
  const parsed = CliConfigSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: "Tệp cấu hình Claude CLI sai định dạng" };
  const cfg = parsed.data;
  const bad = cfg.args.find((a) => FORBIDDEN.includes(a.split("=")[0]!.toLowerCase()));
  if (bad) return { ok: false, problem: `Cấu hình Claude CLI không được chứa cờ ${bad.split("=")[0]} (app tự đặt hoặc cờ không an toàn)` };
  // Node từ chối spawn .cmd/.bat khi không có shell, mà shell sẽ parse nội dung → không bao giờ bật shell.
  if (platform === "win32" && /\.(cmd|bat)$/i.test(cfg.command))
    return { ok: false, problem: 'Trên Windows, "command" không được là .cmd/.bat: trỏ tới node (đặt đường dẫn cli.js của Claude Code đầu "args") hoặc tới claude.exe' };
  return { ok: true, config: cfg };
}

export async function loadCliConfig(path: string): Promise<CliConfigResult> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { ok: false, problem: "Chưa có tệp cấu hình Claude CLI" };
  }
  try {
    return checkCliConfig(JSON.parse(text));
  } catch {
    return { ok: false, problem: "Tệp cấu hình Claude CLI không phải JSON hợp lệ" };
  }
}
