import type { ProjectKey } from "./github-view.ts";

/** Khoá ổn định của project suy từ cấu hình: `<ownerType>:<owner>/<number>`. */
export function trackedProjectId(ref: ProjectKey): string {
  return `${ref.ownerType}:${ref.owner}/${ref.number}`;
}

/** Trạng thái chạy của project (cấu hình khác như `CloseRule` không lưu). */
export interface TrackedProject {
  readonly id: string;
  readonly owner: string;
  readonly ownerType: "org" | "user";
  readonly number: number;
  readonly baselinedAt: string | null; // null = chưa lấy mốc
  readonly lastPolledAt: string | null;
}

/** `StoredIssue` = dạng lưu của aggregate `Issue` (tracking.md): giữ tên này vì chưa gồm `Content`. Issue đã lưu. `contentsLoaded = false` = issue chỉ có mốc, ba trường sau là null. */
export interface StoredIssue {
  readonly id: string;
  readonly projectId: string;
  readonly ghUpdatedAt: string;
  readonly closed: boolean;
  readonly contentsLoaded: boolean;
  readonly repo: string | null;
  readonly number: number | null;
  readonly url: string | null;
  readonly assignees: readonly string[] | null;
}
