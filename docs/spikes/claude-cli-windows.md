# Spike S0.1: Claude CLI trên Windows

Nguồn: `pnpm diagnose` trên máy công ty (người dùng gõ lại kết quả).

## Lần 1–2 (2026-11-26)

| Hạng mục | Kết quả |
|---|---|
| Phiên bản | Claude Code 2.1.329 |
| Lần 1 | `claude -p` NOT_FOUND: `diagnose` tìm claude trong PATH nhưng không spawn được; người dùng có settings riêng |
| Sửa | Thêm `env` vào `CliConfig` (`--settings` đã được phép trong `args`); `diagnose` ưu tiên `claude.exe`, có `--write-config` |
| Lần 2 | `claude path` OK, config OK, `--version` chạy được |
| `claude -p` trong terminal | OK, **gần 100 giây** cho một câu mẫu |
| Qua Task Scheduler | `[sched] claude -p OK`: chạy được trong ngữ cảnh Task Scheduler với config tuyệt đối |
| Settings riêng | Gateway/proxy công ty, hooks, auth. Model custom. Dùng claude tương tác cũng chậm như vậy → do môi trường, không do runner |

**Quyết định:**
- `timeoutSeconds` mặc định 300 (trước là 120, quá sát).
- Thông lượng khoảng 100 giây mỗi lần gọi × 2 song song ≈ 70 lần/giờ → **mỗi issue dịch trong một lần gọi** (gộp title + body + các comment mới), không gọi riêng từng đoạn. Ràng buộc này áp vào story 001 và 006.
- Hook `UserPromptSubmit` của công ty chạy cả với `-p` và nhận nội dung issue. Chấp nhận, nhưng nếu bản dịch lạ thì nghi chỗ này trước.
