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
| Listen / Unlisten | `ListenState` | Tracking | Theo dõi hay không. Unlisten = dừng cả dịch lẫn báo |
| Kế thừa listen | `listening: null` | Tracking | Issue không đặt riêng → theo project |
| Tạm dừng toàn cục | `pausedUntil` | Notification | Chỉ tắt toast, vẫn poll và dịch |
| Quy tắc thông báo | `NotifyRules` | Notification | `newIssue`, `assignedOrMentioned`, `newComment` — theo project |
| Toast | `Toast` | Notification | Thông báo Windows; bấm mở `localhost` đúng issue |
| Toast tóm tắt | `SummaryToast` | Notification | Một toast "N mục mới" khi listen lại project |
| Bản dịch | `Translation` | Translation | Kết quả dịch, khoá = `hash(text) + direction` |
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
| Phiên bản glossary | `glossaryVersion` | Translation | `"g1-"` + 16 hex đầu sha256 của danh sách thuật ngữ đã chuẩn hoá; rỗng = `GLOSSARY_VERSION_EMPTY`. Đổi glossary → bản dịch cũ có thể dịch lại. Tính trên cả glossary hay trên thuật ngữ liên quan của từng đoạn: story 003 chốt |
| Job dịch | `TranslationJob` | Translation | Mục trong hàng đợi: priority, status, attempts |
| Dịch ngay | `translateNow` | Translation | Người dùng yêu cầu dịch issue chưa có bản dịch |
| Dịch bù | `backfill` | Tracking→Translation | Dịch phần bỏ lỡ khi listen lại |
