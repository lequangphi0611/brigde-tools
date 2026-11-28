import { createHash } from "node:crypto";

export type ContentKind = "title" | "body" | "comment";

export const titleContentId = (issueId: string): string => `title:${issueId}`;
export const bodyContentId = (issueId: string): string => `body:${issueId}`;
export const commentContentId = (commentNodeId: string): string => `comment:${commentNodeId}`;

/** sha256 hex của text nguyên văn (không chuẩn hoá). */
export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Một phần nội dung của issue (entity `Content`); `text` là bản gốc tiếng Nhật nguyên văn. */
export interface Content {
  readonly id: string;
  readonly kind: ContentKind;
  readonly ghId: string | null; // node id comment; null cho title/body
  readonly author: string | null;
  readonly text: string;
  readonly hash: string;
  readonly ghCreatedAt: string | null; // null cho title/body
  readonly ghUpdatedAt: string;
}
