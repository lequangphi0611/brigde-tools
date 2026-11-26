# Chạy `diagnose` trên máy công ty

Máy công ty không push ngược lại được và không được mang dữ liệu ra ngoài. `diagnose` chỉ in trạng thái, phiên bản, số đếm, thời gian và mã lỗi, nên **gõ lại các dòng đó** cho Claude là đủ. Đừng gửi output của `--raw`: nó có thể chứa hostname hoặc owner, chỉ dùng để tự đọc.

## Chuẩn bị

1. Tải zip của repo, giải nén. Không cần `pnpm install`, chỉ cần Node ≥ 22 và `gh`.
2. `gh auth login --hostname <host GHES>`. Token phải có scope `read:project`: `gh auth refresh -s read:project --hostname <host>`.
3. (Tuỳ chọn) chép `config/claude-cli.example.json` → `config/claude-cli.local.json`, sửa `command` thành đường dẫn tuyệt đối tới `claude.exe`. Không có file này thì `diagnose` tìm `claude` trong PATH.

## Chạy (PowerShell, ở thư mục repo)

```powershell
$env:GH_HOST = "<host GHES>"
node scripts/diagnose/index.mjs --owner <org> --number <số project>                # GitHub + claude -p
node scripts/diagnose/index.mjs --owner <org> --number <n> --scheduler --toast     # thêm Task Scheduler + toast
```

- Project của user thay vì org: thêm `--owner-type user`. Số project nằm trong URL `.../orgs/<org>/projects/<n>`.
- `--scheduler` tạo một task tạm, chạy lại phần Claude trong ngữ cảnh Task Scheduler, rồi tự xoá task. Có thể có cửa sổ console bật lên.
- `--toast` hiện một toast thử và hỏi y/n.
- `--skip-claude` để bỏ qua phần Claude, `--raw` để xem lỗi gốc (chỉ tự đọc).

## Đọc kết quả

| Dòng | Ý nghĩa nếu không OK |
|---|---|
| `scope WARN` | Thiếu `read:project`, query Projects v2 sẽ lỗi `SCOPE_MISSING` |
| `projectsV2 FAIL PROJECTS_V2_UNSUPPORTED` | Bản GHES chưa có Projects v2, phải xem lại toàn bộ cách theo dõi |
| `updated: FAIL ARG_QUERY_UNSUPPORTED` hoặc `server bỏ qua filter` | Poller phải lấy hết item rồi lọc phía client |
| `filter basis` | Filter dựa trên updatedAt của item hay của Issue. App theo dõi `Issue.updatedAt`: nếu filter dựa trên item thì chỉ dùng nó để thu hẹp, vẫn phải so lại `Issue.updatedAt` |
| `updated time` | Server có hiểu giờ/phút không. Không hiểu thì chỉ lọc được ở mức ngày |
| `claude path FAIL` | `command` đang trỏ tới `.cmd`/`.ps1`. Cần trỏ tới `claude.exe`, hoặc `node` + `cli.js` |
| `claude -p FAIL UNKNOWN_FLAG --x` | Bản Claude CLI đang cài không có cờ đó, ADR-0003 cần chỉnh |
| `[sched] …` | Kết quả của cùng phép thử khi chạy qua Task Scheduler (khác PATH, khác môi trường) |
| `toast click FAIL` | Cần cách toast khác, đưa vào ADR-0005 |
