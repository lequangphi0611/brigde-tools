/**
 * Port: đọc dữ liệu GitHub Projects v2. Adapter thật gọi `gh api graphql` qua child process;
 * adapter fake đọc từ fixture do e2e nạp qua test-harness.
 */
export interface ProjectRef {
  readonly owner: string;
  readonly ownerType: "org" | "user";
  readonly number: number;
}

export interface GitHubIssueSnapshot {
  readonly nodeId: string;
  readonly repo: string;
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly body: string;
  readonly assignees: readonly string[];
  readonly updatedAt: string; // ISO — luôn là Issue.updatedAt, không phải item.updatedAt
}

export interface GitHubGateway {
  fetchUpdatedIssues(project: ProjectRef, since: Date): Promise<GitHubIssueSnapshot[]>;
}
