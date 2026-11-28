/**
 * Event của context Tracking (published language, ADR-0011). Chỉ chứa ID, `reason` và thời điểm, không chứa nội dung issue.
 */
export type ContentChangeReason = "new_issue" | "new_comment" | "edited";

export interface IssueDiscovered {
  readonly type: "IssueDiscovered";
  readonly projectId: string;
  readonly issueId: string;
  readonly occurredAt: string;
}

export interface ContentChanged {
  readonly type: "ContentChanged";
  readonly projectId: string;
  readonly issueId: string;
  readonly contentIds: readonly string[];
  readonly reason: ContentChangeReason;
  readonly occurredAt: string;
}

export type TrackingEvent = IssueDiscovered | ContentChanged;
