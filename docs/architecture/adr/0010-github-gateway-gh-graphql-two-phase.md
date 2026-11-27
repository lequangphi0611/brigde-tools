# ADR-0010: Đọc Projects v2 qua `gh api graphql`, quét toàn bộ rồi lấy chi tiết theo lô

- Trạng thái: Proposed (story 005a; GATE 1 duyệt hướng 2026-11-27, chờ số đo `diagnose` Lần 4 để chốt cách truyền query, `DETAIL_BATCH` và xử lý lỗi một phần)
- Ngày: 2026-11-27
- Liên quan: ADR-0002 (port + fake), ADR-0003 (mẫu runner process an toàn), spike S0.2 (`docs/spikes/projects-v2-polling.md`), story 005a (`docs/features/005a-github-gateway/spec.md`), 005b (poller, dùng port này)

## Bối cảnh
- Máy thật dùng GHES qua `GH_HOST`, đã đăng nhập bằng `gh`, token có `read:project`. GHES tắt rate limit.
- Spike S0.2: filter `items(query: "updated:…")` dựa trên `item.updatedAt` và chỉ hiểu mức ngày; có 2/286 item với `Issue.updatedAt` mới hơn `item.updatedAt` → filter không được làm nguồn duy nhất. Projects v2 không sort theo thời gian phía server.
- Poller cần: (1) thấy mọi issue trên board, kể cả issue cũ vừa được kéo vào board; (2) với issue đã đổi, có title/body/comment để so hash và `ghId`.
- Không debug được trên máy thật; chỉ gõ lại được mã và số đếm.

## Các lựa chọn
Cách gọi GitHub:
- a. REST/GraphQL bằng `fetch` + token tự quản lý: phải lấy token và hostname ra khỏi `gh`, tự xử lý proxy/chứng chỉ công ty.
- b. **`gh api graphql`** qua child process: dùng lại xác thực, `GH_HOST`, proxy mà `gh` đã chạy được (`diagnose` đã dùng).

Hình dạng truy vấn:
- c. Một query mỗi chu kỳ gộp item + issue + comment: kéo body và comment của cả board (~286 issue) mỗi chu kỳ chỉ để dùng vài mục; payload lớn, node limit của GraphQL với comment lồng.
- d. **Hai pha:** quét toàn bộ item chỉ lấy `Issue.id` + `Issue.updatedAt` (≈3 trang); sau đó `nodes(ids:)` theo lô cho các issue đã đổi, lấy đủ comment (phân trang khi > 100).
- e. Filter `updated:` để thu hẹp rồi lấy chi tiết: bỏ sót (spike), loại.

Truyền query:
- f. `-f query=… -F biến=…` trong argv (đã chạy được trong `diagnose`): danh sách id khó truyền thành biến mảng; argv dài.
- g. **`--input -`**: thân JSON `{ query, variables }` qua stdin; mọi giá trị (owner, số project, cursor, id) là biến GraphQL. Cần kiểm chứng trên Windows/GHES (`diagnose` dòng `gql stdin`); không chạy thì quay về f.

## Quyết định (đề xuất)
Chọn b + d + g.
- Port `GitHubGateway`: `scanProject(project): ProjectScan` và `fetchIssueDetails(nodeIds): IssueDetails`. Bỏ `fetchUpdatedIssues(project, since)`: so mốc là việc của domain Tracking (005b), không phải adapter.
- `GH_HOST` bắt buộc (`github-check` báo `gh_host_unset`; nhánh thật của app ở 005b theo cùng quy tắc), để `gh` không âm thầm gọi github.com.
- Runner `runGhCli`: `spawn` không shell, `windowsHide`, kế thừa env + `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1`, `NO_COLOR=1`; timeout 60 s/lần gọi; giới hạn stdout 32 MB. Không thư mục tạm.
- Lỗi một phần: stdout là JSON có `data` thì dùng `data` dù mã thoát ≠ 0; node `null` → `missing`. (Cần kiểm chứng `gh` có in stdout khi có `errors` — `diagnose` dòng `gql partial`.)
- Lỗi khác → `GitHubFailure { reason }`, không chứa stderr gốc (có thể có hostname/owner).
- PR, draft issue, item không có quyền: bỏ qua, chỉ đếm.
- Query quét lấy thêm `Issue.state` và giá trị field Status của item (`fieldValueByName(name: $statusField)` → `ProjectV2ItemFieldSingleSelectValue { name optionId }`; trang đầu thêm `projectV2.field(name:)` để phân biệt field không có với item chưa có giá trị). Tên field là biến, `null` thì bỏ phần này (`@include`). Adapter chỉ trả dữ liệu; quy tắc "issue đã đóng" (state CLOSED hoặc Status thuộc danh sách close của project, user chốt 2026-11-27) thuộc domain Tracking (005b). Cần kiểm chứng `fieldValueByName`/`field(name:)` trên GHES 3.20 (`diagnose` dòng `item scan`).
- Fake: `FakeGitHub` (trong bộ nhớ, e2e) và `fake-gh.mjs` (mức process, test adapter); contract test chung.

## Hệ quả
- Mỗi chu kỳ ít nhất 3 lần gọi `gh` (một project ~286 item) + `ceil(n/DETAIL_BATCH)` khi có thay đổi. Chấp nhận vì GHES tắt rate limit; nếu sau này có rate limit thì xem lại (filter `updated:` theo ngày để thu hẹp, vẫn so phía client).
- Board lớn hơn nhiều (vài nghìn item) làm chu kỳ chậm tuyến tính; `diagnose` dòng `item scan` và `github-check` `scanMs` cho số đo.
- Phát hiện comment mới dựa trên giả định comment mới đẩy `Issue.updatedAt` (kiểm bằng `newerComment`). Comment bị sửa có thể không đẩy mốc → bị bỏ qua (sửa vốn không báo).
- Phụ thuộc định dạng thông báo lỗi của `gh` để phân loại; đổi phiên bản `gh` có thể làm phân loại rơi về `process_failed` (vẫn an toàn).
- Đổi Status trên board làm `item.updatedAt` đổi nhưng không đổi `Issue.updatedAt`; vì quét đọc Status của mọi item mỗi chu kỳ nên vẫn thấy, không cần dựa vào mốc.
- Query nằm trong adapter, domain không thấy JSON của GitHub (ACL).
