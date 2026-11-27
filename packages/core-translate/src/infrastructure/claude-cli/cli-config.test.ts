import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TranslationFailure } from "../../application/translation-failure.ts";
import { claudeCliEngineVersion } from "./claude-cli-engine-version.ts";
import { extractConfiguredModel } from "./cli-config.ts";
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
