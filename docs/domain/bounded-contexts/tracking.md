# Bounded Context: Tracking

## Aggregates

### `TrackedProject` (aggregate root)
- Trường: `id`, `owner`, `ownerType`, `number`, `title`, `listening`, `pollIntervalMin`, `notifyRules`, `lastPolledAt`.
- **Invariant:**
  - Lần thêm đầu tiên: `lastSeen = now` — không báo dồn issue cũ.
  - `listening = false` → không poll, không dịch.
  - Listen lại → backfill từ lúc dừng, phát `ProjectResumed { newItemCount }`.

### `Issue` (aggregate root)
- Trường: `id` (GitHub node id), `projectId`, `repo`, `number`, `url`, `assignees`, `listening` (`null` = kế thừa), `readAt`, `ghUpdatedAt`.
- Chứa danh sách `Content` (entity): `kind: title|body|comment`, `ghId`, `author`, `textJa`, `hash`, `ghCreatedAt`.
- **Invariant:**
  - Listen hiệu lực = `issue.listening ?? project.listening`.
  - Unlisten issue → nội dung mới không vào hàng đợi; có thể `translateNow`.
  - Issue có thể listen riêng khi project tắt `newComment`.

## Domain events
| Event | Khi nào | Ai nghe |
|---|---|---|
| `IssueDiscovered` | Issue mới xuất hiện trên board | Translation, Notification |
| `ContentChanged` | Title/body/comment mới hoặc đổi (hash khác) | Translation |
| `IssueAssignedOrMentioned` | Assignee chứa tôi hoặc text có `@me` | Notification |
| `ProjectResumed` | Listen lại project | Notification (summary toast) |

## Ports
- `GitHubGateway.fetchUpdatedIssues(project, since)` — một GraphQL query/project/chu kỳ, lọc trùng phía client theo `Issue.updatedAt > lastSeen`.
- `Clock`.

## Quy tắc kỹ thuật đã biết (từ spike/thiết kế)
- Projects v2 không sort theo thời gian phía server → phân trang hết rồi sort phía client.
- Không dùng `item.updatedAt` (không rõ có đổi khi có comment).
