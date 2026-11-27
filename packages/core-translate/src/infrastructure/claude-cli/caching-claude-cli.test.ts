import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CachingTranslator } from "../../application/caching-translator.ts";
import { runTranslatorContract } from "../../application/translator.contract.ts";
import type { TranslationRequest } from "../../application/translator.port.ts";
import { InMemoryTranslationCache } from "../in-memory-translation-cache.ts";
import { claudeCliEngineVersion } from "./claude-cli-engine-version.ts";
import { ClaudeCliTranslator } from "./claude-cli-translator.ts";

// CachingTranslator + ClaudeCliTranslator thật + fake CLI (spec 003, bước 5): không gọi AI.
const FAKE = fileURLToPath(new URL("./testing/fake-claude-cli.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "ghit-caching-cli-"));
const ja2vi = { from: "ja", to: "vi" } as const;

function setup(model?: string) {
  const id = Math.random();
  const record = join(dir, `rec-${id}.jsonl`);
  const configPath = join(dir, `config-${id}.json`);
  const writeConfig = (m?: string) =>
    writeFileSync(
      configPath,
      JSON.stringify({ command: process.execPath, args: [FAKE, "--fake-record", record, ...(m !== undefined ? ["--model", m] : [])], timeoutSeconds: 30 }),
    );
  writeConfig(model);
  const calls = (): unknown[] => {
    try {
      return readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };
  const translator = new CachingTranslator({
    inner: new ClaudeCliTranslator(configPath),
    cache: new InMemoryTranslationCache(),
    engineVersion: () => claudeCliEngineVersion(configPath),
  });
  return { translator, calls, writeConfig };
}

const req = (segments: Array<[string, string]>): TranslationRequest => ({
  direction: ja2vi,
  segments: segments.map(([id, text]) => ({ id, text })),
  context: { glossary: [] },
});

runTranslatorContract("CachingTranslator(ClaudeCliTranslator + fake CLI)", { create: () => setup("sonnet").translator, model: "fake-model" });

describe("CachingTranslator + ClaudeCliTranslator", () => {
  it("AC-1 lần hai không gọi CLI, kết quả giống hệt, model = null", async () => {
    const { translator, calls } = setup("sonnet");
    const first = await translator.translate(req([["title", "ログイン不具合"], ["body", "再現手順があります"]]));
    expect(calls()).toHaveLength(1);
    expect(first.segments.map((s) => s.text)).toEqual(["[vi] ログイン不具合", "[vi] 再現手順があります"]);
    const second = await translator.translate(req([["t", "ログイン不具合"], ["b", "再現手順があります"]]));
    expect(calls()).toHaveLength(1);
    expect(second.segments.map((s) => s.text)).toEqual(first.segments.map((s) => s.text));
    expect(second.model).toBeNull();
  });

  it("AC-2 trúng một phần thì CLI chỉ nhận đoạn trượt, một lần gọi", async () => {
    const { translator, calls } = setup("sonnet");
    await translator.translate(req([["title", "ログイン不具合"], ["body", "再現手順があります"]]));
    const r = await translator.translate(req([["title", "ログイン不具合"], ["body", "再現手順があります"], ["comment:A", "確認しました"], ["comment:B", "修正してください"]]));
    const all = calls() as Array<{ stdin: string }>;
    expect(all).toHaveLength(2);
    expect(all[1]!.stdin).toContain("確認しました");
    expect(all[1]!.stdin).toContain("修正してください");
    expect(all[1]!.stdin).not.toContain("ログイン不具合");
    expect(r.segments.map((s) => s.id)).toEqual(["title", "body", "comment:A", "comment:B"]);
    expect(r.segments.map((s) => s.text)).toEqual(["[vi] ログイン不具合", "[vi] 再現手順があります", "[vi] 確認しました", "[vi] 修正してください"]);
    expect(r.model).toBe("fake-model");
  });

  it("AC-5 sửa --model trong file cấu hình thì có hiệu lực ngay, không cần dựng lại", async () => {
    const { translator, calls, writeConfig } = setup("sonnet");
    const r = req([["a", "確認しました"]]);
    await translator.translate(r);
    await translator.translate(r);
    expect(calls()).toHaveLength(1);
    writeConfig("opus");
    await translator.translate(r);
    expect(calls()).toHaveLength(2);
    writeConfig(undefined);
    await translator.translate(r);
    expect(calls()).toHaveLength(3);
    await translator.translate(r);
    expect(calls()).toHaveLength(3);
  });
});
