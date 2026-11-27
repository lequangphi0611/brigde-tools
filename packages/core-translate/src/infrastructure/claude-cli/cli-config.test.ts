import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TranslationFailure } from "../../application/translation-failure.ts";
import { claudeCliEngineVersion } from "./claude-cli-engine-version.ts";
import { checkCliConfig, extractConfiguredModel, loadCliConfig } from "./cli-config.ts";
import { CLAUDE_CLI_PROMPT_VERSION } from "./translation-prompt.ts";

describe("extractConfiguredModel", () => {
  it("AC-6 lấy giá trị --model <v> và --model=<v>, không phân biệt hoa thường, trim", () => {
    expect(extractConfiguredModel(["--model", "sonnet", "--settings", "C:\\s.json"])).toBe("sonnet");
    expect(extractConfiguredModel(["--model=opus"])).toBe("opus");
    expect(extractConfiguredModel(["--MODEL", " opus "])).toBe("opus");
    expect(extractConfiguredModel(["--Model=Opus "])).toBe("Opus");
  });
  it("AC-6 nhiều lần thì lần cuối thắng", () => {
    expect(extractConfiguredModel(["--model", "a", "--model=b"])).toBe("b");
    expect(extractConfiguredModel(["--model=a", "--model", "b"])).toBe("b");
  });
  it("AC-6 không có hoặc thiếu giá trị thì \"\"", () => {
    expect(extractConfiguredModel([])).toBe("");
    expect(extractConfiguredModel(["--settings", "x"])).toBe("");
    expect(extractConfiguredModel(["--model"])).toBe("");
  });
  it("AC-6 đổi args khác không đổi kết quả", () => {
    expect(extractConfiguredModel(["--settings", "a.json", "--model", "m"])).toBe(
      extractConfiguredModel(["--settings", "b.json", "--model", "m"]),
    );
  });
});

describe("claudeCliEngineVersion", () => {
  let dir: string;
  let path: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "engine-version-"));
    path = join(dir, "claude-cli.json");
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));
  const write = (args: string[]) => writeFile(path, JSON.stringify({ command: "/usr/bin/node", args }));

  it("AC-6 trả promptVersion + configuredModel, đọc lại cấu hình mỗi lần gọi", async () => {
    await write(["--model", "sonnet"]);
    await expect(claudeCliEngineVersion(path)).resolves.toEqual({ promptVersion: CLAUDE_CLI_PROMPT_VERSION, configuredModel: "sonnet" });
    await write(["--model=opus"]);
    await expect(claudeCliEngineVersion(path)).resolves.toEqual({ promptVersion: CLAUDE_CLI_PROMPT_VERSION, configuredModel: "opus" });
    await write([]);
    await expect(claudeCliEngineVersion(path)).resolves.toMatchObject({ configuredModel: "" });
  });

  it("AC-6 file thiếu/sai ném TranslationFailure(not_configured)", async () => {
    await expect(claudeCliEngineVersion(join(dir, "none.json"))).rejects.toMatchObject({ name: "TranslationFailure", reason: "not_configured" });
    await writeFile(path, "{ not json");
    await expect(claudeCliEngineVersion(path)).rejects.toBeInstanceOf(TranslationFailure);
    await writeFile(path, JSON.stringify({ command: "" }));
    await expect(claudeCliEngineVersion(path)).rejects.toMatchObject({ reason: "not_configured" });
  });
});

describe("mã lỗi cấu hình (003b)", () => {
  let d: string;
  beforeEach(async () => {
    d = await mkdtemp(join(tmpdir(), "ghit-cfgcode-"));
  });
  afterEach(() => rm(d, { recursive: true, force: true }));

  it("config_invalid kèm tên trường, không kèm giá trị", () => {
    const r = checkCliConfig({ command: "claude", timeoutSeconds: 3000 }, "linux");
    expect(r).toMatchObject({ ok: false, code: "config_invalid", field: "timeoutSeconds" });
    if (r.ok) throw new Error("unreachable");
    expect(r.problem).toContain("timeoutSeconds phải là số nguyên 10–1800");
    expect(r.problem).not.toContain("3000");
    expect(checkCliConfig({ command: "claude", concurrency: 9 }, "linux")).toMatchObject({ field: "concurrency" });
    expect(checkCliConfig({ command: "claude", env: { "a b": "x" } }, "linux")).toMatchObject({ field: "env" });
    expect(checkCliConfig({}, "linux")).toMatchObject({ field: "command" });
    expect(checkCliConfig([], "linux")).toMatchObject({ code: "config_invalid" });
    expect(checkCliConfig([], "linux")).not.toHaveProperty("field");
  });

  it("forbidden_flag, command_cmd_bat", () => {
    expect(checkCliConfig({ command: "claude", args: ["--tools", ""] }, "linux")).toMatchObject({ code: "forbidden_flag", field: "args" });
    expect(checkCliConfig({ command: "C:\\x\\claude.cmd" }, "win32")).toMatchObject({ code: "command_cmd_bat", field: "command" });
  });

  it("loadCliConfig: config_missing, config_not_json", async () => {
    expect(await loadCliConfig(join(d, "none.json"))).toMatchObject({ ok: false, code: "config_missing" });
    await writeFile(join(d, "bad.json"), "{ không phải json");
    expect(await loadCliConfig(join(d, "bad.json"))).toMatchObject({ ok: false, code: "config_not_json" });
  });

  it("claudeCliEngineVersion ném not_configured mang mã và trường", async () => {
    await writeFile(join(d, "c.json"), JSON.stringify({ command: "claude", timeoutSeconds: 3000 }));
    await expect(claudeCliEngineVersion(join(d, "c.json"))).rejects.toMatchObject({
      reason: "not_configured",
      detail: "config_invalid",
      field: "timeoutSeconds",
    });
  });
});
