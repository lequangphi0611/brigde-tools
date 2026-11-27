# Ubiquitous Language

Code, test, UI và tài liệu dùng **đúng** các từ dưới đây. Tên trong code = cột "Code".
Khi story đưa thêm khái niệm, `analyst` thêm vào đây TRƯỚC khi implement.

| Thuật ngữ | Code | Context | Định nghĩa |
|---|---|---|---|
| Dự án theo dõi | `TrackedProject` | Tracking | Một GitHub Project v2 người dùng đã thêm vào tool |
| Issue | `Issue` | Tracking | Issue GitHub nằm trên board của một TrackedProject. Định danh = GitHub node id |
| Nội dung | `Content` | Tracking | Một đoạn cần dịch: title, body hoặc một comment (`kind`) |
| Mốc đã thấy | `lastSeen` | Tracking | `Issue.updatedAt` lớn nhất đã xử lý. Luôn là của Issue, KHÔNG phải của project item |
| Chu kỳ poll | `PollCycle` | Tracking | Một lần quét một project tìm thay đổi |
| Lần quét board | `ProjectScan` | Tracking | Kết quả `GitHubGateway.scanProject`: mọi Issue trên board (`ProjectIssueStamp`), số item bị bỏ qua (PR, draft, không có quyền), số trang (story 005a) |
| Mốc của issue trên board | `ProjectIssueStamp` | Tracking | `{ nodeId, updatedAt, state, status }`: `updatedAt` = `Issue.updatedAt` (không phải của project item), `state` = `OPEN`/`CLOSED`, `status` = giá trị field Status của item hoặc `null`. Adapter chỉ trả dữ liệu, không áp quy tắc close |
| Issue đã đóng | `closed` (quy tắc của 005b) | Tracking | Issue có `state = CLOSED` **hoặc** giá trị Status của item thuộc danh sách close của project. Mọi chu kỳ: đang đóng thì không dịch, không báo (kể cả comment mới); mở lại thì theo dõi bình thường; người dùng vẫn listen riêng (019) / Dịch ngay (011) được |
| Field Status | `statusField` | Tracking | Tên field single select của Projects v2 dùng cho quy tắc close, cấu hình theo project (mặc định `Status`). Giá trị đọc được: `ProjectItemStatus { name, optionId }` |
| Danh sách close | `closedStatuses` | Tracking | Các giá trị Status coi là đã đóng, theo project; rỗng = chỉ dùng `state` (tên code chốt ở 005b) |
| Chi tiết issue | `IssueDetails` | Tracking | Kết quả `GitHubGateway.fetchIssueDetails`: `GitHubIssueSnapshot` (kèm mọi comment) + `missing` (id không còn đọc được) |
| Lỗi GitHub | `GitHubFailure` | Tracking | Lỗi của port `GitHubGateway`: `reason` = `gh_not_found` / `not_authenticated` / `scope_missing` / `project_not_found` / `projects_v2_unsupported` / `network` / `timeout` / `process_failed` / `bad_output`; không chứa owner, hostname, id hay nội dung |
| Adapter gh | `GhCliGateway` | Tracking | Adapter thật của `GitHubGateway`: gọi `gh api graphql` qua `runGhCli` (không shell, query + biến qua stdin), ADR-0010 |
| Listen / Unlisten | `ListenState` | Tracking | Theo dõi hay không. Unlisten = dừng cả dịch lẫn báo |
| Kế thừa listen | `listening: null` | Tracking | Issue không đặt riêng → theo project |
| Tạm dừng toàn cục | `pausedUntil` | Notification | Chỉ tắt toast, vẫn poll và dịch |
| Quy tắc thông báo | `NotifyRules` | Notification | `newIssue`, `assignedOrMentioned`, `newComment` — theo project |
| Toast | `Toast` | Notification | Thông báo Windows; bấm mở `localhost` đúng issue |
| Toast tóm tắt | `SummaryToast` | Notification | Một toast "N mục mới" khi listen lại project |
| Bản dịch | `Translation` | Translation | Bản dịch đã lưu của **một đoạn**, khoá = `TranslationCacheKey`; thuộc tính `text`, `model`, `createdAt`; không lưu text nguồn (story 003) |
| Cache bản dịch | `TranslationCache` | Translation | Port tra/ghi `Translation` theo khoá (`lookup`/`store`); port trong `core-translate`, adapter SQLite ở app (bảng `translation`) |
| Khoá cache | `TranslationCacheKey` | Translation | `sourceHash` (sha256 text gốc của đoạn) + `direction` + `glossaryVersion` (thuật ngữ liên quan của đoạn) + `promptVersion` + `configuredModel`. Không gồm `hint`, model thực tế |
| Phiên bản mẫu dịch | `promptVersion` | Translation | Chuỗi do bên lắp đặt truyền vào cache (vd `CLAUDE_CLI_PROMPT_VERSION = "claude-cli/p1"`); tăng tay khi đổi system prompt, định dạng stdin hay luật che phần giữ nguyên |
| Model đã cấu hình | `configuredModel` | Translation | Giá trị cờ `--model` trong `args` của cấu hình Claude CLI (lần cuối thắng), không khai báo thì `""`. Khác `model` (model thực tế đọc từ output sau khi gọi) |
| Phiên bản engine | `EngineVersion` | Translation | `{ promptVersion, configuredModel }` mà `CachingTranslator` lấy mỗi lần dịch qua hàm do composition root truyền vào (`claudeCliEngineVersion(configPath)` cho adapter thật) |
| Translator có cache | `CachingTranslator` | Translation | Decorator của `Translator`: chỉ gửi các đoạn chưa có trong cache, ghi kết quả; lỗi cache không làm hỏng việc dịch |
| Chiều dịch | `Direction` | Translation | `{ from, to }`; MVP chỉ `ja→vi` |
| Đoạn dịch | `TranslationSegment` | Translation | Một chuỗi cần dịch trong một yêu cầu, `{ id, text }`; `id` mờ do bên gọi đặt (app map `Content` → đoạn) |
| Yêu cầu dịch | `TranslationRequest` | Translation | Lô đoạn dịch + `Direction` + ngữ cảnh, đi trong **một** lần gọi engine (cả issue một lần) |
| Kết quả dịch | `TranslationResult` | Translation | Đúng tập id của yêu cầu, cùng thứ tự, kèm `model`; không có kết quả một phần |
| Phần giữ nguyên | `ProtectedSpan` | Translation | Đoạn không được dịch: code block, inline code, URL, `@mention`, email, comment HTML, thẻ phân cách giả |
| Chỗ giữ | `placeholder` | Translation | Ký hiệu `⟦N⟧` thay phần giữ nguyên khi gửi cho engine, khôi phục nguyên văn sau khi nhận |
| Lỗi dịch | `TranslationFailure` | Translation | Lỗi của port: `reason` = `not_configured` / `input_too_large` / `timeout` / `process_failed` / `bad_output`; không chứa nội dung |
| Thuật ngữ | `GlossaryTerm` | Translation | Cặp ja↔vi (+ `note`). Trong `core-translate` là `GlossaryTermInput { ja, vi, note? }`; tầng chung/project là hai danh sách riêng. `projectId` (`null` = chung) chỉ có ở lưu trữ phía app (015). Project thắng khi trùng khoá |
| Khoá thuật ngữ | `termKey` | Translation | `ja` sau NFKC, gộp khoảng trắng, trim, viết thường. Hai thuật ngữ trùng ⇔ cùng khoá (ADR-0007) |
| Glossary đã gộp | `Glossary` | Translation | Kết quả `mergeGlossary(common, project)`: danh sách `{ ja, vi }` đã chuẩn hoá, khoá duy nhất, sắp theo khoá. Là `TranslationContext.glossary` |
| Thuật ngữ liên quan | `relevantTerms` | Translation | Thuật ngữ có phía nguồn xuất hiện (sau chuẩn hoá) trong text đã che của các đoạn; chỉ những thuật ngữ này vào prompt |
| Phiên bản glossary | `glossaryVersion` | Translation | `"g1-"` + 16 hex đầu sha256 của danh sách thuật ngữ đã chuẩn hoá; rỗng = `GLOSSARY_VERSION_EMPTY`. Đổi glossary → bản dịch cũ có thể dịch lại. Khoá cache dùng version của thuật ngữ liên quan tới **từng đoạn** (002 Câu hỏi 3, story 003) |
| Job dịch | `TranslationJob` | Translation | Mục trong hàng đợi: priority, status, attempts |
| Dịch ngay | `translateNow` | Translation | Người dùng yêu cầu dịch issue chưa có bản dịch |
| Dịch bù | `backfill` | Tracking→Translation | Dịch phần bỏ lỡ khi listen lại |
| Cài đặt | `Setting` / `SettingStore` | Shared (hạ tầng) | Cặp khoá–giá trị chuỗi trong bảng `setting`. Khoá dạng `<context>.<tên>` (vd `notification.pausedUntil`); context tự mã hoá giá trị (story 004) |
| Thư mục dữ liệu | `dataDir` | Shared (hạ tầng) | Nơi chứa `app.db` (và log ở 009), ngoài thư mục code: `APP_DATA_DIR`, hoặc `%LOCALAPPDATA%\gh-issue-translator` trên Windows (ADR-0008) |
| Migration | `Migration` | Shared (hạ tầng) | File `NNNN-<tên>.sql`, một chuỗi đánh số liên tục cho toàn app; mỗi story thêm bảng thì thêm file kế tiếp, không sửa file đã merge |
| Phiên bản schema | `schemaVersion` | Shared (hạ tầng) | `PRAGMA user_version` = số migration cuối đã commit. App từ chối chạy khi lớn hơn migration nó biết |
| Lỗi lưu trữ | `StorageError` | Shared (hạ tầng) | `reason` = `open_failed` / `corrupt` / `invalid_migrations` / `migration_failed` / `schema_too_new`; kèm số migration và mã lỗi SQLite, không chứa dữ liệu |
