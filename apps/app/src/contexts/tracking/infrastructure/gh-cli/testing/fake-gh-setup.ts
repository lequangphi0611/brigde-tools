import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll } from "vitest";
import type { GitHubFixture } from "../../../../../test-harness/github-fixture.ts";
import { DEFAULT_GH_CLI_CONFIG, type GhCliConfig } from "../gh-cli-runner.ts";

// Thư mục tạm của mọi `setupFakeGh` trong file test này, dọn khi file test xong.
const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

export const FAKE_GH_PATH = join(dirname(fileURLToPath(import.meta.url)), "fake-gh.mjs");

export interface RecordedGhCall {
  argv: string[];
  stdin: string;
  operationName: string;
  env: Record<string, string | undefined>;
}

/** Dựng cấu hình `GhCliConfig` trỏ tới fake-gh với fixture + chế độ cho test. */
export function setupFakeGh(fixture: GitHubFixture, mode = "ok", extra: Partial<GhCliConfig> = {}, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "fake-gh-"));
  tempDirs.push(dir);
  const fixturePath = join(dir, "fixture.json");
  const record = join(dir, "record.jsonl");
  writeFileSync(fixturePath, JSON.stringify(fixture));
  const config: GhCliConfig = {
    ...DEFAULT_GH_CLI_CONFIG,
    command: process.execPath,
    argsPrefix: [FAKE_GH_PATH],
    timeoutMs: 20_000,
    env: { FAKE_GH_FIXTURE: fixturePath, FAKE_GH_RECORD: record, FAKE_GH_MODE: mode, ...env },
    ...extra,
  };
  const calls = (): RecordedGhCall[] => {
    try {
      return readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as RecordedGhCall);
    } catch {
      return [];
    }
  };
  return { config, calls };
}
