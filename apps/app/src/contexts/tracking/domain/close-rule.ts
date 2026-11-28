import type { IssueStamp } from "./github-view.ts";

/** Quy tắc "issue đã đóng" theo project (005b): `state = CLOSED` hoặc Status thuộc `closedStatuses`. */
export interface CloseRule {
  readonly statusField: string;
  readonly closedStatuses: readonly string[];
}

/** So tên option: NFKC + trim + viết thường. */
export function normalizeStatusName(name: string): string {
  return name.normalize("NFKC").trim().toLowerCase();
}

export function isIssueClosed(stamp: Pick<IssueStamp, "state" | "status">, rule: CloseRule): boolean {
  if (stamp.state === "CLOSED") return true;
  if (stamp.status === null || rule.closedStatuses.length === 0) return false;
  const status = normalizeStatusName(stamp.status.name);
  return rule.closedStatuses.some((s) => normalizeStatusName(s) === status);
}

/** Field Status cần đọc khi quét: null nếu không có `closedStatuses` (không tốn phần query Status). */
export function scanStatusField(rule: CloseRule): string | null {
  return rule.closedStatuses.length === 0 ? null : rule.statusField;
}
