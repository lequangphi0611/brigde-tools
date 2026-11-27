import { describe, expect, it } from "vitest";
import type { GitHubCommentSnapshot, GitHubIssueSnapshot } from "../../../shared/ports/github-gateway.port.ts";
import { commentContentId, contentHash } from "./content.ts";
import { contentsOf, diffContents } from "./diff-contents.ts";

const comment = (nodeId: string, createdAt: string, body = `body ${nodeId}`): GitHubCommentSnapshot => ({ nodeId, author: "a", body, createdAt, updatedAt: createdAt });
const snapshot = (over: Partial<GitHubIssueSnapshot> = {}): GitHubIssueSnapshot => ({
  nodeId: "A",
  repo: "o/r",
  number: 1,
  url: "https://x/1",
  title: "題名",
  body: "本文",
  assignees: [],
  updatedAt: "2026-11-20T10:30:00Z",
  comments: [],
  ...over,
});
const hashesOf = (s: GitHubIssueSnapshot) => new Map(contentsOf(s).map((c) => [c.id, c.hash]));
const M = "2026-11-20T10:00:00Z";

describe("contentsOf", () => {
  it("thứ tự title, body, comment theo createdAt; text và hash nguyên văn", () => {
    const s = snapshot({ body: "", comments: [comment("c2", "2026-11-20T10:30:00Z"), comment("c1", "2026-11-20T09:00:00Z", "a\r\n `x` ")] });
    const cs = contentsOf(s);
    expect(cs.map((c) => c.id)).toEqual(["title:A", "body:A", "comment:c1", "comment:c2"]);
    expect(cs[1]).toMatchObject({ text: "", hash: contentHash("") });
    expect(cs[2]?.text).toBe("a\r\n `x` ");
  });
});

describe("diffContents", () => {
  it("AC-6: comment chưa lưu có createdAt > M là mới", () => {
    const s = snapshot({ comments: [comment("c1", "2026-11-20T09:00:00Z"), comment("c2", "2026-11-20T10:30:00Z")] });
    const stored = hashesOf(snapshot({ comments: [comment("c1", "2026-11-20T09:00:00Z")] }));
    const d = diffContents({ snapshot: s, storedHashes: stored, contentsLoaded: true, previousUpdatedAt: M });
    expect(d.newComments).toEqual([commentContentId("c2")]);
    expect(d.edited).toEqual([]);
    expect(d.upserts.map((c) => c.id)).toEqual(["comment:c2"]);
  });
  it("AC-7: issue chỉ có mốc: title/body/comment ≤ M lưu im lặng, chỉ comment > M là mới", () => {
    const s = snapshot({ comments: [comment("c1", "2026-11-20T09:00:00Z"), comment("c2", "2026-11-20T10:00:00Z"), comment("c3", "2026-11-20T10:30:00Z")] });
    const d = diffContents({ snapshot: s, storedHashes: new Map(), contentsLoaded: false, previousUpdatedAt: M });
    expect(d.newComments).toEqual(["comment:c3"]);
    expect(d.edited).toEqual([]);
    expect(d.upserts).toHaveLength(5);
  });
  it("AC-8: issue chỉ có mốc đổi không có comment mới: không event nào", () => {
    const d = diffContents({ snapshot: snapshot(), storedHashes: new Map(), contentsLoaded: false, previousUpdatedAt: M });
    expect(d.newComments).toEqual([]);
    expect(d.edited).toEqual([]);
    expect(d.upserts).toHaveLength(2);
  });
  it("AC-9/10/11: hash khác là edited; mới trước, edited sau (title, body, comment)", () => {
    const before = snapshot({ comments: [comment("c1", "2026-11-20T09:00:00Z")] });
    const after = snapshot({ title: "新題名", body: "新本文", comments: [comment("c1", "2026-11-20T09:00:00Z", "sửa"), comment("c2", "2026-11-20T10:30:00Z")] });
    const d = diffContents({ snapshot: after, storedHashes: hashesOf(before), contentsLoaded: true, previousUpdatedAt: M });
    expect(d.edited).toEqual(["title:A", "body:A", "comment:c1"]);
    expect(d.newComments).toEqual(["comment:c2"]);
  });
  it("AC-12: không đổi, comment bị xoá thì không event và không upsert", () => {
    const before = snapshot({ comments: [comment("c1", "2026-11-20T09:00:00Z"), comment("c2", "2026-11-20T09:30:00Z")] });
    const after = snapshot({ comments: [comment("c1", "2026-11-20T09:00:00Z")] });
    const d = diffContents({ snapshot: after, storedHashes: hashesOf(before), contentsLoaded: true, previousUpdatedAt: M });
    expect(d).toEqual({ upserts: [], newComments: [], edited: [] });
  });
  it("AC-13: chỉ khác khoảng trắng cuối dòng cũng là edited, text giữ nguyên byte", () => {
    const text = "コード\r\n```js\r\nx\r\n```  @mention 😀";
    const before = snapshot({ comments: [comment("c1", "2026-11-20T09:00:00Z", text)] });
    const same = diffContents({ snapshot: before, storedHashes: hashesOf(before), contentsLoaded: true, previousUpdatedAt: M });
    expect(same.edited).toEqual([]);
    const trailing = snapshot({ comments: [comment("c1", "2026-11-20T09:00:00Z", text + " ")] });
    const d = diffContents({ snapshot: trailing, storedHashes: hashesOf(before), contentsLoaded: true, previousUpdatedAt: M });
    expect(d.edited).toEqual(["comment:c1"]);
  });
  it("AC-21: comment tạo lúc đóng (≤ M) lưu im lặng, sau M là mới", () => {
    const s = snapshot({ comments: [comment("c2", "2026-11-20T09:30:00Z"), comment("c3", "2026-11-20T11:00:00Z")] });
    const before = snapshot();
    const d = diffContents({ snapshot: s, storedHashes: hashesOf(before), contentsLoaded: true, previousUpdatedAt: M });
    expect(d.newComments).toEqual(["comment:c3"]);
    expect(d.upserts.map((c) => c.id)).toEqual(["comment:c2", "comment:c3"]);
  });
});
