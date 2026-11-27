import type { GitHubFailureReason, ProjectScan } from "../../../shared/ports/github-gateway.port.ts";

/** Số đếm của một chu kỳ; `PollCycle` tự đếm (không dùng `detailStats` của adapter). */
export interface PollStats {
  readonly issues: number;
  readonly closed: number;
  readonly skipped: ProjectScan["skipped"];
  readonly pages: number;
  readonly details: number;
  readonly missing: number;
  readonly newIssues: number;
  readonly newComments: number;
  readonly edited: number;
  readonly closedChanged: number;
  readonly failed: number;
}

export type PollWarning = "status_field_missing" | "status_field_not_single_select";

export type PollFailureCause =
  | { readonly type: "github"; readonly reason: GitHubFailureReason }
  | { readonly type: "storage"; readonly sqliteCode?: number }
  | { readonly type: "internal" };

/** Báo cáo chu kỳ (JSON được; trả qua `POST /__test__/poll`). */
export type PollReport =
  | { readonly status: "BASELINE" | "OK" | "PARTIAL"; readonly stats: PollStats; readonly warn?: PollWarning; readonly ms: number }
  | { readonly status: "FAIL"; readonly cause: PollFailureCause; readonly ms?: number };
