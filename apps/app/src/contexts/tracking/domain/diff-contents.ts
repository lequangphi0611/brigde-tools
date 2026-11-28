import type { IssueView } from "./github-view.ts";
import { bodyContentId, commentContentId, contentHash, titleContentId, type Content } from "./content.ts";
import { isAfter } from "./timestamps.ts";

/** Mọi Content của snapshot theo thứ tự title, body, comment (theo `createdAt`, rồi nodeId). */
export function contentsOf(snapshot: IssueView): Content[] {
  const comments = [...snapshot.comments].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.nodeId.localeCompare(b.nodeId));
  return [
    { id: titleContentId(snapshot.nodeId), kind: "title", ghId: null, author: null, text: snapshot.title, hash: contentHash(snapshot.title), ghCreatedAt: null, ghUpdatedAt: snapshot.updatedAt },
    { id: bodyContentId(snapshot.nodeId), kind: "body", ghId: null, author: null, text: snapshot.body, hash: contentHash(snapshot.body), ghCreatedAt: null, ghUpdatedAt: snapshot.updatedAt },
    ...comments.map(
      (c): Content => ({
        id: commentContentId(c.nodeId),
        kind: "comment",
        ghId: c.nodeId,
        author: c.author,
        text: c.body,
        hash: contentHash(c.body),
        ghCreatedAt: c.createdAt,
        ghUpdatedAt: c.updatedAt,
      }),
    ),
  ];
}

export interface ContentDiff {
  /** Content cần ghi (mới hoặc hash khác); content không đổi không có ở đây. */
  readonly upserts: readonly Content[];
  /** Id comment mới (createdAt > M), theo `createdAt`. */
  readonly newComments: readonly string[];
  /** Id content đã biết có hash khác, theo thứ tự title, body, comment. */
  readonly edited: readonly string[];
}

/**
 * Phân loại nội dung của `refresh`. `previousUpdatedAt` = `M`, mốc đã lưu trước chu kỳ.
 * Issue chỉ có mốc (`contentsLoaded = false`): lưu im lặng title/body, không bao giờ `edited`.
 * Content đã lưu mà snapshot không còn (comment bị xoá) không xuất hiện ở đây nên được giữ nguyên.
 */
export function diffContents(input: {
  snapshot: IssueView;
  storedHashes: ReadonlyMap<string, string>;
  contentsLoaded: boolean;
  previousUpdatedAt: string;
}): ContentDiff {
  const { snapshot, storedHashes, contentsLoaded, previousUpdatedAt } = input;
  const upserts: Content[] = [];
  const newComments: string[] = [];
  const edited: string[] = [];
  for (const content of contentsOf(snapshot)) {
    const storedHash = contentsLoaded ? storedHashes.get(content.id) : undefined;
    if (storedHash === undefined) {
      upserts.push(content);
      if (content.kind === "comment" && content.ghCreatedAt !== null && isAfter(content.ghCreatedAt, previousUpdatedAt)) {
        newComments.push(content.id);
      }
    } else if (storedHash !== content.hash) {
      upserts.push(content);
      edited.push(content.id);
    }
  }
  return { upserts, newComments, edited };
}
