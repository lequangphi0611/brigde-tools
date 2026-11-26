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
| Thuật ngữ | `GlossaryTerm` | Translation | Cặp ja↔vi; `projectId = null` là chung. Project thắng khi trùng |
| Phiên bản glossary | `glossaryVersion` | Translation | Đổi glossary → bản dịch cũ có thể dịch lại |
| Job dịch | `TranslationJob` | Translation | Mục trong hàng đợi: priority, status, attempts |
| Dịch ngay | `translateNow` | Translation | Người dùng yêu cầu dịch issue chưa có bản dịch |
| Dịch bù | `backfill` | Tracking→Translation | Dịch phần bỏ lỡ khi listen lại |
