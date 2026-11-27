import type { Content } from "../domain/content.ts";
import type { StoredIssue, TrackedProject } from "../domain/issue.ts";

/**
 * Port của context Tracking: lưu project, issue, content. Đồng bộ vì `node:sqlite` đồng bộ; gọi trong
 * `UnitOfWork.run` khi cần nguyên tử (ADR-0011). Không có `await` giữa các lời gọi trong một transaction.
 */
export interface TrackingRepository {
  /** Tạo hàng project (chưa lấy mốc) nếu chưa có; trả trạng thái hiện tại. */
  ensureProject(ref: { id: string; owner: string; ownerType: "org" | "user"; number: number }): TrackedProject;
  getProject(id: string): TrackedProject | undefined;
  markBaselined(projectId: string, at: string): void;
  markPolled(projectId: string, at: string): void;
  /** Mọi issue của project, theo id. */
  listIssues(projectId: string): StoredIssue[];
  getIssue(id: string): StoredIssue | undefined;
  /** Chèn hoặc ghi đè toàn bộ trường của issue. */
  saveIssue(issue: StoredIssue): void;
  listContents(issueId: string): Array<Content & { issueId: string }>;
  /** Chèn hoặc cập nhật (theo `Content.id`); không xoá content nào. */
  upsertContents(issueId: string, contents: readonly Content[]): void;
  /** `MAX(Issue.ghUpdatedAt)` của project (so bằng thời điểm), null nếu chưa có issue. Cho 009 / 018. */
  lastSeen(projectId: string): string | null;
}
