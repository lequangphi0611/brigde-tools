/**
 * Kiểu tối thiểu của dữ liệu GitHub mà domain Tracking cần (domain không import port). Các kiểu DTO của
 * `GitHubGateway` thoả cấu trúc này nên adapter/application truyền thẳng được.
 */
export interface ProjectKey {
  readonly owner: string;
  readonly ownerType: "org" | "user";
  readonly number: number;
}

export interface IssueStamp {
  readonly updatedAt: string;
  readonly state: "OPEN" | "CLOSED";
  readonly status: { readonly name: string } | null;
}

export interface CommentView {
  readonly nodeId: string;
  readonly author: string | null;
  readonly body: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IssueView {
  readonly nodeId: string;
  readonly title: string;
  readonly body: string;
  readonly updatedAt: string;
  readonly comments: readonly CommentView[];
}
