# ADR-0003: Gọi `claude -p` qua runner an toàn (theo p-quizzz)

- Trạng thái: Accepted (runner); cần spike trên Windows/Task Scheduler
- Ngày: 2026-11-26
- Tham khảo: `lequangphi0611/p-quizzz` — `src/server/infrastructure/ai-grader/claude-cli-runner.ts`, `grader-config.ts`, docs/architecture.md §11.6

## Bối cảnh
Bản dịch tạo bằng Claude CLI cài trên máy người dùng. Nội dung issue/comment là **dữ liệu bên thứ ba** (người viết issue phía Nhật) → có rủi ro prompt injection. App chạy nền từ Task Scheduler: không có terminal, PATH khác, encoding dễ lệch.

## Quyết định
Runner dùng chung đặt ở `packages/core-translate/src/infrastructure/claude-cli/` (tool dịch chat cũng dùng):

1. `spawn(command, args, { shell: false, windowsHide: true })`, **không bao giờ** `shell: true`.
2. Nội dung đi qua **stdin** (UTF-8), không bao giờ nằm trong argv.
3. `cwd` = thư mục tạm rỗng, xoá sau khi chạy → CLI không đọc `CLAUDE.md` hay file nào.
4. Cờ app luôn nối cuối: `-p --tools "" --strict-mcp-config --disable-slash-commands --no-session-persistence --output-format json --json-schema <schema> --system-prompt <prompt>` → model không có tool, không MCP, không lưu session, trả JSON theo schema.
5. Cấu hình người dùng (`config/claude-cli.local.json`, không commit; mẫu `config/claude-cli.example.json`): `command` (đường dẫn tuyệt đối), `args` (vd. `--model`, `--settings <file>`), `env` (biến môi trường thêm cho process CLI — Task Scheduler không có profile/alias của terminal), `timeoutSeconds`, `concurrency`, `maxInputChars`. Đọc lại mỗi lần dùng. Từ chối cờ cấp tool/bỏ quyền và cờ app tự đặt. Trên Windows từ chối `.cmd`/`.bat` (Node không spawn được khi không có shell) → trỏ tới `claude.exe` hoặc `node` + `cli.js`.
6. Đọc envelope `type: "result"` (chịu được log của script bọc và mảng event `--verbose`); lấy `structured_output`, dự phòng JSON trong `result`. Validate bằng zod ở adapter.
7. Lỗi = `CliRunFailure { reason: timeout | bad_output | process_failed }`; timeout → `SIGKILL`; giới hạn stdout 2 MB.
8. Test bằng `testing/fake-claude-cli.mjs` (node script thay `command`), không gọi AI thật trong `pnpm test`/`pnpm e2e`.

## Khác p-quizzz (có chủ ý)
| Điểm | p-quizzz | Ở đây | Lý do |
|---|---|---|---|
| stderr | Bỏ hẳn (có thể lộ cấu hình mentor) | Giữ 4 KB cuối trong `CliRunFailure.stderrTail`, chỉ ghi log file local | Một người dùng, cấu hình của chính họ; cần chẩn đoán lỗi Task Scheduler (PATH, xác thực) |
| Hàng đợi | Trong bộ nhớ, restart → `failed`, không retry | Bảng `job` (attempts, error), sống qua restart | App khởi động lại mỗi lần đăng nhập; mất job = mất bản dịch |
| concurrency mặc định | 1 | 2 | Theo thiết kế (tối đa 2 job song song) |

## Hệ quả
- Prompt dịch + schema output theo lô `{ segments: [{ id, translation }] }` là việc của adapter `ClaudeCliTranslator` (story 001, ADR-0006), không thuộc runner.
- Chưa kiểm chứng: tên cờ trên bản Claude Code đang cài của người dùng; chạy từ Task Scheduler (xác thực, PATH, UTF-8). → spike (roadmap bước 1).
