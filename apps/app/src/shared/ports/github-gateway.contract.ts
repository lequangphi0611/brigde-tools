import { describe, expect, it } from "vitest";
import type { FixtureItem, GitHubFixture } from "../../test-harness/github-fixture.ts";
import type { GitHubCommentSnapshot, GitHubGateway, GitHubIssueSnapshot, ProjectRef } from "./github-gateway.port.ts";

/**
 * Bộ hợp đồng chung cho mọi `GitHubGateway` (ADR-0002, AC-9): `FakeGitHub` và `GhCliGateway` + fake gh
 * chạy cùng một bộ case trên cùng fixture. `create` dựng adapter đã nạp sẵn fixture.
 */
export const CONTRACT_PROJECT: ProjectRef = { owner: "acme", ownerType: "org", number: 3 };

const comment = (nodeId: string, author: string | null, body: string, createdAt: string): GitHubCommentSnapshot => ({
  nodeId,
  author,
  body,
  createdAt,
  updatedAt: createdAt,
});

export const JA_BODY = "再現手順:\n```ts\nconst x = 1;\n```\n[リンク](https://example.test/a) @tanaka 👍 修正お願いします";

export function issue(nodeId: string, patch: Partial<GitHubIssueSnapshot> = {}): GitHubIssueSnapshot {
  return {
    nodeId,
    repo: "acme/web",
    number: 1,
    url: `https://ghes.example.test/acme/web/issues/1`,
    title: "ログイン不具合",
    body: "本文",
    assignees: ["tanaka"],
    updatedAt: "2026-11-01T00:00:00Z",
    comments: [],
    ...patch,
  };
}

export const STATUS_OPTIONS = [
  { name: "In Progress", optionId: "opt_1" },
  { name: "Done", optionId: "opt_2" },
] as const;

export function contractFixture(): GitHubFixture {
  const items: FixtureItem[] = [
    { kind: "issue", issue: issue("I_open", { number: 1, updatedAt: "2026-11-03T00:00:00Z" }), itemUpdatedAt: "2026-11-09T00:00:00Z", status: "In Progress" },
    { kind: "issue", issue: issue("I_closed", { number: 2, updatedAt: "2026-11-02T00:00:00Z" }), state: "CLOSED", status: "Done" },
    { kind: "issue", issue: issue("I_nostatus", { number: 3, updatedAt: "2026-11-01T00:00:00Z" }) },
    {
      kind: "issue",
      issue: issue("I_1", {
        number: 4,
        title: "日本語のタイトル 🙂",
        body: JA_BODY,
        updatedAt: "2026-11-04T00:00:00Z",
        comments: [
          comment("C_1", "suzuki", "確認しました\n```\ncode\n```", "2026-11-04T01:00:00Z"),
          comment("C_2", null, "削除されたユーザーのコメント", "2026-11-04T02:00:00Z"),
        ],
      }),
    },
    { kind: "pullRequest" },
    { kind: "pullRequest" },
    { kind: "draftIssue" },
    { kind: "inaccessible" },
  ];
  return {
    project: CONTRACT_PROJECT,
    statusField: { name: "Status", kind: "single_select", options: STATUS_OPTIONS },
    items,
  };
}

export function runGitHubGatewayContract(name: string, options: { create: (fixture: GitHubFixture) => GitHubGateway | Promise<GitHubGateway> }): void {
  const make = async (patch: Partial<GitHubFixture> = {}) => options.create({ ...contractFixture(), ...patch });

  describe(`GitHubGateway contract: ${name}`, () => {
    it("scanProject trả state và status, không áp quy tắc close, mốc là Issue.updatedAt", async () => {
      const scan = await (await make()).scanProject(CONTRACT_PROJECT, { statusField: "Status" });
      expect(scan.statusField).toBe("found");
      expect(scan.issues).toEqual([
        { nodeId: "I_open", updatedAt: "2026-11-03T00:00:00Z", state: "OPEN", status: { name: "In Progress", optionId: "opt_1" } },
        { nodeId: "I_closed", updatedAt: "2026-11-02T00:00:00Z", state: "CLOSED", status: { name: "Done", optionId: "opt_2" } },
        { nodeId: "I_nostatus", updatedAt: "2026-11-01T00:00:00Z", state: "OPEN", status: null },
        { nodeId: "I_1", updatedAt: "2026-11-04T00:00:00Z", state: "OPEN", status: null },
      ]);
      expect(scan.pages).toBe(1);
    });

    it("scanProject đếm PR, draft, item không có quyền vào skipped", async () => {
      const scan = await (await make()).scanProject(CONTRACT_PROJECT, { statusField: "Status" });
      expect(scan.skipped).toEqual({ pullRequest: 2, draftIssue: 1, inaccessible: 1 });
    });

    it("tên field không có trong project -> missing, mọi status null", async () => {
      const scan = await (await make()).scanProject(CONTRACT_PROJECT, { statusField: "Trạng thái" });
      expect(scan.statusField).toBe("missing");
      expect(scan.issues.map((i) => i.status)).toEqual([null, null, null, null]);
    });

    it("field Status kiểu text -> not_single_select, mọi status null", async () => {
      const scan = await (await make({ statusField: { name: "Status", kind: "text", options: [] } })).scanProject(CONTRACT_PROJECT, { statusField: "Status" });
      expect(scan.statusField).toBe("not_single_select");
      expect(scan.issues.map((i) => i.status)).toEqual([null, null, null, null]);
    });

    it("statusField null -> not_requested, mọi status null, state vẫn trả", async () => {
      const scan = await (await make()).scanProject(CONTRACT_PROJECT, { statusField: null });
      expect(scan.statusField).toBe("not_requested");
      expect(scan.issues.map((i) => i.status)).toEqual([null, null, null, null]);
      expect(scan.issues.find((i) => i.nodeId === "I_closed")?.state).toBe("CLOSED");
    });

    it("fetchIssueDetails giữ nguyên tiếng Nhật, code block, link, emoji; comment tăng dần; ghost là null", async () => {
      const details = await (await make()).fetchIssueDetails(["I_1"]);
      expect(details.missing).toEqual([]);
      expect(details.issues).toEqual([(contractFixture().items[3] as Extract<FixtureItem, { kind: "issue" }>).issue]);
      const snap = details.issues[0]!;
      expect(snap.title).toBe("日本語のタイトル 🙂");
      expect(snap.body).toBe(JA_BODY);
      expect(snap.comments.map((c) => c.author)).toEqual(["suzuki", null]);
    });

    it("id không còn đọc được vào missing, phần còn lại vẫn trả", async () => {
      const details = await (await make()).fetchIssueDetails(["I_1", "I_gone"]);
      expect(details.issues.map((i) => i.nodeId)).toEqual(["I_1"]);
      expect(details.missing).toEqual(["I_gone"]);
    });

    it("fetchIssueDetails([]) trả rỗng", async () => {
      expect(await (await make()).fetchIssueDetails([])).toEqual({ issues: [], missing: [] });
    });

    it("id lặp chỉ trả một lần", async () => {
      const details = await (await make()).fetchIssueDetails(["I_open", "I_open"]);
      expect(details.issues.map((i) => i.nodeId)).toEqual(["I_open"]);
    });
  });
}
