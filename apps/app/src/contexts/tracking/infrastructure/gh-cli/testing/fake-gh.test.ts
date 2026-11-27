import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { contractFixture, issue } from "../../../../../shared/ports/testing/github-gateway.contract.ts";
import type { FixtureItem, GitHubFixture } from "../../../../../test-harness/github-fixture.ts";

const FAKE = join(dirname(fileURLToPath(import.meta.url)), "fake-gh.mjs");

const tempDirs: string[] = [];
afterAll(() => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Result { code: number | null; stdout: string; stderr: string }

function run(body: unknown, opts: { mode?: string; fixture?: GitHubFixture; args?: string[]; env?: Record<string, string> } = {}): Promise<Result & { record: Array<Record<string, any>> }> {
  const dir = mkdtempSync(join(tmpdir(), "fake-gh-test-"));
  tempDirs.push(dir);
  const fixturePath = join(dir, "fixture.json");
  const recordPath = join(dir, "record.jsonl");
  writeFileSync(fixturePath, JSON.stringify(opts.fixture ?? contractFixture()));
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [FAKE, ...(opts.args ?? ["api", "graphql", "--input", "-"])], {
      env: { ...process.env, FAKE_GH_FIXTURE: fixturePath, FAKE_GH_RECORD: recordPath, FAKE_GH_MODE: opts.mode ?? "ok", ...opts.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => (stdout += b));
    child.stderr.on("data", (b) => (stderr += b));
    child.on("close", (code) => {
      let record: Array<Record<string, any>> = [];
      try {
        record = readFileSync(recordPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      } catch {}
      resolve({ code, stdout, stderr, record });
    });
    child.stdin.end(JSON.stringify(body), "utf8");
  });
}

const scanBody = (variables: Record<string, unknown> = {}, query = "query ScanProject { organization(login: $owner) { projectV2 } }") => ({
  operationName: "ScanProject",
  query,
  variables: { owner: "acme", number: 3, cursor: null, statusField: "Status", withStatus: true, ...variables },
});

describe("fake-gh", () => {
  it("ScanProject: trả item theo fixture, Issue.updatedAt khác item.updatedAt, field + fieldValueByName", async () => {
    const r = await run(scanBody());
    expect(r.code).toBe(0);
    const p = JSON.parse(r.stdout).data.organization.projectV2;
    expect(p.field).toEqual({ __typename: "ProjectV2SingleSelectField" });
    expect(p.items.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
    expect(p.items.nodes).toHaveLength(8);
    expect(p.items.nodes[0]).toMatchObject({
      updatedAt: "2026-11-09T00:00:00Z",
      content: { __typename: "Issue", id: "I_open", updatedAt: "2026-11-03T00:00:00Z", state: "OPEN" },
      fieldValueByName: { __typename: "ProjectV2ItemFieldSingleSelectValue", name: "In Progress", optionId: "opt_1" },
    });
    expect(p.items.nodes[2].fieldValueByName).toBeNull();
    expect(p.items.nodes[4].content).toEqual({ __typename: "PullRequest" });
    expect(p.items.nodes[7].content).toBeNull();
  });

  it("ScanProject: phân trang 100 item, cursor c100, c200; withStatus=false bỏ field", async () => {
    const items: FixtureItem[] = Array.from({ length: 250 }, (_, i) => ({ kind: "issue", issue: issue(`I_${i}`) }));
    const fixture = { ...contractFixture(), items };
    const p1 = JSON.parse((await run(scanBody({ withStatus: false, statusField: null }), { fixture })).stdout).data.organization.projectV2;
    expect(p1.items.nodes).toHaveLength(100);
    expect(p1.items.pageInfo).toEqual({ hasNextPage: true, endCursor: "c100" });
    expect(p1.field).toBeUndefined();
    expect(p1.items.nodes[0].fieldValueByName).toBeUndefined();
    const p3 = JSON.parse((await run(scanBody({ cursor: "c200" }), { fixture })).stdout).data.organization.projectV2;
    expect(p3.items.nodes).toHaveLength(50);
    expect(p3.items.pageInfo.hasNextPage).toBe(false);
    expect(p3.field).toBeUndefined(); // chỉ trang đầu
  });

  it("ScanProject: field khác tên -> null; field text -> ProjectV2Field; user(login:) dùng khoá user", async () => {
    const missing = JSON.parse((await run(scanBody({ statusField: "Trạng thái" }))).stdout).data.organization.projectV2;
    expect(missing.field).toBeNull();
    const text = { ...contractFixture(), statusField: { name: "Status", kind: "text" as const, options: [] } };
    const t = JSON.parse((await run(scanBody(), { fixture: text })).stdout).data.organization.projectV2;
    expect(t.field).toEqual({ __typename: "ProjectV2Field" });
    const u = JSON.parse((await run(scanBody({}, "query ScanProject { user(login: $owner) { projectV2 } }"))).stdout).data;
    expect(Object.keys(u)).toEqual(["user"]);
  });

  it("IssueDetails: snapshot + comment, id lạ -> null + errors + exit 1 nhưng stdout vẫn có data", async () => {
    const r = await run({ operationName: "IssueDetails", query: "q", variables: { ids: ["I_1", "I_gone"] } });
    expect(r.code).toBe(1);
    const j = JSON.parse(r.stdout);
    expect(j.data.nodes[1]).toBeNull();
    expect(j.errors[0].message).toContain("Could not resolve to a node");
    expect(j.data.nodes[0]).toMatchObject({
      id: "I_1",
      title: "日本語のタイトル 🙂",
      repository: { nameWithOwner: "acme/web" },
      assignees: { nodes: [{ login: "tanaka" }] },
      comments: { totalCount: 2, pageInfo: { hasNextPage: false }, nodes: [{ id: "C_1", author: { login: "suzuki" } }, { id: "C_2", author: null }] },
    });
  });

  it("IssueDetails + IssueComments: hơn 100 comment phân trang bằng cursor", async () => {
    const comments = Array.from({ length: 230 }, (_, i) => ({ nodeId: `C_${i}`, author: "a", body: `b${i}`, createdAt: `2026-11-01T00:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`, updatedAt: "2026-11-01T00:00:00Z" }));
    const fixture = { ...contractFixture(), extraIssues: [issue("I_2", { comments })] };
    const first = JSON.parse((await run({ operationName: "IssueDetails", query: "q", variables: { ids: ["I_2"] } }, { fixture })).stdout).data.nodes[0].comments;
    expect(first.nodes).toHaveLength(100);
    expect(first.totalCount).toBe(230);
    expect(first.pageInfo).toEqual({ hasNextPage: true, endCursor: "c100" });
    const second = JSON.parse((await run({ operationName: "IssueComments", query: "q", variables: { id: "I_2", cursor: "c100" } }, { fixture })).stdout).data.node.comments;
    expect(second.nodes.map((n: any) => n.id)).toEqual(comments.slice(100, 200).map((c) => c.nodeId));
    const third = JSON.parse((await run({ operationName: "IssueComments", query: "q", variables: { id: "I_2", cursor: "c200" } }, { fixture })).stdout).data.node.comments;
    expect(third.nodes).toHaveLength(30);
    expect(third.pageInfo.hasNextPage).toBe(false);
  });

  it("ghi lại argv, stdin, operationName và biến môi trường", async () => {
    const r = await run(scanBody(), { env: { GH_HOST: "ghes.example.test", GH_PROMPT_DISABLED: "1" } });
    expect(r.record).toHaveLength(1);
    expect(r.record[0]!.argv).toEqual(["api", "graphql", "--input", "-"]);
    expect(r.record[0]!.operationName).toBe("ScanProject");
    expect(JSON.parse(r.record[0]!.stdin).variables.owner).toBe("acme");
    expect(r.record[0]!.env).toMatchObject({ GH_HOST: "ghes.example.test", GH_PROMPT_DISABLED: "1" });
  });

  it("argv sai -> exit 64", async () => {
    expect((await run(scanBody(), { args: ["api", "graphql"] })).code).toBe(64);
  });

  it.each([
    ["auth", 4, /gh auth login/],
    ["scope", 1, /INSUFFICIENT_SCOPES/],
    ["not-resolved", 1, /Could not resolve to an Organization/],
    ["unsupported", 1, /projectV2.*doesn't exist/],
    ["network", 1, /dial tcp/],
    ["fail", 1, /unexpected/],
  ])("chế độ %s: exit %i, stderr khớp, stdout rỗng", async (mode, code, re) => {
    const r = await run(scanBody(), { mode });
    expect(r.code).toBe(code);
    expect(r.stderr).toMatch(re);
    expect(r.stdout).toBe("");
  });

  it("project-null: exit 0, projectV2 null (cả user)", async () => {
    const r = await run(scanBody(), { mode: "project-null" });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ data: { organization: { projectV2: null } } });
  });

  it("garbage, bad-shape, huge", async () => {
    expect(JSON.parse.bind(null, (await run(scanBody(), { mode: "garbage" })).stdout)).toThrow();
    expect(JSON.parse((await run(scanBody(), { mode: "bad-shape" })).stdout)).toEqual({ data: { unexpected: 1 } });
    const huge = await run(scanBody(), { mode: "huge", env: { FAKE_GH_HUGE_BYTES: String(3 * 1024 * 1024) } });
    expect(huge.stdout.length).toBe(3 * 1024 * 1024);
  });
});
