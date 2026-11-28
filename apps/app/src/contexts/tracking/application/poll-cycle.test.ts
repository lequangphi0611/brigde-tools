import { beforeEach, describe, expect, it } from "vitest";
import { openAppStorage } from "../../../shared/infrastructure/sqlite/app-storage.ts";
import { classifyStorageFailure } from "../../../shared/infrastructure/sqlite/storage-error.ts";
import { formatPollLine } from "./poll-line.ts";
import { SqliteUnitOfWork } from "../../../shared/infrastructure/sqlite/sqlite-unit-of-work.ts";
import type { Database } from "../../../shared/infrastructure/sqlite/open-database.ts";
import {
  GitHubFailure,
  type GitHubCommentSnapshot,
  type GitHubIssueSnapshot,
  type IssueDetails,
  type ProjectScan,
} from "../../../shared/ports/github-gateway.port.ts";
import type { GitHubFixture, FixtureItem } from "../../../test-harness/github-fixture.ts";
import { ControllableClock, FakeGitHub } from "../../../test-harness/fakes.ts";
import { RecordingEventBus } from "../../../test-harness/recording-event-bus.ts";
import { SqliteTrackingRepository } from "../infrastructure/sqlite-tracking-repository.ts";
import { trackedProjectId } from "../domain/issue.ts";
import { PollCycle, type PollProjectConfig } from "./poll-cycle.ts";
import type { PollReport, PollStats } from "./poll-report.ts";

const D = "2026-11-20";
const t = (hm: string) => `${D}T${hm}:00Z`;
const cm = (nodeId: string, hm: string, body = `text ${nodeId}`): GitHubCommentSnapshot => ({ nodeId, author: "u", body, createdAt: t(hm), updatedAt: t(hm) });
const issue = (nodeId: string, hm: string, over: Partial<GitHubIssueSnapshot> = {}): GitHubIssueSnapshot => ({
  nodeId, repo: "o/r", number: 1, url: `https://x/${nodeId}`, title: `title ${nodeId}`, body: `body ${nodeId}`, assignees: [], updatedAt: t(hm), comments: [], ...over,
});
type Item = { issue: GitHubIssueSnapshot; state?: "OPEN" | "CLOSED"; status?: string };

class Env {
  db: Database = openAppStorage({ path: ":memory:" });
  github = new FakeGitHub();
  clock = new ControllableClock();
  bus = new RecordingEventBus();
  repo = new SqliteTrackingRepository(this.db);
  project: PollProjectConfig = { owner: "fake", ownerType: "org", number: 1, statusField: "Status", closedStatuses: [] };
  extra: FixtureItem[] = [];
  scanCalls: Array<string | null> = [];
  detailCalls: string[][] = [];
  constructor() {
    const scan = this.github.scanProject.bind(this.github);
    this.github.scanProject = async (p, o) => {
      this.scanCalls.push(o.statusField);
      return scan(p, o);
    };
    const fetch = this.github.fetchIssueDetails.bind(this.github);
    this.github.fetchIssueDetails = async (ids) => {
      this.detailCalls.push([...ids]);
      return fetch(ids);
    };
  }
  board(items: Item[], statusOptions: string[] = ["Done", "完了"], statusField: GitHubFixture["statusField"] = null) {
    this.github.load({
      project: this.project,
      statusField: statusField ?? { name: "Status", kind: "single_select", options: statusOptions.map((name, i) => ({ name, optionId: `o${i}` })) },
      items: items.map((i) => ({ kind: "issue", issue: i.issue, ...(i.state ? { state: i.state } : {}), ...(i.status ? { status: i.status } : {}) })),
    });
  }
  cycle() {
    return new PollCycle({
      github: this.github, repository: this.repo, unitOfWork: new SqliteUnitOfWork(this.db), publisher: this.bus,
      clock: this.clock, project: this.project, elapsedClock: () => 0, classifyStorageError: classifyStorageFailure,
    });
  }
  run(): Promise<PollReport> {
    return this.cycle().run();
  }
  get pid() {
    return trackedProjectId(this.project);
  }
  events() {
    return this.bus.published;
  }
  take() {
    const e = [...this.bus.published];
    this.bus.published.length = 0;
    return e;
  }
}
const stats = (r: PollReport): PollStats => {
  if (r.status === "FAIL") throw new Error("FAIL: " + JSON.stringify(r.cause));
  return r.stats;
};
const types = (es: ReturnType<Env["take"]>) => es.map((e) => (e.type === "ContentChanged" ? `CC:${e.issueId}:${e.reason}:${e.contentIds.join(",")}` : `ID:${e.issueId}`));

let env: Env;
beforeEach(() => {
  env = new Env();
});

/** Lấy mốc với các issue cho trước, rồi dọn lịch sử gọi. */
async function baseline(items: Item[], statusOptions?: string[]) {
  env.board(items, statusOptions);
  const r = await env.run();
  expect(r.status).toBe("BASELINE");
  env.take();
  env.detailCalls.length = 0;
}
/** Lấy mốc rồi nạp nội dung đầy đủ của A bằng cách coi A là issue mới trong chu kỳ sau. */
async function withContent(a: GitHubIssueSnapshot, others: Item[] = []) {
  await baseline(others);
  env.board([{ issue: a }, ...others]);
  await env.run();
  env.take();
  env.detailCalls.length = 0;
}

describe("AC-1/2 lần đầu", () => {
  it("AC-1 chỉ lấy mốc", async () => {
    env.clock.set("2026-11-20T12:00:00Z");
    env.board([{ issue: issue("A", "10:00") }, { issue: issue("B", "11:00") }, { issue: issue("C", "09:00"), state: "CLOSED" }]);
    const r = await env.run();
    expect(r.status).toBe("BASELINE");
    expect(stats(r)).toMatchObject({ issues: 3, closed: 1 });
    expect(env.detailCalls).toEqual([]);
    expect(env.events()).toEqual([]);
    expect(env.repo.listIssues(env.pid).map((i) => [i.id, i.ghUpdatedAt, i.closed, i.contentsLoaded])).toEqual([
      ["A", t("10:00"), false, false], ["B", t("11:00"), false, false], ["C", t("09:00"), true, false],
    ]);
    expect(env.repo.lastSeen(env.pid)).toBe(t("11:00"));
    expect(env.repo.getProject(env.pid)?.baselinedAt).toBe("2026-11-20T12:00:00.000Z");
  });
  it("AC-2 board rỗng rồi issue thêm sau là mới", async () => {
    env.board([]);
    expect((await env.run()).status).toBe("BASELINE");
    expect(env.repo.getProject(env.pid)?.baselinedAt).not.toBeNull();
    env.board([{ issue: issue("A", "10:00") }]);
    const r = await env.run();
    expect(r.status).toBe("OK");
    expect(types(env.take())).toEqual(["ID:A", "CC:A:new_issue:title:A,body:A"]);
  });
});

describe("AC-3/4/5 issue mới và không đổi", () => {
  it("AC-3 issue mới với 2 comment", async () => {
    await baseline([]);
    const n = issue("N", "10:00", { comments: [cm("c1", "09:00"), cm("c2", "09:30")] });
    env.board([{ issue: n }]);
    const r = await env.run();
    expect(env.detailCalls).toEqual([["N"]]);
    const es = env.take();
    expect(types(es)).toEqual(["ID:N", "CC:N:new_issue:title:N,body:N,comment:c1,comment:c2"]);
    expect(JSON.stringify(es)).not.toContain("body N");
    expect(env.repo.listContents("N")).toHaveLength(4);
    expect(env.repo.getIssue("N")).toMatchObject({ contentsLoaded: true, repo: "o/r", closed: false });
    expect(stats(r)).toMatchObject({ newIssues: 1, details: 1 });
    expect(es[0]).toMatchObject({ occurredAt: "2026-01-01T00:00:00.000Z" });
  });
  it("AC-4 issue cũ mới vào board là issue mới", async () => {
    await baseline([{ issue: issue("A", "10:00") }]);
    env.board([{ issue: issue("A", "10:00") }, { issue: issue("O", "00:00", { updatedAt: "2025-01-01T00:00:00Z" }) }]);
    await env.run();
    expect(types(env.take())[0]).toBe("ID:O");
  });
  it("AC-5 không đổi hoặc mốc lùi thì không lấy chi tiết", async () => {
    await baseline([{ issue: issue("A", "10:00") }]);
    for (const hm of ["10:00", "09:00"]) {
      env.board([{ issue: issue("A", hm) }]);
      const r = await env.run();
      expect(stats(r).details).toBe(0);
    }
    expect(env.detailCalls).toEqual([]);
    expect(env.events()).toEqual([]);
    expect(env.repo.getIssue("A")?.ghUpdatedAt).toBe(t("10:00"));
  });
});

describe("AC-6…13 refresh", () => {
  it("AC-6 comment mới", async () => {
    await withContent(issue("A", "10:00", { comments: [cm("c1", "09:00")] }));
    env.board([{ issue: issue("A", "10:30", { comments: [cm("c1", "09:00"), cm("c2", "10:30")] }) }]);
    const r = await env.run();
    expect(types(env.take())).toEqual(["CC:A:new_comment:comment:c2"]);
    expect(env.repo.getIssue("A")?.ghUpdatedAt).toBe(t("10:30"));
    expect(env.repo.listContents("A").map((c) => c.id)).toContain("comment:c2");
    expect(stats(r)).toMatchObject({ newComments: 1, newIssues: 0 });
  });
  it("AC-7 issue chỉ có mốc có comment mới", async () => {
    await baseline([{ issue: issue("A", "10:00") }]);
    env.board([{ issue: issue("A", "10:30", { comments: [cm("c1", "09:00"), cm("c2", "10:00"), cm("c3", "10:30")] }) }]);
    await env.run();
    expect(types(env.take())).toEqual(["CC:A:new_comment:comment:c3"]);
    expect(env.repo.listContents("A")).toHaveLength(5);
    expect(env.repo.getIssue("A")?.contentsLoaded).toBe(true);
  });
  it("AC-8 issue chỉ có mốc đổi không có comment mới", async () => {
    await baseline([{ issue: issue("A", "10:00") }]);
    env.board([{ issue: issue("A", "10:30", { title: "sửa" }) }]);
    await env.run();
    expect(env.events()).toEqual([]);
    expect(env.repo.listContents("A")).toHaveLength(2);
    expect(env.repo.getIssue("A")?.ghUpdatedAt).toBe(t("10:30"));
  });
  it("AC-9 body bị sửa", async () => {
    await withContent(issue("A", "10:00"));
    env.board([{ issue: issue("A", "10:30", { body: "mới" }) }]);
    const r = await env.run();
    expect(types(env.take())).toEqual(["CC:A:edited:body:A"]);
    expect(env.repo.listContents("A").find((c) => c.id === "body:A")?.text).toBe("mới");
    expect(stats(r).edited).toBe(1);
  });
  it("AC-10 comment bị sửa", async () => {
    await withContent(issue("A", "10:00", { comments: [cm("c1", "09:00")] }));
    env.board([{ issue: issue("A", "10:30", { comments: [cm("c1", "09:00", "đổi")] }) }]);
    await env.run();
    expect(types(env.take())).toEqual(["CC:A:edited:comment:c1"]);
  });
  it("AC-11 comment mới và body sửa: new_comment rồi edited", async () => {
    await withContent(issue("A", "10:00"));
    env.board([{ issue: issue("A", "10:30", { body: "mới", comments: [cm("c2", "10:20")] }) }]);
    await env.run();
    expect(types(env.take())).toEqual(["CC:A:new_comment:comment:c2", "CC:A:edited:body:A"]);
  });
  it("AC-12 updatedAt đổi, nội dung không đổi, comment bị xoá", async () => {
    await withContent(issue("A", "10:00", { comments: [cm("c1", "09:00"), cm("c2", "09:30")] }));
    env.board([{ issue: issue("A", "10:30", { comments: [cm("c1", "09:00")] }) }]);
    await env.run();
    expect(env.events()).toEqual([]);
    expect(env.repo.getIssue("A")?.ghUpdatedAt).toBe(t("10:30"));
    expect(env.repo.listContents("A").map((c) => c.id)).toContain("comment:c2");
  });
  it("AC-13 nội dung đặc biệt nguyên văn", async () => {
    await baseline([]);
    const text = "コード\r\n```js\r\nx\r\n```\r\n`a` [l](https://x) @user 😀  ";
    env.board([{ issue: issue("N", "10:00", { body: "", comments: [cm("c1", "09:00", text)] }) }]);
    await env.run();
    expect(types(env.take())[1]).toContain("body:N");
    expect(env.repo.listContents("N").find((c) => c.id === "body:N")?.text).toBe("");
    expect(env.repo.listContents("N").find((c) => c.id === "comment:c1")?.text).toBe(text);
    env.board([{ issue: issue("N", "10:10", { body: "", comments: [cm("c1", "09:00", text)] }) }]);
    await env.run();
    expect(env.events()).toEqual([]);
    env.board([{ issue: issue("N", "10:20", { body: "", comments: [cm("c1", "09:00", text + " ")] }) }]);
    await env.run();
    expect(types(env.take())).toEqual(["CC:N:edited:comment:c1"]);
  });
});

describe("AC-14…17 lỗi và missing", () => {
  it("AC-14 lỗi khi quét: không ghi gì, chu kỳ sau bình thường", async () => {
    await baseline([{ issue: issue("A", "10:00") }]);
    const before = env.repo.getProject(env.pid);
    const rowsBefore = env.repo.listIssues(env.pid);
    const real = env.github.scanProject.bind(env.github);
    env.github.scanProject = async () => {
      throw new GitHubFailure("not_authenticated");
    };
    const r = await env.run();
    expect(r).toMatchObject({ status: "FAIL", cause: { type: "github", reason: "not_authenticated" } });
    expect(env.repo.getProject(env.pid)).toEqual(before);
    expect(env.repo.listIssues(env.pid)).toEqual(rowsBefore);
    expect(env.events()).toEqual([]);
    env.github.scanProject = real;
    env.board([{ issue: issue("A", "10:00") }, { issue: issue("N", "10:30") }]);
    await env.run();
    expect(types(env.take())[0]).toBe("ID:N");
  });
  it("AC-14 chưa lấy mốc: lỗi không ghi hàng nào, thành công đầu tiên là BASELINE", async () => {
    env.github.scanProject = async () => {
      throw new GitHubFailure("timeout");
    };
    await env.run();
    expect(env.repo.getProject(env.pid)).toBeUndefined();
    env.github = new FakeGitHub();
    env.board([{ issue: issue("A", "10:00") }]);
    expect((await env.run()).status).toBe("BASELINE");
  });
  it("AC-15 lỗi khi lấy chi tiết: không lưu gì, kể cả mốc của issue đóng", async () => {
    await baseline([{ issue: issue("A", "10:00") }, { issue: issue("D", "10:00") }]);
    const real = env.github.fetchIssueDetails.bind(env.github);
    env.github.fetchIssueDetails = async () => {
      throw new GitHubFailure("timeout");
    };
    const board = [{ issue: issue("A", "10:30", { comments: [cm("c1", "10:30")] }) }, { issue: issue("D", "10:40"), state: "CLOSED" as const }, { issue: issue("N", "10:50") }];
    env.board(board);
    const r = await env.run();
    expect(r).toMatchObject({ status: "FAIL", cause: { reason: "timeout" } });
    expect(env.repo.getIssue("D")).toMatchObject({ ghUpdatedAt: t("10:00"), closed: false });
    expect(env.events()).toEqual([]);
    env.github.fetchIssueDetails = real;
    await env.run();
    expect(types(env.take())).toEqual(["CC:A:new_comment:comment:c1", "ID:N", "CC:N:new_issue:title:N,body:N"]);
  });
  it("AC-16 issue missing", async () => {
    await withContent(issue("A", "10:00"));
    env.github.fetchIssueDetails = async (ids): Promise<IssueDetails> => ({ issues: [], missing: [...ids] });
    env.board([{ issue: issue("A", "10:30", { body: "x" }) }, { issue: issue("N", "10:40") }]);
    const r = await env.run();
    expect(r.status).toBe("OK");
    expect(stats(r)).toMatchObject({ missing: 2, failed: 0 });
    expect(env.events()).toEqual([]);
    expect(env.repo.getIssue("A")?.ghUpdatedAt).toBe(t("10:00"));
    expect(env.repo.getIssue("N")).toBeUndefined();
  });
  it("AC-17 issue biến khỏi board rồi quay lại không phải issue mới", async () => {
    await withContent(issue("A", "10:00"));
    env.board([]);
    await env.run();
    expect(env.events()).toEqual([]);
    expect(env.repo.listContents("A")).toHaveLength(2);
    env.board([{ issue: issue("A", "11:00", { comments: [cm("c2", "10:30")] }) }]);
    await env.run();
    expect(types(env.take())).toEqual(["CC:A:new_comment:comment:c2"]);
  });
});

describe("AC-18…23 issue đóng", () => {
  it("AC-18 đóng theo state có comment mới", async () => {
    await withContent(issue("A", "10:00"));
    env.board([{ issue: issue("A", "10:30", { comments: [cm("c2", "10:30")] }), state: "CLOSED" }]);
    const r = await env.run();
    expect(env.detailCalls).toEqual([]);
    expect(env.events()).toEqual([]);
    expect(env.repo.getIssue("A")).toMatchObject({ closed: true, ghUpdatedAt: t("10:30"), contentsLoaded: true });
    expect(env.repo.listContents("A")).toHaveLength(2);
    expect(stats(r)).toMatchObject({ closedChanged: 1, newComments: 0 });
  });
  it("AC-19 đóng theo Status (NFKC, trim, hoa thường)", async () => {
    env.project = { ...env.project, closedStatuses: ["完了", " Done "] };
    await baseline([{ issue: issue("A", "10:00") }, { issue: issue("B", "10:00") }], ["done", "ｸﾛｰｽﾞ"]);
    env.board(
      [
        { issue: issue("A", "10:30", { comments: [cm("c", "10:30")] }), status: "done" },
        { issue: issue("B", "10:30", { comments: [cm("d", "10:30")] }), status: "ｸﾛｰｽﾞ" },
      ],
      ["done", "ｸﾛｰｽﾞ"],
    );
    await env.run();
    expect(env.scanCalls.at(-1)).toBe("Status");
    expect(env.detailCalls).toEqual([["B"]]);
    expect(types(env.take())).toEqual(["CC:B:new_comment:comment:d"]);
    expect(env.repo.getIssue("A")?.closed).toBe(true);
  });
  it("AC-20 issue mới vào board mà đã đóng", async () => {
    await baseline([]);
    env.board([{ issue: issue("N", "10:00"), state: "CLOSED" }]);
    const r = await env.run();
    expect(env.detailCalls).toEqual([]);
    expect(env.events()).toEqual([]);
    expect(env.repo.getIssue("N")).toMatchObject({ closed: true, contentsLoaded: false });
    expect(stats(r)).toMatchObject({ closedChanged: 1, newIssues: 0 });
  });
  it("AC-21 mở lại", async () => {
    await withContent(issue("A", "09:00"));
    env.board([{ issue: issue("A", "10:00", { comments: [cm("c2", "09:30")] }), state: "CLOSED" }]);
    await env.run();
    env.board([{ issue: issue("A", "11:00", { comments: [cm("c2", "09:30"), cm("c3", "11:00")] }) }]);
    await env.run();
    expect(types(env.take())).toEqual(["CC:A:new_comment:comment:c3"]);
    expect(env.repo.listContents("A").map((c) => c.id)).toContain("comment:c2");
    expect(env.repo.getIssue("A")?.closed).toBe(false);
    env.board([{ issue: issue("A", "11:30"), state: "CLOSED" }]);
    await env.run();
    env.detailCalls.length = 0;
    env.board([{ issue: issue("A", "11:30") }]);
    await env.run();
    expect(env.detailCalls).toEqual([]);
    expect(env.events()).toEqual([]);
    expect(env.repo.getIssue("A")?.closed).toBe(false);
  });
  it("AC-22 closedStatuses rỗng: scan với statusField null", async () => {
    await baseline([{ issue: issue("A", "10:00") }]);
    expect(env.scanCalls.at(-1)).toBeNull();
  });
  it("AC-23 field Status không dùng được", async () => {
    env.project = { ...env.project, closedStatuses: ["Done"] };
    env.github.load({ project: env.project, statusField: null, items: [{ kind: "issue", issue: issue("A", "10:00") }] });
    const r = await env.run();
    expect(r).toMatchObject({ status: "BASELINE", warn: "status_field_missing" });
    env.github.load({ project: env.project, statusField: { name: "Status", kind: "text", options: [] }, items: [{ kind: "issue", issue: issue("A", "10:00") }] });
    expect(await env.run()).toMatchObject({ warn: "status_field_not_single_select" });
    // chỉ state quyết định đóng: Status "Done" không làm đóng, state CLOSED thì đóng
    env.github.load({
      project: env.project,
      statusField: { name: "Status", kind: "text", options: [] },
      items: [{ kind: "issue", issue: issue("S", "10:00"), status: "Done" }, { kind: "issue", issue: issue("X", "10:00"), state: "CLOSED" }],
    });
    const r2 = await env.run();
    expect(stats(r2).closed).toBe(1);
    expect(env.repo.getIssue("X")?.closed).toBe(true);
    expect(env.repo.getIssue("S")?.closed).toBe(false);
  });
});

describe("AC-24/25", () => {
  it("AC-24 restart: PollCycle mới trên cùng DB", async () => {
    await withContent(issue("A", "10:00"));
    env.board([{ issue: issue("A", "10:30", { comments: [cm("c2", "10:30")] }) }]);
    await env.run();
    env.take();
    const r = await env.cycle().run();
    expect(r.status).toBe("OK");
    expect(env.events()).toEqual([]);
  });
  it("AC-25 lỗi một issue không chặn issue khác", async () => {
    await baseline([]);
    env.board([{ issue: issue("N1", "10:00") }, { issue: issue("N2", "10:10") }]);
    env.bus.failWhen = (e) => e.issueId === "N1";
    const r = await env.run();
    expect(r.status).toBe("PARTIAL");
    expect(stats(r).failed).toBe(1);
    expect(env.repo.getIssue("N1")).toBeUndefined();
    expect(env.repo.listContents("N1")).toEqual([]);
    expect(types(env.take())).toEqual(["ID:N2", "CC:N2:new_issue:title:N2,body:N2"]);
    env.bus.failWhen = null;
    const r2 = await env.run();
    expect(r2.status).toBe("OK");
    expect(types(env.take())).toEqual(["ID:N1", "CC:N1:new_issue:title:N1,body:N1"]);
  });
  it("lỗi không phải GitHubFailure là FAIL internal", async () => {
    env.github.scanProject = async (): Promise<ProjectScan> => {
      throw new Error("boom");
    };
    expect(await env.run()).toMatchObject({ status: "FAIL", cause: { type: "internal" } });
  });
});

describe("chạy chồng (ADR-0011)", () => {
  it("hai run() song song trên cùng PollCycle chia sẻ một chu kỳ: mỗi event đúng một lần", async () => {
    await baseline([]);
    env.board([{ issue: issue("N", "10:00") }]);
    const cycle = env.cycle();
    const [a, b] = await Promise.all([cycle.run(), cycle.run()]);
    expect(a).toBe(b);
    expect(env.detailCalls).toHaveLength(1);
    expect(types(env.take())).toEqual(["ID:N", "CC:N:new_issue:title:N,body:N"]);
  });
  it("hai PollCycle riêng chạy song song trên cùng DB: transaction đọc lại và bỏ qua issue đã xử lý", async () => {
    await withContent(issue("A", "10:00"));
    env.board([{ issue: issue("A", "10:30", { comments: [cm("c2", "10:30")] }) }, { issue: issue("N", "10:40") }]);
    const [r1, r2] = await Promise.all([env.cycle().run(), env.cycle().run()]);
    expect([r1.status, r2.status]).toEqual(["OK", "OK"]);
    expect(types(env.take()).sort()).toEqual(["CC:A:new_comment:comment:c2", "CC:N:new_issue:title:N,body:N", "ID:N"]);
  });
});

describe("FAIL storage", () => {
  it("lỗi SQLite khi ghi lấy mốc là FAIL storage sqlite=<mã>, lỗi ngoài danh mục là internal", async () => {
    env.board([{ issue: issue("A", "10:00") }]);
    env.repo.saveIssue = () => {
      throw Object.assign(new Error("busy"), { errcode: 5 });
    };
    const r = await env.run();
    expect(r).toMatchObject({ status: "FAIL", cause: { type: "storage", sqliteCode: 5 } });
    expect(formatPollLine(r)).toMatch(/^\[poll\] FAIL storage sqlite=5$/);
    env.repo.saveIssue = () => {
      throw new Error("lạ");
    };
    expect(await env.run()).toMatchObject({ cause: { type: "internal" } });
  });
});

describe("AC-27 dòng log không lộ dữ liệu", () => {
  it("chạy chu kỳ thật với dữ liệu đặc trưng rồi kiểm dòng log", async () => {
    env.project = { owner: "acme-org", ownerType: "org", number: 4242, statusField: "社内ステータス", closedStatuses: ["機密完了"] };
    const secret = ["acme-org", "I_kwDOsecret", "機密タイトル", "社内ステータス", "機密完了", "4242"];
    const mk = (hm: string, extra: Partial<GitHubIssueSnapshot> = {}) => issue("I_kwDOsecret", hm, { title: "機密タイトル", ...extra });
    env.github.load({
      project: env.project,
      statusField: { name: "社内ステータス", kind: "single_select", options: [{ name: "機密完了", optionId: "o" }] },
      items: [{ kind: "issue", issue: mk("10:00"), status: "機密完了" }],
    });
    const lines = [formatPollLine(await env.run())];
    env.github.load({
      project: env.project,
      statusField: { name: "社内ステータス", kind: "single_select", options: [{ name: "機密完了", optionId: "o" }] },
      items: [{ kind: "issue", issue: mk("11:00", { comments: [cm("c9", "11:00")] }) }, { kind: "issue", issue: issue("I_kwDOnew", "11:00") }],
    });
    lines.push(formatPollLine(await env.run()));
    env.github.scanProject = async () => {
      throw new GitHubFailure("timeout", "acme-org");
    };
    lines.push(formatPollLine(await env.run()));
    for (const line of lines) for (const s of secret) expect(line).not.toContain(s);
    expect(lines.map((l) => l.split(" ")[1])).toEqual(["BASELINE", "OK", "FAIL"]);
  });
});
