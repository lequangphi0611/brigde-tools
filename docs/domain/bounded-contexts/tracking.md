# Bounded Context: Tracking

## Aggregates

### `TrackedProject` (aggregate root)
- Trường: `id`, `owner`, `ownerType`, `number`, `title`, `listening`, `pollIntervalMin`, `notifyRules`, `lastPolledAt`, `baselinedAt` (005b), `closeRule` (005b, từ cấu hình).
- 005b: một project, cấu hình (`owner`, `ownerType`, `number`, `CloseRule`) tiêm vào `PollCycle` (chế độ fake: project cố định); 005c đọc từ `<dataDir>/config.json`. Bảng `tracked_project` chỉ giữ trạng thái chạy (`baselined_at`, `last_polled_at`), `id` suy từ `<ownerType>:<owner>/<number>`. `lastSeen` = max `Issue.ghUpdatedAt` (suy ra).
- **Invariant:**
  - Chu kỳ đầu tiên (`baselinedAt = null`): chỉ **lấy mốc** từng issue (`Issue.updatedAt` + đóng/mở), không lấy chi tiết, không phát event — không báo dồn issue cũ (005b). Chu kỳ lỗi thì chưa lấy mốc, chu kỳ thành công đầu tiên mới lấy.
  - `listening = false` → không poll, không dịch.
  - Listen lại → backfill từ lúc dừng, phát `ProjectResumed { newItemCount }`.
  - (005b, user chốt 2026-11-27) `CloseRule` theo project: `statusField` (mặc định `Status`) + `closedStatuses` (rỗng = chỉ dùng state, không đọc Status khi quét). So tên option sau NFKC + trim + viết thường. Field Status `missing`/`not_single_select` → chỉ dùng state, `[poll] … warn=…`.

### `Issue` (aggregate root)
- Trường: `id` (GitHub node id), `projectId`, `repo`, `number`, `url`, `assignees`, `listening` (`null` = kế thừa; **chưa có ở 005b**, thêm ở 006b), `readAt` (010), `ghUpdatedAt`, `closed` (005b), `contentsLoaded` (005b; `false` = issue chỉ có mốc, `repo`/`number`/`url`/`assignees` chưa có).
- Chứa danh sách `Content` (entity): `id` (`ContentId`: `title:<issueId>` / `body:<issueId>` / `comment:<commentNodeId>`), `kind: title|body|comment`, `ghId`, `author`, `textJa` (nguyên văn, không chuẩn hoá), `hash` (sha256 của text nguyên văn), `ghCreatedAt`, `ghUpdatedAt`.
- **Invariant:**
  - Listen hiệu lực = `issue.listening ?? project.listening`.
  - Unlisten issue → nội dung mới không vào hàng đợi; có thể `translateNow`.
  - Issue có thể listen riêng khi project tắt `newComment`.
  - **Issue đã đóng** (005b): `state = CLOSED` hoặc Status thuộc `closedStatuses` của project → mọi chu kỳ không lấy chi tiết, không phát event, kể cả comment mới; mốc vẫn tiến trong lúc đóng. Mở lại thì theo dõi bình thường; chuyển đóng/mở **không** phát event; comment phát sinh lúc đóng không tính là mới khi mở lại (user chốt ở GATE 1 của 005b, 2026-11-27). Issue mới vào board mà đã đóng: chỉ lưu mốc. Listen riêng issue (019) / Dịch ngay (011) vẫn dùng được cho issue đóng.
  - **Quyết định theo dõi** (005b): `trackingDecision(stamp, stored, closeRule, baselined)` là chỗ duy nhất quyết định một issue trong một chu kỳ (`baseline` / `store_closed` / `skip_closed` / `discover` / `refresh` / `unchanged`). Chỉ `discover` và `refresh` lấy chi tiết. `Issue.updatedAt` mới phải **lớn hơn** mốc đã lưu (so bằng thời điểm, không so chuỗi); mốc không bao giờ lùi. Phát hiện không dùng `Clock`.
  - **Phân loại nội dung** (005b, `refresh`), mốc `M` = `ghUpdatedAt` trước chu kỳ: comment chưa biết có `createdAt > M` → mới; chưa biết mà `createdAt ≤ M` → lưu im lặng; issue chỉ có mốc thì title/body lưu im lặng lần đầu; content đã biết có hash khác → `edited`; content biến mất → giữ, không event.
  - Issue trong `missing` của `fetchIssueDetails` hoặc biến khỏi board: giữ dữ liệu, không event, mốc không tiến. Quay lại board với `nodeId` đã biết thì so mốc bình thường (không phải issue mới).

## Domain events
Kiểu event (published language) ở `apps/app/src/shared/events/`, chỉ chứa ID + `reason` + thời điểm, không chứa nội dung. Phát qua `DomainEventPublisher` **đồng bộ trong transaction** của bên phát, mỗi issue một transaction (ADR-0011, Proposed): lưu trạng thái và giao event commit/rollback cùng nhau.

| Event | Khi nào | Ai nghe |
|---|---|---|
| `IssueDiscovered { projectId, issueId, occurredAt }` | Issue có `nodeId` chưa biết, đang mở, xuất hiện trên board sau khi project đã lấy mốc (kể cả issue cũ vừa được kéo vào board) | Translation, Notification |
| `ContentChanged { projectId, issueId, contentIds, reason, occurredAt }` | `reason`: `new_issue` (mọi content của issue mới), `new_comment` (chỉ comment mới), `edited` (title/body/comment đã biết có hash khác). Tối đa một event mỗi `reason` mỗi issue mỗi chu kỳ, `new_comment` trước `edited` | Translation (006); bên báo không nghe `edited` |
| `IssueAssignedOrMentioned` | Assignee chứa tôi hoặc text có `@me` | Notification |
| `ProjectResumed` | Listen lại project | Notification (summary toast) |

## Ports
- `GitHubGateway` (story 005a, ADR-0010 Accepted; đã thay `fetchUpdatedIssues(project, since)`; `GitHubIssueSnapshot` có thêm `comments`, `DETAIL_BATCH = 25`, comment hơn 100 được phân trang):
  - `scanProject(project, { statusField }): ProjectScan` — phân trang **toàn bộ** item của board (≈3 trang với ~286 item), mỗi Issue lấy `nodeId`, `Issue.updatedAt`, `Issue.state` và giá trị field Status của item (`fieldValueByName`, single select → `{ name, optionId }`, không có → `null`) (`ProjectIssueStamp`); `ProjectScan.statusField` = `found`/`missing`/`not_single_select`/`not_requested`; PR, draft issue, item không có quyền chỉ đếm (`skipped`). Adapter không áp quy tắc close.
  - `fetchIssueDetails(nodeIds): IssueDetails` — chi tiết theo lô (title, body, repo, number, url, assignees, **mọi** comment sắp theo `createdAt`); id không còn đọc được vào `missing`, không làm hỏng cả lô.
  - Lỗi: `GitHubFailure { reason }` (`gh_not_found` / `not_authenticated` / `scope_missing` / `project_not_found` / `projects_v2_unsupported` / `network` / `timeout` / `process_failed` / `bad_output`), không chứa owner/hostname/nội dung.
  - Adapter thật `GhCliGateway` (`contexts/tracking/infrastructure/gh-cli/`): `gh api graphql --input -`, không shell, biến GraphQL qua stdin; fake mức process `fake-gh.mjs`; fake trong bộ nhớ `FakeGitHub`. Hai adapter chạy chung contract test.
- `TrackingRepository` (005b, port của context, đồng bộ vì `node:sqlite` đồng bộ): project, issue, content, `lastSeen`. Adapter `SqliteTrackingRepository` (bảng `tracked_project`, `issue`, `content`, migration `0003-tracking.sql`).
- `DomainEventPublisher`, `UnitOfWork` (`shared/ports`, ADR-0011).
- `Clock` (chỉ cho `baselinedAt`, `lastPolledAt`, `occurredAt`).

## Quy tắc kỹ thuật đã biết (từ spike/thiết kế)
- Projects v2 không sort theo thời gian phía server → phân trang hết rồi sort phía client.
- Không dùng `item.updatedAt` (không rõ có đổi khi có comment).
- Filter `items(query: "updated:…")` không được làm nguồn duy nhất (spike S0.2: 2/286 item có `Issue.updatedAt` mới hơn `item.updatedAt`; server chỉ hiểu mức ngày) → quét toàn bộ board mỗi chu kỳ, so `Issue.updatedAt` phía client. GHES tắt rate limit.
- (Chốt ở 005b) So mốc theo **từng issue** (`Issue.ghUpdatedAt` đã lưu) thay vì chỉ một `lastSeen` của project: `nodeId` chưa biết = issue mới trên board kể cả khi `Issue.updatedAt` cũ (issue cũ vừa được kéo vào board); `lastSeen` vẫn giữ = max đã xử lý.
- Giả định comment mới làm `Issue.updatedAt` đổi: đúng trên mẫu máy thật (`newerComment=0`/145 issue có comment, `docs/spikes/projects-v2-polling.md` Lần 4). Sửa comment có thể không đổi (`editedComment`) → không thấy được comment bị sửa; chấp nhận vì sửa không báo.
