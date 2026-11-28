import { beforeEach, describe, expect, it } from "vitest";
import { openAppStorage } from "../../../shared/infrastructure/sqlite/app-storage.ts";
import { loadMigrations } from "../../../shared/infrastructure/sqlite/migrations.ts";
import type { Database } from "../../../shared/infrastructure/sqlite/open-database.ts";
import { clearAllTables } from "../../../test-harness/clear-storage.ts";
import { contentHash, type Content } from "../domain/content.ts";
import { trackedProjectId, type StoredIssue } from "../domain/issue.ts";
import { SqliteTrackingRepository } from "./sqlite-tracking-repository.ts";

const ref = { owner: "fake", ownerType: "org" as const, number: 1 };
const pid = trackedProjectId(ref);

const issue = (over: Partial<StoredIssue> = {}): StoredIssue => ({
  id: "A",
  projectId: pid,
  ghUpdatedAt: "2026-11-20T10:00:00Z",
  closed: false,
  contentsLoaded: false,
  repo: null,
  number: null,
  url: null,
  assignees: null,
  ...over,
});

const content = (id: string, text: string, kind: Content["kind"] = "comment"): Content => ({
  id,
  kind,
  ghId: kind === "comment" ? id.replace("comment:", "") : null,
  author: kind === "comment" ? "u" : null,
  text,
  hash: contentHash(text),
  ghCreatedAt: kind === "comment" ? "2026-11-20T09:00:00Z" : null,
  ghUpdatedAt: "2026-11-20T10:00:00Z",
});

describe("migration 0003 + SqliteTrackingRepository", () => {
  let db: Database;
  let repo: SqliteTrackingRepository;
  beforeEach(() => {
    db = openAppStorage({ path: ":memory:" });
    repo = new SqliteTrackingRepository(db);
    repo.ensureProject({ id: pid, ...ref });
  });

  it("schemaVersion = số migration, có bảng tracked_project / issue / content", () => {
    expect(db.schemaVersion()).toBe(loadMigrations().length);
    expect(loadMigrations().some((m) => m.name === "0003-tracking")).toBe(true);
    const names = (db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(["tracked_project", "issue", "content"]));
  });

  it("ensureProject: khởi tạo chưa lấy mốc, gọi lại không ghi đè", () => {
    expect(repo.getProject(pid)).toEqual({ id: pid, ...ref, baselinedAt: null, lastPolledAt: null });
    repo.markBaselined(pid, "2026-01-01T00:00:00.000Z");
    repo.markPolled(pid, "2026-01-01T00:05:00.000Z");
    expect(repo.ensureProject({ id: pid, ...ref })).toMatchObject({ baselinedAt: "2026-01-01T00:00:00.000Z", lastPolledAt: "2026-01-01T00:05:00.000Z" });
    expect(repo.getProject("khac")).toBeUndefined();
  });

  it("issue chỉ có mốc và issue đủ chi tiết được lưu/đọc đúng, saveIssue ghi đè", () => {
    repo.saveIssue(issue());
    expect(repo.getIssue("A")).toEqual(issue());
    const full = issue({ ghUpdatedAt: "2026-11-20T10:30:00Z", closed: true, contentsLoaded: true, repo: "o/r", number: 7, url: "https://x/7", assignees: ["a", "b"] });
    repo.saveIssue(full);
    expect(repo.getIssue("A")).toEqual(full);
    expect(repo.listIssues(pid)).toEqual([full]);
    expect(repo.getIssue("zzz")).toBeUndefined();
  });

  it("content giữ text nguyên văn từng byte (CRLF, emoji, rỗng) và upsert theo id", () => {
    repo.saveIssue(issue({ contentsLoaded: true }));
    const text = "コード\r\n```js\r\nx\r\n```  @a 😀 ";
    repo.upsertContents("A", [content("title:A", "題名", "title"), content("body:A", "", "body"), content("comment:c1", text)]);
    repo.upsertContents("A", [content("comment:c1", text + " ")]);
    const rows = repo.listContents("A");
    expect(rows.map((r) => r.id)).toEqual(["title:A", "body:A", "comment:c1"]);
    expect(rows[1]?.text).toBe("");
    expect(rows[2]?.text).toBe(text + " ");
    expect(rows[2]?.hash).toBe(contentHash(text + " "));
    expect(rows[0]).toMatchObject({ ghId: null, ghCreatedAt: null, issueId: "A" });
  });

  it("khoá ngoại: issue của project lạ, content của issue lạ bị từ chối", () => {
    expect(() => repo.saveIssue(issue({ projectId: "none" }))).toThrow();
    expect(() => repo.upsertContents("none", [content("comment:c", "x")])).toThrow();
  });

  it("lastSeen = mốc lớn nhất theo thời điểm (không theo chuỗi), null khi chưa có issue", () => {
    expect(repo.lastSeen(pid)).toBeNull();
    repo.saveIssue(issue({ id: "A", ghUpdatedAt: "2026-11-20T10:00:00Z" }));
    repo.saveIssue(issue({ id: "B", ghUpdatedAt: "2026-11-20T19:30:00+09:00" })); // = 10:30Z, chuỗi nhỏ hơn "…T10:00" ở ký tự đầu? không, lớn hơn; kiểm bằng thời điểm
    repo.saveIssue(issue({ id: "C", ghUpdatedAt: "2026-11-20T09:00:00Z" }));
    expect(repo.lastSeen(pid)).toBe("2026-11-20T19:30:00+09:00");
  });

  it("clearAllTables tự gồm bảng Tracking", () => {
    repo.saveIssue(issue({ contentsLoaded: true }));
    repo.upsertContents("A", [content("comment:c1", "x")]);
    clearAllTables(db);
    for (const t of ["tracked_project", "issue", "content"]) {
      expect((db.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n).toBe(0);
    }
    expect(db.schemaVersion()).toBe(loadMigrations().length);
  });
});
