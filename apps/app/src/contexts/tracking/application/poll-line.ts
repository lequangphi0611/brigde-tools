import type { PollReport } from "./poll-report.ts";

/**
 * Dòng log `[poll] …` của một chu kỳ. Chỉ mã và số đếm: không owner, số project, hostname, node id,
 * tên field/Status, title hay nội dung (AC-27).
 */
export function formatPollLine(report: PollReport): string {
  if (report.status === "FAIL") {
    const { cause } = report;
    const parts = ["[poll] FAIL"];
    if (cause.type === "github") parts.push(`github:${cause.reason}`);
    else if (cause.type === "storage") parts.push(cause.sqliteCode !== undefined ? `storage sqlite=${cause.sqliteCode}` : "storage");
    else parts.push("internal");
    if (cause.type === "github" && report.ms !== undefined) parts.push(`ms=${report.ms}`);
    return parts.join(" ");
  }
  const s = report.stats;
  const skipped = `skipped=pr:${s.skipped.pullRequest},draft:${s.skipped.draftIssue},noaccess:${s.skipped.inaccessible}`;
  const fields =
    report.status === "BASELINE"
      ? [`issues=${s.issues}`, `closed=${s.closed}`, skipped, `pages=${s.pages}`]
      : [
          `issues=${s.issues}`,
          `closed=${s.closed}`,
          `details=${s.details}`,
          `missing=${s.missing}`,
          `new=${s.newIssues}`,
          `newComments=${s.newComments}`,
          `edited=${s.edited}`,
          `closedChanged=${s.closedChanged}`,
          `failed=${s.failed}`,
          `pages=${s.pages}`,
        ];
  if (report.warn) fields.push(`warn=${report.warn}`);
  fields.push(`ms=${report.ms}`);
  return `[poll] ${report.status} ${fields.join(" ")}`;
}
