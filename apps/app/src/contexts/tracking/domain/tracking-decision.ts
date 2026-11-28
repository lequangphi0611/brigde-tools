import type { IssueStamp } from "./github-view.ts";
import { isIssueClosed, type CloseRule } from "./close-rule.ts";
import type { StoredIssue } from "./issue.ts";
import { isAfter } from "./timestamps.ts";

export type TrackingDecisionKind = "baseline" | "store_closed" | "skip_closed" | "discover" | "refresh" | "unchanged";

export interface TrackingDecision {
  readonly kind: TrackingDecisionKind;
  /** Issue đóng theo `CloseRule` trong lần quét này. */
  readonly closed: boolean;
}

/** Chỉ `discover` và `refresh` cần lấy chi tiết. */
export function needsDetails(kind: TrackingDecisionKind): boolean {
  return kind === "discover" || kind === "refresh";
}

/**
 * Chỗ duy nhất quyết định "có theo dõi issue này trong chu kỳ này không" (005b). 006b / 019 chỉ sửa hàm này.
 * Không dùng Clock: chỉ so mốc GitHub với mốc GitHub đã lưu.
 */
export function trackingDecision(input: {
  stamp: Pick<IssueStamp, "updatedAt" | "state" | "status">;
  stored: Pick<StoredIssue, "ghUpdatedAt"> | undefined;
  closeRule: CloseRule;
  baselined: boolean;
}): TrackingDecision {
  const { stamp, stored, closeRule, baselined } = input;
  const closed = isIssueClosed(stamp, closeRule);
  if (!baselined) return { kind: "baseline", closed };
  if (closed) return { kind: stored ? "skip_closed" : "store_closed", closed };
  if (!stored) return { kind: "discover", closed };
  return { kind: isAfter(stamp.updatedAt, stored.ghUpdatedAt) ? "refresh" : "unchanged", closed };
}
