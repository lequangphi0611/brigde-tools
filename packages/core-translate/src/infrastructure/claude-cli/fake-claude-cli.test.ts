import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CliRunFailure, runClaudeCli } from "./claude-cli-runner.ts";

const FAKE = fileURLToPath(new URL("./testing/fake-claude-cli.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "ghit-fake-cli-test-"));
const STDIN = '<source>\n<segment id="s1">⟦1⟧ バグ</segment>\n<segment id="s2">修正</segment>\n</source>';

function setup(mode: string, extra: string[] = []) {
  const id = Math.random();
  const record = join(dir, `${mode}-${id}.jsonl`);
  const lock = join(dir, `lock-${id}`);
  const config = { command: process.execPath, args: [FAKE, "--fake-mode", mode, "--fake-record", record, ...extra.map((a) => (a === "LOCK" ? lock : a))], timeoutSeconds: 30 };
  const run = (stdin = STDIN) => runClaudeCli({ config, schema: {}, systemPrompt: "x", stdin });
  const calls = () => readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { run, calls, lock };
}

describe("fake-claude-cli: segment", () => {
  it("ok trả segments '[vi] ' + nội dung, model fake-model", async () => {
    const r = await setup("ok").run();
    expect(r).toEqual({
      body: { segments: [{ id: "s1", translation: "[vi] ⟦1⟧ バグ" }, { id: "s2", translation: "[vi] 修正" }] },
      model: "fake-model",
    });
  });

  it("batch-missing bỏ segment cuối", async () => {
    expect((await setup("batch-missing").run()).body).toEqual({ segments: [{ id: "s1", translation: "[vi] ⟦1⟧ バグ" }] });
  });

  it("batch-extra thêm id lạ", async () => {
    const body = (await setup("batch-extra").run()).body as { segments: { id: string }[] };
    expect(body.segments.map((s) => s.id)).toEqual(["s1", "s2", "s999"]);
  });

  it("batch-drop-placeholder xoá ⟦1⟧ đầu tiên", async () => {
    const body = (await setup("batch-drop-placeholder").run()).body as { segments: { translation: string }[] };
    expect(body.segments[0]!.translation).toBe("[vi]  バグ");
  });

  it("batch-result-text để JSON trong result, không có structured_output", async () => {
    const r = await setup("batch-result-text").run();
    expect(r.body).toEqual({ segments: [{ id: "s1", translation: "[vi] ⟦1⟧ バグ" }, { id: "s2", translation: "[vi] 修正" }] });
  });
});

describe("fake-claude-cli: --fake-fail-on / --fake-lock", () => {
  it("fail-on n chỉ lỗi ở lần gọi thứ n", async () => {
    const { run, calls } = setup("ok", ["--fake-fail-on", "2"]);
    await run();
    await expect(run()).rejects.toMatchObject({ reason: "process_failed", stderrTail: "fake: not logged in\n" });
    await run();
    expect(calls()).toHaveLength(3);
  });

  it("ghi startedAt/endedAt; gọi tuần tự không lỗi lock và lock được xoá", async () => {
    const { run, calls, lock } = setup("slow", ["--fake-delay", "100", "--fake-lock", "LOCK"]);
    await run();
    await run();
    const [a, b] = calls();
    expect(a.endedAt).toBeGreaterThanOrEqual(a.startedAt);
    expect(b.startedAt).toBeGreaterThanOrEqual(a.endedAt);
    expect(existsSync(lock)).toBe(false);
  });

  it("gọi song song bị phát hiện", async () => {
    const { run } = setup("slow", ["--fake-delay", "400", "--fake-lock", "LOCK"]);
    const results = await Promise.allSettled([run(), run()]);
    const failed = results.filter((r) => r.status === "rejected");
    expect(failed).toHaveLength(1);
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(CliRunFailure);
  });
});

describe("fake-claude-cli: stdin cũ không có <segment", () => {
  it("giữ hành vi translation", async () => {
    expect((await setup("ok").run("<source>\nabc\n</source>")).body).toEqual({ translation: "[vi] abc" });
  });
});
