import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkCliConfig } from "./cli-config.ts";
import { fixedArgs, findEnvelope, runClaudeCli } from "./claude-cli-runner.ts";

const FAKE = fileURLToPath(new URL("./testing/fake-claude-cli.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "ghit-cli-test-"));
const schema = { type: "object", properties: { translation: { type: "string" } }, required: ["translation"] };
const SYSTEM = "translate";

function setup(mode: string, timeoutSeconds = 30, env?: Record<string, string>) {
  const record = join(dir, `${mode}-${Math.random()}.jsonl`);
  const config = { command: process.execPath, args: [FAKE, "--fake-mode", mode, "--fake-record", record], timeoutSeconds, ...(env ? { env } : {}) };
  const calls = () => readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { run: (stdin: string) => runClaudeCli({ config, schema, systemPrompt: SYSTEM, stdin }), calls };
}

describe("runClaudeCli", () => {
  it("gửi nội dung qua stdin (không qua argv), cờ an toàn ở cuối, chạy từ thư mục tạm rỗng", async () => {
    const { run, calls } = setup("ok");
    const text = "<source>\nバグを修正してください `npm test`\n</source>";
    await expect(run(text)).resolves.toEqual({ body: { translation: "[vi] バグを修正してください `npm test`" }, model: "fake-model" });
    const [call] = calls();
    expect(call.argv.slice(-fixedArgs(schema, SYSTEM).length)).toEqual(fixedArgs(schema, SYSTEM));
    expect(call.argv[call.argv.indexOf("--tools") + 1]).toBe("");
    expect(call.argv.join(" ")).not.toContain("バグ");
    expect(call.stdin).toBe(text); // UTF-8 tiếng Nhật đi nguyên vẹn
    expect(call.cwd).toMatch(/ghit-ai-/);
  });

  it("truyền biến môi trường trong config cho process CLI", async () => {
    const { run, calls } = setup("ok", 30, { FAKE_ENV_PROBE: "C:\\claude\\settings.json" });
    await run("<source>a</source>");
    expect(calls()[0].envProbe).toBe("C:\\claude\\settings.json");
  });

  it("đọc được envelope khi script bọc in log trước", async () => {
    await expect(setup("wrapped").run("<source>a</source>")).resolves.toMatchObject({ body: { translation: "[vi] a" } });
  });

  it("map lỗi thành lý do ngắn, giữ đuôi stderr để chẩn đoán", async () => {
    await expect(setup("garbage").run("x")).rejects.toMatchObject({ reason: "bad_output" });
    await expect(setup("fail").run("x")).rejects.toMatchObject({ reason: "process_failed", stderrTail: "fake: not logged in\n" });
  });

  it("kill CLI bị treo khi hết thời gian", async () => {
    const started = Date.now();
    await expect(setup("hang", 10).run("x")).rejects.toMatchObject({ reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 20_000);

  it("command không tồn tại → process_failed có thông báo hướng dẫn", async () => {
    await expect(
      runClaudeCli({ config: { command: join(dir, "nope.exe"), args: [], timeoutSeconds: 10 }, schema, systemPrompt: SYSTEM, stdin: "x" }),
    ).rejects.toMatchObject({ reason: "process_failed", message: "Không chạy được Claude CLI (kiểm tra cấu hình)" });
  });
});

describe("findEnvelope", () => {
  it("lấy item result cuối trong mảng event (--verbose)", () => {
    expect(findEnvelope(JSON.stringify([{ type: "system" }, { type: "result", result: "ok" }]))).toEqual({ type: "result", result: "ok" });
  });
});

describe("checkCliConfig", () => {
  it("điền mặc định", () => {
    expect(checkCliConfig({ command: "claude" })).toEqual({ ok: true, config: { command: "claude", args: [], timeoutSeconds: 300, concurrency: 2, maxInputChars: 30_000, env: {} } });
  });
  it("từ chối tên biến môi trường không hợp lệ", () => {
    expect(checkCliConfig({ command: "claude", env: { "BAD-NAME": "x" } }).ok).toBe(false);
  });
  it("từ chối cờ cấp tool hoặc cờ app tự đặt", () => {
    expect(checkCliConfig({ command: "claude", args: ["--dangerously-skip-permissions"] })).toMatchObject({ ok: false });
    expect(checkCliConfig({ command: "claude", args: ["--allowedTools=Bash"] })).toMatchObject({ ok: false });
    expect(checkCliConfig({ command: "claude", args: ["--model", "sonnet"] })).toMatchObject({ ok: true });
  });
  it("trên Windows từ chối .cmd/.bat", () => {
    expect(checkCliConfig({ command: "C:\\npm\\claude.cmd" }, "win32")).toMatchObject({ ok: false });
    expect(checkCliConfig({ command: "C:\\npm\\claude.cmd" }, "linux")).toMatchObject({ ok: true });
  });
});
