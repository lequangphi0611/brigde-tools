import type { GitHubIssueSnapshot, ProjectRef } from "../shared/ports/github-gateway.port.ts";

/**
 * Dữ liệu một board Projects v2 giả. Dùng chung cho `FakeGitHub` (trong bộ nhớ) và `fake-gh.mjs` (mức process)
 * để contract test chạy cùng fixture cho cả hai adapter.
 */
export interface FixtureStatusOption {
  readonly name: string;
  readonly optionId: string;
}

export interface FixtureStatusField {
  readonly name: string;
  readonly kind: "single_select" | "text";
  readonly options: readonly FixtureStatusOption[];
}

export type FixtureItem =
  | {
      readonly kind: "issue";
      readonly issue: GitHubIssueSnapshot;
      /** item.updatedAt của project item; cố ý có thể khác Issue.updatedAt. */
      readonly itemUpdatedAt?: string;
      readonly state?: "OPEN" | "CLOSED"; // mặc định OPEN
      /** Tên option Status của item; bỏ trống = chưa có giá trị. */
      readonly status?: string;
    }
  | { readonly kind: "pullRequest" }
  | { readonly kind: "draftIssue" }
  | { readonly kind: "inaccessible" };

export interface GitHubFixture {
  readonly project: ProjectRef;
  readonly statusField: FixtureStatusField | null;
  readonly items: readonly FixtureItem[];
  /** Issue tồn tại (đọc được bằng nodes(ids)) nhưng không nằm trên board. */
  readonly extraIssues?: readonly GitHubIssueSnapshot[];
}
