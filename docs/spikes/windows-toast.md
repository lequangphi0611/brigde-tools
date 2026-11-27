# Spike S0.3: Toast trên Windows

## Lần 1 (2026-11-26)

| Hạng mục | Kết quả |
|---|---|
| Cách gửi | PowerShell WinRT (`ToastNotificationManager`, AppUserModelID của PowerShell) |
| Hiện toast, tiếng Việt đúng dấu | OK |
| Bấm toast mở `http://localhost:4317/issues/123` | OK |

**Đề xuất ADR-0005:** PowerShell WinRT (`activationType="protocol"`), không cần thư viện npm nên không phụ thuộc registry công ty. Còn cần kiểm khi gọi từ process chạy nền qua Task Scheduler.

## Lần 2 (2026-11-27): từ Task Scheduler

| Hạng mục | Kết quả |
|---|---|
| Toast gửi từ task do Task Scheduler chạy (`diagnose --scheduler --toast`) | OK, người dùng thấy toast "[M0] Toast từ Task Scheduler" |
| Toast trong terminal, tiếng Việt, bấm mở `http://localhost:4317/issues/123` | OK (lặp lại lần 1) |

**Kết luận:** điểm "chưa kiểm" của ADR-0005 đã đóng. Story 007 không còn bị chặn bởi toast.
