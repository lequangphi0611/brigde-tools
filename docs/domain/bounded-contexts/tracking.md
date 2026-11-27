# Bounded Context: Tracking

## Aggregates

### `TrackedProject` (aggregate root)
- Trường: `id`, `owner`, `ownerType`, `number`, `title`, `listening`, `pollIntervalMin`, `notifyRules`, `lastPolledAt`.
- **Invariant:**
  - Lần thêm đầu tiên: `lastSeen = now` — không báo dồn issue cũ.
  - `listening = false` → không poll, không dịch.
  - Listen lại → backfill từ lúc dừng, phát `ProjectResumed { newItemCount }`.
  - (005b, user chốt 2026-11-27) Cấu hình close theo project: `statusField` (mặc định `Status`) + `closedStatuses` (rỗng = chỉ dùng state).

### `Issue` (aggregate root)
- Trường: `id` (GitHub node id), `projectId`, `repo`, `number`, `url`, `assignees`, `listening` (`null` = kế thừa), `readAt`, `ghUpdatedAt`.
- Chứa danh sách `Content` (entity): `kind: title|body|comment`, `ghId`, `author`, `textJa`, `hash`, `ghCreatedAt`.
- **Invariant:**
  - Listen hiệu lực = `issue.listening ?? project.listening`.
  - Unlisten issue → nội dung mới không vào hàng đợi; có thể `translateNow`.
  - Issue có thể listen riêng khi project tắt `newComment`.
  - **Issue đã đóng** (005b): `state = CLOSED` hoặc Status thuộc `closedStatuses` của project → mọi chu kỳ không dịch, không báo, kể cả comment mới; mở lại thì theo dõi bình thường. Listen riêng issue (019) / Dịch ngay (011) vẫn dùng được cho issue đóng. Lần đầu vẫn chỉ lấy mốc. Event khi chuyển đóng/mở và cách xử lý comment trong lúc đóng: chốt ở 005b.

## Domain events
| Event | Khi nào | Ai nghe |
|---|---|---|
| `IssueDiscovered` | Issue mới xuất hiện trên board | Translation, Notification |
| `ContentChanged` | Title/body/comment mới hoặc đổi (hash khác) | Translation |
| `IssueAssignedOrMentioned` | Assignee chứa tôi hoặc text có `@me` | Notification |
| `ProjectResumed` | Listen lại project | Notification (summary toast) |

## Ports
- `GitHubGateway` (story 005a, ADR-0010 Proposed; thay `fetchUpdatedIssues(project, since)`):
  - `scanProject(project, { statusField }): ProjectScan` — phân trang **toàn bộ** item của board (≈3 trang với ~286 item), mỗi Issue lấy `nodeId`, `Issue.updatedAt`, `Issue.state` và giá trị field Status của item (`fieldValueByName`, single select → `{ name, optionId }`, không có → `null`) (`ProjectIssueStamp`); `ProjectScan.statusField` = `found`/`missing`/`not_single_select`/`not_requested`; PR, draft issue, item không có quyền chỉ đếm (`skipped`). Adapter không áp quy tắc close.
  - `fetchIssueDetails(nodeIds): IssueDetails` — chi tiết theo lô (title, body, repo, number, url, assignees, **mọi** comment sắp theo `createdAt`); id không còn đọc được vào `missing`, không làm hỏng cả lô.
  - Lỗi: `GitHubFailure { reason }` (`gh_not_found` / `not_authenticated` / `scope_missing` / `project_not_found` / `projects_v2_unsupported` / `network` / `timeout` / `process_failed` / `bad_output`), không chứa owner/hostname/nội dung.
  - Adapter thật `GhCliGateway` (`contexts/tracking/infrastructure/gh-cli/`): `gh api graphql --input -`, không shell, biến GraphQL qua stdin; fake mức process `fake-gh.mjs`; fake trong bộ nhớ `FakeGitHub`. Hai adapter chạy chung contract test.
- `Clock`.

## Quy tắc kỹ thuật đã biết (từ spike/thiết kế)
- Projects v2 không sort theo thời gian phía server → phân trang hết rồi sort phía client.
- Không dùng `item.updatedAt` (không rõ có đổi khi có comment).
- Filter `items(query: "updated:…")` không được làm nguồn duy nhất (spike S0.2: 2/286 item có `Issue.updatedAt` mới hơn `item.updatedAt`; server chỉ hiểu mức ngày) → quét toàn bộ board mỗi chu kỳ, so `Issue.updatedAt` phía client. GHES tắt rate limit.
- (Định hướng cho 005b, chốt khi phân tích 005b) So mốc theo **từng issue** (`Issue.ghUpdatedAt` đã lưu) thay vì chỉ một `lastSeen` của project: `nodeId` chưa biết = issue mới trên board kể cả khi `Issue.updatedAt` cũ (issue cũ vừa được kéo vào board); `lastSeen` vẫn giữ = max đã xử lý.
- Giả định cần kiểm (`diagnose` dòng `comments`, `github-check` trường `newerComment`): comment mới làm `Issue.updatedAt` đổi. Sửa comment có thể không đổi (`editedComment`) → không thấy được comment bị sửa; chấp nhận vì sửa không báo.
