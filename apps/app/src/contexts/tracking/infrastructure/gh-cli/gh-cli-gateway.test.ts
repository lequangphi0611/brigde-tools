import { describe, expect, it } from "vitest";
import { CONTRACT_PROJECT, contractFixture, issue, runGitHubGatewayContract } from "../../../../shared/ports/github-gateway.contract.ts";
import { GitHubFailure, type GitHubFailureReason, type ProjectRef } from "../../../../shared/ports/github-gateway.port.ts";
import type { FixtureItem, GitHubFixture } from "../../../../test-harness/github-fixture.ts";
import { DETAIL_BATCH, GhCliGateway } from "./gh-cli-gateway.ts";
import { setupFakeGh } from "./testing/fake-gh-setup.ts";

const gateway = (fixture: GitHubFixture, mode = "ok", env: Record<string, string> = {}, extra = {}) => {
  const fake = setupFakeGh(fixture, mode, extra, { GH_HOST: "ghes.example.test", ...env });
  return { gw: new GhCliGateway(fake.config), calls: fake.calls };
};
const N = { statusField: null };

runGitHubGatewayContract("GhCliGateway + fake gh", { create: (fixture) => gateway(fixture).gw });

describe("GhCliGateway.scanProject", () => {
  it("AC-1: 250 issue, Issue.updatedAt (không phải item.updatedAt), 3 trang, cursor của trang trước", async () => {
    const items: FixtureItem[] = Array.from({ length: 250 }, (_, i) => ({
      kind: "issue",
      issue: issue(`I_${i}`, { updatedAt: "2026-10-01T00:00:00Z" }),
      itemUpdatedAt: "2026-11-20T00:00:00Z",
    }));
    const { gw, calls } = gateway({ ...contractFixture(), items });
    const scan = await gw.scanProject(CONTRACT_PROJECT, N);
    expect(scan.issues).toHaveLength(250);
    expect(new Set(scan.issues.map((i) => i.nodeId)).size).toBe(250);
    expect(scan.issues.every((i) => i.updatedAt === "2026-10-01T00:00:00Z")).toBe(true);
    expect(scan.pages).toBe(3);
    const sent = calls().map((c) => JSON.parse(c.stdin).variables.cursor);
    expect(sent).toEqual([null, "c100", "c200"]);
  });

  it("AC-1b: tên field nằm trong variables, không nằm trong chuỗi query; statusField null -> withStatus false", async () => {
    const { gw, calls } = gateway(contractFixture());
    await gw.scanProject(CONTRACT_PROJECT, { statusField: "Trạng thái-marker" });
    const first = JSON.parse(calls()[0]!.stdin);
    expect(first.variables).toMatchObject({ statusField: "Trạng thái-marker", withStatus: true });
    expect(first.query).not.toContain("marker");
    await gw.scanProject(CONTRACT_PROJECT, N);
    expect(JSON.parse(calls()[1]!.stdin).variables.withStatus).toBe(false);
  });

  it("AC-8: ownerType chọn organization(login:) hay user(login:); owner độc hại chỉ nằm trong variables", async () => {
    const { gw, calls } = gateway(contractFixture(), "ok", { GH_HOST: "ghes.example.test" });
    const evil: ProjectRef = { owner: 'o"; drop', ownerType: "org", number: 7 };
    await gw.scanProject(evil, N);
    await gw.scanProject({ ...evil, ownerType: "user" }, N);
    await gw.fetchIssueDetails(["I_1"]);
    const [org, user, det] = calls().map((c) => ({ ...c, body: JSON.parse(c.stdin) }));
    expect(org!.body.query).toMatch(/organization\(login: \$owner\)/);
    expect(user!.body.query).toMatch(/user\(login: \$owner\)/);
    expect(user!.body.query).not.toMatch(/organization\(/);
    for (const c of [org!, user!, det!]) {
      expect(c.argv).toEqual(["api", "graphql", "--input", "-"]);
      expect(c.body.query).not.toContain("drop");
      expect(c.env).toMatchObject({ GH_HOST: "ghes.example.test", GH_PROMPT_DISABLED: "1" });
    }
    expect(org!.body.variables).toMatchObject({ owner: 'o"; drop', number: 7 });
    expect(det!.body.variables).toEqual({ ids: ["I_1"] });
  });

  it("AC-7: projectV2 null (org và user) -> project_not_found", async () => {
    for (const ownerType of ["org", "user"] as const) {
      const { gw } = gateway(contractFixture(), "project-null");
      await expect(gw.scanProject({ ...CONTRACT_PROJECT, ownerType }, N)).rejects.toMatchObject({ reason: "project_not_found" });
    }
  });

  it.each<[string, GitHubFailureReason]>([
    ["auth", "not_authenticated"],
    ["scope", "scope_missing"],
    ["not-resolved", "project_not_found"],
    ["unsupported", "projects_v2_unsupported"],
    ["network", "network"],
    ["fail", "process_failed"],
    ["garbage", "bad_output"],
    ["bad-shape", "bad_output"],
  ])("AC-7 chế độ %s -> %s", async (mode, reason) => {
    const { gw } = gateway(contractFixture(), mode);
    const e = await gw.scanProject(CONTRACT_PROJECT, N).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(GitHubFailure);
    expect((e as GitHubFailure).reason).toBe(reason);
    expect(`${(e as GitHubFailure).message} ${(e as GitHubFailure).detail ?? ""}`).not.toMatch(/acme|ghes\.example/);
  });

  it("AC-7 treo -> timeout; vượt giới hạn -> bad_output; không có gh -> gh_not_found", async () => {
    const hang = gateway(contractFixture(), "hang", {}, { timeoutMs: 300 });
    await expect(hang.gw.scanProject(CONTRACT_PROJECT, N)).rejects.toMatchObject({ reason: "timeout" });
    const huge = gateway(contractFixture(), "huge", { FAKE_GH_HUGE_BYTES: String(2 * 1024 * 1024) }, { maxStdoutBytes: 1024 * 1024 });
    await expect(huge.gw.scanProject(CONTRACT_PROJECT, N)).rejects.toMatchObject({ reason: "bad_output" });
    const none = new GhCliGateway({ command: "/definitely/not/gh" });
    await expect(none.scanProject(CONTRACT_PROJECT, N)).rejects.toMatchObject({ reason: "gh_not_found" });
  });
});

describe("GhCliGateway.fetchIssueDetails", () => {
  it("AC-4: 230 comment -> 1 lần nodes(ids) + 2 lần comment, đủ, đúng thứ tự, không trùng", async () => {
    const comments = Array.from({ length: 230 }, (_, i) => ({
      nodeId: `C_${i}`,
      author: "a",
      body: `コメント${i}`,
      createdAt: new Date(Date.UTC(2026, 10, 1, 0, 0, i)).toISOString(),
      updatedAt: "2026-11-02T00:00:00Z",
    }));
    const { gw, calls } = gateway({ ...contractFixture(), extraIssues: [issue("I_2", { comments })] });
    const d = await gw.fetchIssueDetails(["I_2"]);
    expect(d.issues[0]!.comments.map((c) => c.nodeId)).toEqual(comments.map((c) => c.nodeId));
    expect(calls().map((c) => c.operationName)).toEqual(["IssueDetails", "IssueComments", "IssueComments"]);
    expect(gw.detailStats).toEqual({ detailCalls: 1, commentPages: 2 });
  });

  it("AC-5: 60 id chia 25/25/10; [] không gọi gh", async () => {
    const extra = Array.from({ length: 60 }, (_, i) => issue(`I_${i}`));
    const { gw, calls } = gateway({ ...contractFixture(), extraIssues: extra });
    expect(DETAIL_BATCH).toBe(25);
    const d = await gw.fetchIssueDetails(extra.map((i) => i.nodeId));
    expect(calls().map((c) => JSON.parse(c.stdin).variables.ids.length)).toEqual([25, 25, 10]);
    expect(d.issues).toHaveLength(60);
    expect(new Set(d.issues.map((i) => i.nodeId)).size).toBe(60);
    const before = calls().length;
    expect(await gw.fetchIssueDetails([])).toEqual({ issues: [], missing: [] });
    expect(calls()).toHaveLength(before);
  });

  it("AC-6: id không còn (gh exit 1 + data + errors) -> missing, phần còn lại vẫn trả", async () => {
    const { gw } = gateway(contractFixture(), "partial");
    const d = await gw.fetchIssueDetails(["I_1", "I_gone"]);
    expect(d.issues.map((i) => i.nodeId)).toEqual(["I_1"]);
    expect(d.missing).toEqual(["I_gone"]);
  });

  it("AC-3: giữ nguyên từng byte tiếng Nhật, code block, emoji", async () => {
    const { gw } = gateway(contractFixture());
    const fixtureIssue = (contractFixture().items[3] as Extract<FixtureItem, { kind: "issue" }>).issue;
    const d = await gw.fetchIssueDetails(["I_1"]);
    expect(Buffer.from(d.issues[0]!.body).equals(Buffer.from(fixtureIssue.body))).toBe(true);
    expect(d.issues[0]).toEqual(fixtureIssue);
  });

  it("sai shape -> bad_output", async () => {
    const { gw } = gateway(contractFixture(), "bad-shape");
    await expect(gw.fetchIssueDetails(["I_1"])).rejects.toMatchObject({ reason: "bad_output" });
  });
});
