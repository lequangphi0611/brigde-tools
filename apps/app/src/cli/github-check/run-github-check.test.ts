import { describe, expect, it } from "vitest";
import { issue } from "../../shared/ports/github-gateway.contract.ts";
import type { GitHubCommentSnapshot } from "../../shared/ports/github-gateway.port.ts";
import { GhCliGateway } from "../../contexts/tracking/infrastructure/gh-cli/gh-cli-gateway.ts";
import { setupFakeGh } from "../../contexts/tracking/infrastructure/gh-cli/testing/fake-gh-setup.ts";
import type { FixtureItem, GitHubFixture } from "../../test-harness/github-fixture.ts";
import { formatStatusLine, measureDetails, runGithubCheck, type CheckFields } from "./run-github-check.ts";

const NOW = new Date("2026-11-27T00:00:00Z");
const MARK = "ZZMARK";
const HOST = `${MARK}host.example.test`;

const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const cmt = (id: string, createdAt: string, updatedAt = createdAt, author: string | null = `${MARK}login`): GitHubCommentSnapshot => ({
  nodeId: id,
  author,
  body: `${MARK}コメント本文です`,
  createdAt,
  updatedAt,
});

/** 286 item: 278 Issue (23 mới đổi, 40 CLOSED), 5 PR, 3 draft; 140 comment trên 23 issue gần đây. */
function bigFixture(opts: { recent?: number; statusFieldName?: string } = {}): GitHubFixture {
  const recent = opts.recent ?? 23;
  const fieldName = opts.statusFieldName ?? `${MARK}Status`;
  const options = ["Todo", "In Progress", "Review", "Done", "Closed"].map((n, i) => ({ name: `${MARK}${n}`, optionId: `opt_${i}` }));
  const items: FixtureItem[] = [];
  for (let i = 0; i < 278; i++) {
    const isRecent = i < recent;
    const updatedAt = isRecent ? day(1 + (i % 5) + i / 1000) : day(30 + i);
    let comments: GitHubCommentSnapshot[] = [];
    if (isRecent) {
      const n = i === 0 ? 8 : i < 23 ? 6 : 0;
      comments = Array.from({ length: n }, (_, k) => cmt(`${MARK}C_${i}_${k}`, new Date(Date.parse(updatedAt) - (k + 1) * 60_000).toISOString()));
      if (i === 1 || i === 2) comments[0] = cmt(`${MARK}C_${i}_new`, new Date(Date.parse(updatedAt) + 60_000).toISOString());
      if (i === 3 || i === 4 || i === 5) comments[0] = cmt(`${MARK}C_${i}_ed`, new Date(Date.parse(updatedAt) - 3_600_000).toISOString(), new Date(Date.parse(updatedAt) + 60_000).toISOString());
    }
    items.push({
      kind: "issue",
      issue: issue(`${MARK}I_${i}`, { number: i + 1, repo: `${MARK}acme/web`, title: `${MARK}タイトル`, body: `${MARK}本文`, assignees: [`${MARK}login`], updatedAt, comments }),
      state: i % 7 === 0 && i < 280 ? "CLOSED" : "OPEN",
      ...(i < 270 ? { status: options[i % 5]!.name } : {}),
    });
  }
  const closedCount = items.filter((x) => x.kind === "issue" && x.state === "CLOSED").length;
  expect(closedCount).toBe(40);
  for (let i = 0; i < 5; i++) items.push({ kind: "pullRequest" });
  for (let i = 0; i < 3; i++) items.push({ kind: "draftIssue" });
  return { project: { owner: `${MARK}acme`, ownerType: "org", number: 3 }, statusField: { name: fieldName, kind: "single_select", options }, items };
}

function run(argv: string[], fixture: GitHubFixture, opts: { mode?: string; env?: Record<string, string | undefined>; extra?: Parameters<typeof setupFakeGh>[2] } = {}) {
  const fake = setupFakeGh(fixture, opts.mode ?? "ok", opts.extra ?? {}, { GH_HOST: HOST });
  const out: string[] = [];
  const err: string[] = [];
  let gateway: GhCliGateway | undefined;
  const done = runGithubCheck({
    argv,
    env: opts.env ?? { GH_HOST: HOST },
    stdout: { write: (c) => void out.push(c) },
    stderr: { write: (c) => void err.push(c) },
    createGateway: ({ onStderr }) => (gateway = new GhCliGateway({ ...fake.config, ...(onStderr ? { onStderr } : {}) })),
    now: () => NOW,
  });
  return done.then((code) => ({ code, out: out.join(""), err: err.join(""), calls: fake.calls, gateway }));
}

const BASE = ["--owner", `${MARK}acme`, "--number", "3", "--status-field", `${MARK}Status`];

describe("github-check", () => {
  it("AC-10: một dòng số đếm, exit 0", async () => {
    const r = await run(BASE, bigFixture());
    expect(r.code).toBe(0);
    expect(r.out.endsWith("\n")).toBe(true);
    expect(r.out.trim().split("\n")).toHaveLength(1);
    const line = r.out.trim();
    expect(line).toMatch(/^github-check OK host=GH_HOST items=286 issues=278 skipped=pr:5,draft:3,noaccess:0 closed=40 statusField=found statusSet=270 statusOptions=5 pages=3 scanMs=\d+ recent=23 details=23 missing=0 detailCalls=1 comments=140 maxComments=8 commentPages=0 jaChars=\d+ newerComment=2 editedComment=5 detailMs=\d+$/);
    expect(Number(/jaChars=(\d+)/.exec(line)![1])).toBeGreaterThan(0);
    expect(r.err).toBe("");
  });

  it("AC-11: --max-details giới hạn, chọn các issue mới nhất", async () => {
    const r = await run([...BASE, "--max-details", "30"], bigFixture({ recent: 80 }));
    expect(r.out).toContain("recent=80 details=30 ");
    const asked = r.calls().filter((c) => c.operationName === "IssueDetails").flatMap((c) => JSON.parse(c.stdin).variables.ids as string[]);
    expect(asked).toHaveLength(30);
    const fx = bigFixture({ recent: 80 });
    const ts = new Map(fx.items.flatMap((x) => (x.kind === "issue" ? [[x.issue.nodeId, Date.parse(x.issue.updatedAt)] as const] : [])));
    const newest30 = [...ts.entries()].filter(([, t]) => t >= NOW.getTime() - 7 * 86_400_000).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([id]) => id);
    expect(new Set(asked)).toEqual(new Set(newest30));
  });

  it("--days thu hẹp, --owner-type user, --status-field mặc định Status", async () => {
    const fx = bigFixture({ statusFieldName: "Status" });
    const r = await run(["--owner", "o", "--number", "3", "--owner-type", "user", "--days", "1"], fx);
    expect(r.out).toContain("statusField=found");
    expect(r.out).toContain("recent=1 details=1");
    expect(JSON.parse(r.calls()[0]!.stdin).query).toMatch(/user\(login/);
  });

  it.each([
    ["thiếu --number", ["--owner", "acme"], { GH_HOST: HOST }, "usage", 2],
    ["--days 0", ["--owner", "acme", "--number", "3", "--days", "0"], { GH_HOST: HOST }, "usage", 2],
    ["--days 31", ["--owner", "acme", "--number", "3", "--days", "31"], { GH_HOST: HOST }, "usage", 2],
    ["--max-details 201", ["--owner", "acme", "--number", "3", "--max-details", "201"], { GH_HOST: HOST }, "usage", 2],
    ["--owner-type lạ", ["--owner", "acme", "--number", "3", "--owner-type", "x"], { GH_HOST: HOST }, "usage", 2],
    ["tham số lạ", ["--owner", "acme", "--number", "3", "--zzz", "1"], { GH_HOST: HOST }, "usage", 2],
    ["GH_HOST chưa đặt", ["--owner", "acme", "--number", "3"], {}, "gh_host_unset", 2],
  ])("AC-12 %s -> FAIL %s exit %i", async (_n, argv, env, code, exit) => {
    const r = await run(argv, bigFixture(), { env });
    expect(r.code).toBe(exit);
    expect(r.out).toBe(`github-check FAIL ${code}\n`);
    expect(r.calls()).toHaveLength(0);
  });

  it.each([
    ["auth", "github:not_authenticated"],
    ["scope", "github:scope_missing"],
    ["project-null", "github:project_not_found"],
    ["scope-partial", "github:scope_missing"],
    ["unsupported", "github:projects_v2_unsupported"],
    ["network", "github:network"],
    ["garbage", "github:bad_output"],
  ])("AC-12 fake gh chế độ %s -> FAIL %s exit 1", async (mode, code) => {
    const r = await run(BASE, bigFixture(), { mode });
    expect(r.code).toBe(1);
    expect(r.out).toBe(`github-check FAIL ${code}\n`);
  });

  it("AC-13: không in chuỗi đánh dấu ở chế độ OK và mọi chế độ lỗi", async () => {
    for (const mode of ["ok", "auth", "scope", "scope-partial", "project-null", "unsupported", "network", "fail", "garbage", "bad-shape"]) {
      const r = await run(BASE, bigFixture(), { mode });
      expect(r.out + r.err, mode).not.toContain(MARK);
    }
    const bad = await run(["--owner", `${MARK}acme`], bigFixture());
    expect(bad.out + bad.err).not.toContain(MARK);
    const nohost = await run(BASE, bigFixture(), { env: {} });
    expect(nohost.out + nohost.err).not.toContain(MARK);
  });

  it("--raw in stderr gốc của gh ra stderr, stdout vẫn chỉ có dòng FAIL", async () => {
    const r = await run([...BASE, "--raw"], bigFixture(), { mode: "auth" });
    expect(r.err).toContain("gh auth login");
    expect(r.out).toBe("github-check FAIL github:not_authenticated\n");
  });
});

describe("hàm thuần", () => {
  it("measureDetails đếm comment mới/sửa theo Issue.updatedAt", () => {
    const i = issue("I", {
      updatedAt: "2026-11-10T00:00:00Z",
      title: "日本",
      body: "ab",
      comments: [cmt("a", "2026-11-09T00:00:00Z"), cmt("b", "2026-11-11T00:00:00Z"), cmt("c", "2026-11-09T00:00:00Z", "2026-11-12T00:00:00Z")],
    });
    const m = measureDetails([i, issue("J")]);
    expect(m).toMatchObject({ comments: 3, maxComments: 3, newerComment: 1, editedComment: 1 });
    expect(m.jaChars).toBe(2 + 3 * 8 + 9); 
  });

  it("formatStatusLine theo mẫu trong spec", () => {
    const f: CheckFields = { items: 286, issues: 278, skipped: { pullRequest: 5, draftIssue: 3, inaccessible: 0 }, closed: 40, statusField: "found", statusSet: 270, statusOptions: 5, pages: 3, scanMs: 4100, recent: 23, details: 23, missing: 0, detailCalls: 1, comments: 140, maxComments: 31, commentPages: 0, jaChars: 51234, newerComment: 0, editedComment: 2, detailMs: 2900 };
    expect(formatStatusLine(f)).toBe(
      "github-check OK host=GH_HOST items=286 issues=278 skipped=pr:5,draft:3,noaccess:0 closed=40 statusField=found statusSet=270 statusOptions=5 pages=3 scanMs=4100 recent=23 details=23 missing=0 detailCalls=1 comments=140 maxComments=31 commentPages=0 jaChars=51234 newerComment=0 editedComment=2 detailMs=2900",
    );
  });
});
