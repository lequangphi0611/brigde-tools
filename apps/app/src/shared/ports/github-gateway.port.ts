/**
 * Port: đọc dữ liệu GitHub Projects v2 (ADR-0010). Adapter thật gọi `gh api graphql` qua child process;
 * adapter fake đọc từ fixture do test nạp qua test-harness.
 *
 * Hai pha: `scanProject` thấy mọi Issue trên board (chỉ nodeId + mốc), `fetchIssueDetails` lấy nội dung
 * cho những issue đã đổi. Adapter chỉ trả dữ liệu, không áp quy tắc "issue đã đóng" (domain Tracking, 005b).
 */
export interface ProjectRef {
  readonly owner: string;
  readonly ownerType: "org" | "user";
  readonly number: number;
}

/** Giá trị field single select của item trên board. */
export interface ProjectItemStatus {
  readonly name: string;
  readonly optionId: string;
}

export interface ProjectIssueStamp {
  readonly nodeId: string;
  readonly updatedAt: string; // ISO — luôn là Issue.updatedAt, không phải item.updatedAt
  readonly state: "OPEN" | "CLOSED"; // Issue.state
  /** null: không yêu cầu field, field không có, item chưa có giá trị, hoặc field không phải single select. */
  readonly status: ProjectItemStatus | null;
}

export interface ScanOptions {
  /** Tên field Status của project; null = không đọc. */
  readonly statusField: string | null;
}

export interface ProjectScan {
  readonly issues: readonly ProjectIssueStamp[]; // mọi Issue trên board, mỗi nodeId một lần
  readonly skipped: { readonly pullRequest: number; readonly draftIssue: number; readonly inaccessible: number };
  readonly statusField: "found" | "missing" | "not_single_select" | "not_requested";
  readonly pages: number;
}

export interface GitHubCommentSnapshot {
  readonly nodeId: string;
  readonly author: string | null; // null: tài khoản đã xoá
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GitHubIssueSnapshot {
  readonly nodeId: string;
  readonly repo: string; // owner/name
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly body: string;
  readonly assignees: readonly string[];
  readonly updatedAt: string; // ISO — luôn là Issue.updatedAt, không phải item.updatedAt
  readonly comments: readonly GitHubCommentSnapshot[]; // đủ mọi comment, createdAt tăng dần
}

export interface IssueDetails {
  readonly issues: readonly GitHubIssueSnapshot[];
  /** nodeId không còn đọc được. */
  readonly missing: readonly string[];
}

export type GitHubFailureReason =
  | "gh_not_found"
  | "not_authenticated"
  | "scope_missing"
  | "project_not_found"
  | "projects_v2_unsupported"
  | "network"
  | "timeout"
  | "process_failed"
  | "bad_output";

/** Lỗi của adapter GitHub. Message và detail không chứa owner, hostname, id hay nội dung. */
export class GitHubFailure extends Error {
  constructor(
    readonly reason: GitHubFailureReason,
    readonly detail?: string,
  ) {
    super(reason);
    this.name = "GitHubFailure";
  }
}

export interface GitHubGateway {
  scanProject(project: ProjectRef, options: ScanOptions): Promise<ProjectScan>;
  fetchIssueDetails(nodeIds: readonly string[]): Promise<IssueDetails>;
}
