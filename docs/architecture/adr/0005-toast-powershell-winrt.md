# ADR-0005: Toast bằng PowerShell WinRT

- Trạng thái: Accepted
- Ngày: 2026-11-26

## Bối cảnh
Story 007 cần toast Windows có title tiếng Việt, bấm vào mở `http://localhost:<port>/issues/<id>`. Spike S0.3 (`docs/spikes/windows-toast.md`) trên máy thật cho thấy: toast PowerShell WinRT hiện đúng, tiếng Việt đúng dấu, bấm vào mở đúng URL. Gói thêm thư viện npm thì phụ thuộc registry công ty và tốn công bảo trì.

## Các lựa chọn
1. **node-notifier** (kèm SnoreToast.exe). Tiện, nhưng ít được bảo trì. Muốn biết người dùng bấm vào thì process phải sống và giữ callback. Thêm một file exe đi kèm, có thể bị chính sách công ty chặn.
2. **PowerShell WinRT** (`ToastNotificationManager`, `activationType="protocol"`). Không cần thư viện. Bấm toast thì Windows tự mở URL bằng trình duyệt mặc định, không cần callback. Đổi lại, mỗi toast phải spawn một process `powershell.exe` (dưới 1 giây), và nguồn toast hiển thị là "Windows PowerShell".
3. **AppUserModelID riêng** (shortcut trong Start Menu đăng ký ID cho app). Tên và icon đúng của app, nhưng phải có bước cài đặt.

## Quyết định
Chọn 2 cho MVP. Adapter `PowerShellToastNotifier` hiện thực port `Notifier`.

- Spawn `powershell.exe -NoProfile -NonInteractive -EncodedCommand <base64 UTF-16LE>`, không bật shell.
- **Nội dung là dữ liệu, không phải code:** XML toast được dựng phía Node với mọi giá trị đã XML-escape, rồi mã hoá base64 UTF-8 và nhúng vào script. Script chỉ decode base64 rồi gọi `LoadXml`. Title hay body không bao giờ được nối vào mã PowerShell.
- URL trong `launch` chỉ được là `http://localhost:<port>/…` do app tạo ra.
- Lỗi toast được ghi vào log và trang tình trạng (story 009), không làm hỏng job dịch.

## Hệ quả
- Không thêm dependency. Test bằng `RecordingNotifier` như hiện tại. Riêng adapter thật có test đơn vị cho phần dựng XML và escape.
- **Chưa kiểm:** toast gửi từ process chạy nền do Task Scheduler khởi động (spike mới chạy trong terminal tương tác). Cần thêm vào `diagnose --scheduler` trước story 007.
- Nếu người dùng tắt thông báo của PowerShell, hoặc đang bật Focus Assist, thì toast không hiện. Trang tình trạng nên có nút "gửi toast thử".
- Sau MVP có thể chuyển sang lựa chọn 3 khi làm bộ cài (story 020).
