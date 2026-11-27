import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contractFixture } from "../../../../shared/ports/github-gateway.contract.ts";
import { GitHubFailure, type GitHubFailureReason } from "../../../../shared/ports/github-gateway.port.ts";
import { DEFAULT_GH_CLI_CONFIG, runGhCli, type GhCliConfig, type GhGraphqlRequest } from "./gh-cli-runner.ts";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "testing", "fake-gh.mjs");
const OWNER = 'o"; drop';
const MARKER_HOST = "ghes.example.test";

function setup(mode: string, extra: Partial<GhCliConfig> = {}, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gh-runner-test-"));
  const fixture = join(dir, "fixture.json");
  const record = join(dir, "record.jsonl");
  writeFileSync(fixture, JSON.stringify(contractFixture()));
  const config: GhCliConfig = {
    ...DEFAULT_GH_CLI_CONFIG,
    command: process.execPath,
    argsPrefix: [FAKE],
    timeoutMs: 10_000,
    env: { FAKE_GH_FIXTURE: fixture, FAKE_GH_RECORD: record, FAKE_GH_MODE: mode, GH_HOST: MARKER_HOST, ...env },
    ...extra,
  };
  const records = () => readFileSync(record, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { argv: string[]; stdin: string; env: Record<string, string> });
  return { config, records };
}

const SCAN: GhGraphqlRequest = {
  operationName: "ScanProject",
  query: "query ScanProject($owner: String!, $number: Int!, $cursor: String, $statusField: String!, $withStatus: Boolean!) { organization(login: $owner) { projectV2(number: $number) { id } } }",
  variables: { owner: OWNER, number: 7, cursor: null, statusField: "Status", withStatus: true },
};

async function failure(config: GhCliConfig, req = SCAN): Promise<GitHubFailure> {
  try {
    await runGhCli(config, req);
  } catch (e) {
    expect(e).toBeInstanceOf(GitHubFailure);
    return e as GitHubFailure;
  }
  throw new Error("expected failure");
}

describe("runGhCli", () => {
  it("AC-8: argv chỉ api graphql --input -, stdin có query + variables, owner không nằm trong query, env", async () => {
    const { config, records } = setup("ok");
    const r = await runGhCli(config, SCAN);
    expect(r.partial).toBe(false);
    expect(Object.keys(r.data)).toEqual(["organization"]);
    const [rec] = records();
    expect(rec!.argv).toEqual(["api", "graphql", "--input", "-"]);
    const sent = JSON.parse(rec!.stdin);
    expect(sent.variables).toEqual(SCAN.variables);
    expect(sent.query).not.toContain("drop");
    expect(sent.operationName).toBe("ScanProject");
    expect(rec!.env).toMatchObject({ GH_HOST: MARKER_HOST, GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", NO_COLOR: "1" });
  });

  it("ba biến cố định thắng env cấu hình", async () => {
    const { config, records } = setup("ok", {}, { GH_PROMPT_DISABLED: "0" });
    await runGhCli(config, SCAN);
    expect(records()[0]!.env.GH_PROMPT_DISABLED).toBe("1");
  });

  it("stdin UTF-8 giữ nguyên tiếng Nhật", async () => {
    const { config, records } = setup("ok");
    await runGhCli(config, { ...SCAN, variables: { ...SCAN.variables, statusField: "状態 🙂" } });
    expect(JSON.parse(records()[0]!.stdin).variables.statusField).toBe("状態 🙂");
  });

  it("lỗi một phần: exit 1 nhưng stdout có data -> trả data, partial", async () => {
    const { config } = setup("partial");
    const r = await runGhCli(config, { operationName: "IssueDetails", query: "q", variables: { ids: ["I_1", "I_gone"] } });
    expect(r.partial).toBe(true);
    expect((r.data.nodes as unknown[])[1]).toBeNull();
  });

  it("scope-partial: trả data + partial + failureHint là mã reason (không chứa văn bản lỗi)", async () => {
    const r = await runGhCli(setup("scope-partial").config, SCAN);
    expect(r.partial).toBe(true);
    expect(r.failureHint).toBe("scope_missing");
    expect(JSON.stringify(r)).not.toMatch(/granted|token/);
  });

  it("không có lỗi thì không có failureHint", async () => {
    expect((await runGhCli(setup("ok").config, SCAN)).failureHint).toBeUndefined();
  });

  it("project null (exit 0, data có null) vẫn là data hợp lệ, adapter quyết định", async () => {
    const r = await runGhCli(setup("project-null").config, SCAN);
    expect(r.data).toEqual({ organization: { projectV2: null } });
  });

  it("sai shape của data không phải việc của runner (zod ở GhCliGateway, bước 5)", async () => {
    const r = await runGhCli(setup("bad-shape").config, SCAN);
    expect(r.data).toEqual({ unexpected: 1 });
  });

  it.each<[string, GitHubFailureReason]>([
    ["auth", "not_authenticated"],
    ["scope", "scope_missing"],
    ["not-resolved", "project_not_found"],
    ["unsupported", "projects_v2_unsupported"],
    ["network", "network"],
    ["fail", "process_failed"],
    ["garbage", "bad_output"],
  ])("AC-7 chế độ %s -> %s, không lộ dữ liệu", async (mode, reason) => {
    const f = await failure(setup(mode).config);
    expect(f.reason).toBe(reason);
    for (const s of [f.message, f.detail ?? ""]) {
      expect(s).not.toContain(MARKER_HOST);
      expect(s).not.toContain("acme");
      expect(s).not.toContain("drop");
      expect(s).not.toContain("gh auth login");
    }
  });

  it("AC-7 lệnh gh không tồn tại -> gh_not_found", async () => {
    const f = await failure({ ...DEFAULT_GH_CLI_CONFIG, command: join(tmpdir(), "definitely-not-gh-binary"), timeoutMs: 5000 });
    expect(f.reason).toBe("gh_not_found");
  });

  it("AC-7 treo quá timeout -> timeout (kill process)", async () => {
    const started = Date.now();
    const f = await failure(setup("hang", { timeoutMs: 300 }).config);
    expect(f.reason).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("AC-7 stdout vượt giới hạn -> bad_output", async () => {
    const f = await failure(setup("huge", { maxStdoutBytes: 1024 * 1024 }, { FAKE_GH_HUGE_BYTES: String(3 * 1024 * 1024) }).config);
    expect(f.reason).toBe("bad_output");
  });
});
