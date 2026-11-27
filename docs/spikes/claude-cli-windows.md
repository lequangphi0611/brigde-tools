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

## Lần 3 (2026-11-27): `--scheduler` sau khi sửa EPERM

| Hạng mục | Kết quả |
|---|---|
| Triệu chứng trước khi sửa | `scheduler FAIL task không ghi kết quả`, gốc là `EPERM` ở `rmSync` khi xoá thư mục tạm/file kết quả → task con crash trước khi ghi |
| Sửa | Xoá best-effort có retry (diagnose và `runClaudeCli`); diagnose báo `claude tmp WARN` thay vì crash; task con ghi từng dòng; hạn chờ = 60s + `timeoutSeconds` + 120s |
| Qua Task Scheduler | `[sched] claude -p` OK, **8331ms**, vi/code/mention đều true |
| `claude tmp WARN` | Không xuất hiện → EPERM lần trước nhiều khả năng do khoá tạm thời (antivirus), không phải process giữ cwd. Chưa chắc chắn: theo dõi tiếp, nếu thấy thư mục `ghit-ai-*` sót trong TEMP thì xem lại |
| `pnpm verify` trên máy chạy | typecheck + unit + lock check xanh; e2e lỗi (chưa ghi nhận nguyên nhân) |

**Ghi chú:**
- 8,3 giây so với ~100 giây ở lần 2: chênh lệch lớn, **chưa rõ nguyên nhân** (gateway, model, tải lúc đo). Chưa đổi quyết định thông lượng ở trên cho tới khi có thêm số đo.
- Theo user: e2e chỉ cần chạy ở máy dev, máy chạy app không cần. Trên máy chạy, `pnpm verify` sẽ đỏ ở bước e2e là chấp nhận được; kiểm ở đó bằng `pnpm typecheck && pnpm test` và `diagnose`.
