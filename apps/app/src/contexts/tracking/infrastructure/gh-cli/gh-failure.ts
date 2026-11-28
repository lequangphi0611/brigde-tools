import type { GitHubFailureReason } from "../../../../shared/ports/github-gateway.port.ts";

// Chỉ các mẫu lỗi mạng cụ thể (mã errno, thông điệp Go/Node/TLS); chữ "connect"/"timeout"/"proxy" trần có thể nằm trong nội dung issue.
const NETWORK_PATTERN =
  /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|dial tcp|connection refused|connection reset|no such host|i\/o timeout|TLS handshake timeout|tls: |x509:|certificate (signed by unknown|has expired|verify failed)|proxyconnect/i;

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
  if (NETWORK_PATTERN.test(text)) return "network";
  return null;
}
