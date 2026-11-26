# diagnose

Kiểm tra M0 trên máy Windows thật: GHES qua `GH_HOST`, Projects v2, `claude -p`, Task Scheduler và toast. Node thuần, **không cần `pnpm install`**: giải nén zip là chạy được ngay.

Output chỉ gồm trạng thái, phiên bản, số đếm và mã lỗi, không có hostname, owner hay nội dung issue, nên có thể gõ lại để gửi đi. `--raw` in lỗi gốc, chỉ dùng để tự đọc trên máy, **không gửi đi**.

## Yêu cầu

- Node ≥ 22 và `gh` đã đăng nhập vào GHES, có scope `read:project`.
- (Tuỳ chọn) `config/claude-cli.local.json` (chép từ `config/claude-cli.example.json`). Không có file này thì lệnh tìm `claude` trong PATH.

## Chạy (PowerShell, ở thư mục gốc repo)

```powershell
$env:GH_HOST = "<host GHES>"
gh auth login --hostname $env:GH_HOST                 # nếu chưa đăng nhập
gh auth refresh -s read:project --hostname $env:GH_HOST

# GitHub + claude -p
node scripts/diagnose/index.mjs --owner <org> --number <số project>

# Đầy đủ: thêm Task Scheduler và toast
node scripts/diagnose/index.mjs --owner <org> --number <số project> --scheduler --toast
```

Nếu đã `pnpm install` thì có thể dùng `pnpm diagnose --owner <org> --number <n>`.

| Cờ | Ý nghĩa |
|---|---|
| `--owner`, `--number` | Project trong URL `…/orgs/<owner>/projects/<number>` |
| `--owner-type user` | Project của user thay vì org |
| `--config <file>` | File cấu hình Claude CLI khác (mặc định `config/claude-cli.local.json`) |
| `--claude <path>` | Đường dẫn tuyệt đối tới `claude.exe` (khi không dùng config) |
| `--model <name>` | Model khi không dùng config (mặc định `sonnet`) |
| `--scheduler` | Tạo task tạm, chạy lại phần Claude trong Task Scheduler, rồi tự xoá task |
| `--toast` | Hiện toast thử và hỏi y/n. Đi kèm `--scheduler` thì gửi thêm một toast từ Task Scheduler |
| `--write-config` | Ghi `config/claude-cli.local.json` từ claude tìm được (không ghi đè file đã có) |
| `--skip-claude` | Bỏ qua phần Claude |
| `--raw` | In lỗi gốc (chỉ tự đọc) |
| `--out <file>` | Ghi kết quả ra file |

## Claude với settings riêng

Lệnh chạy claude từ một thư mục tạm rỗng và **không đọc alias/function trong profile PowerShell**. Task Scheduler cũng không đọc, nên mọi thiết lập riêng phải nằm trong `config/claude-cli.local.json`:

```json
{
  "command": "C:\\Users\\<you>\\.local\\bin\\claude.exe",
  "args": ["--model", "sonnet", "--settings", "C:\\path\\to\\settings.json"],
  "env": { "TEN_BIEN": "giá trị" }
}
```

- `command` phải là `claude.exe`. Nếu cài qua npm thì đặt `command` là `node.exe` và phần tử đầu của `args` là đường dẫn tới `...\\node_modules\\@anthropic-ai\\claude-code\\cli.js`. Không dùng `.cmd`/`.ps1`. Chạy `--write-config` để lệnh tự dò đường dẫn.
- `--settings <file>` dùng cho file settings riêng, `env` cho biến môi trường (proxy, CA, endpoint…). File này đã nằm trong `.gitignore`.
- Dòng `claude cfg` chỉ in **tên** biến trong `env`, không in giá trị.

Cách đọc từng dòng kết quả: [`docs/spikes/diagnose.md`](../../docs/spikes/diagnose.md).
