# Spike S0.1: Claude CLI trên Windows

Nguồn: `pnpm diagnose` trên máy công ty (người dùng gõ lại kết quả).

## Lần 1–2 (2026-11-26)

| Hạng mục | Kết quả |
|---|---|
| Phiên bản | Claude Code 2.1.329 |
| Lần 1 | `claude -p` NOT_FOUND: `diagnose` tìm claude trong PATH nhưng không spawn được; người dùng có settings riêng |
| Sửa | Thêm `env` vào `CliConfig` (`--settings` đã được phép trong `args`); `diagnose` ưu tiên `claude.exe`, có `--write-config` |
| Lần 2 | `claude path` OK, config OK, `--version` chạy được |
| `claude -p` (dịch mẫu, thời gian, giữ code/mention) | **Chưa có kết quả** |
| Qua Task Scheduler | **Chưa có kết quả** |
