import type { GitHubFailureReason } from "../../../../shared/ports/github-gateway.port.ts";

/**
 * Phân loại lỗi `gh` theo stderr/stdout (cùng quy tắc `classifyGhError` của scripts/diagnose, viết lại bằng TS).
 * Trả null khi không nhận ra (người gọi dùng `process_failed`). Văn bản đầu vào có thể chứa hostname/owner:
 * chỉ dùng để so khớp, không bao giờ đưa vào `GitHubFailure`.
 */
export function classifyGhFailure(text: string): GitHubFailureReason | null {
  if (/projectV2/i.test(text) && /doesn't exist|undefined field/i.test(text)) return "projects_v2_unsupported";
  if (/INSUFFICIENT_SCOPES|read:project|required scopes/i.test(text)) return "scope_missing";
  if (/Could not resolve to an? (Organization|User)\b/i.test(text)) return "project_not_found";
  if (/HTTP 401|Bad credentials|gh auth login|not logged/i.test(text)) return "not_authenticated";
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|dial tcp|i\/o timeout|timeout|connect|certificate|x509|proxy/i.test(text)) return "network";
  return null;
}
