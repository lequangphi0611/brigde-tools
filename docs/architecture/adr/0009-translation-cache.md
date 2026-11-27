# ADR-0009: Cache bản dịch theo đoạn bằng decorator trong `core-translate`

- Trạng thái: Accepted (user duyệt nội dung ở GATE 1 story 003 và chấp nhận ở GATE 4, 2026-11-27)
- Ngày: 2026-11-27
- Liên quan: ADR-0003 (runner, cấu hình đọc lại mỗi lần), ADR-0006 (port theo lô), ADR-0007 (`glossaryVersion`), ADR-0008 (lưu trữ), story 003 (`docs/features/003-translation-cache/spec.md`), 003b, 006, 012

## Bối cảnh
- Mỗi lần gọi `claude -p` trên máy thật mất khoảng 100 giây (`docs/spikes/claude-cli-windows.md`). Issue bị sửa, comment mới, hay job chạy lại không được làm dịch lại phần đã dịch.
- Port `Translator` dịch theo lô (ADR-0006); spec 001 và ADR-0006 đã định cache lọc **theo từng đoạn** trước khi gọi port.
- `core-translate` dùng chung với tool dịch chat, không được biết SQLite, `Clock` của app hay `apps/`.
- `glossaryVersion` là hash nội dung (ADR-0007). Model thực tế chỉ biết **sau** lần gọi (runner đọc `modelUsage`). Model mong muốn có thể khai báo bằng cờ `--model` trong `args` của cấu hình Claude CLI; cấu hình được đọc lại mỗi lần dịch (ADR-0003).

## Các lựa chọn
Vị trí logic cache:
- a. Trong hàng đợi của app (006): mỗi bên gọi phải lặp lại logic lọc/gộp; tool dịch chat không dùng được.
- b. Trong `ClaudeCliTranslator`: trộn cache với adapter CLI; fake không được hưởng; khó test riêng.
- c. **Decorator `CachingTranslator implements Translator` + port `TranslationCache` trong `core-translate`; adapter SQLite ở app.**

Đơn vị cache:
- d. Cả lô/issue: gần như không bao giờ trúng khi issue thay đổi.
- e. **Từng đoạn**; trúng một phần thì chỉ gửi đoạn trượt trong một lần gọi.

Nhận biết đổi prompt/model:
- f. Không có: đổi prompt hay model phải xoá DB bằng tay.
- g. Hash toàn bộ `args` của cấu hình CLI: đổi cờ không liên quan (đường dẫn settings) cũng làm trượt toàn bộ; `args` chứa đường dẫn riêng của máy.
- h. **`promptVersion` (hằng tăng tay) + `configuredModel` (giá trị cờ `--model` nếu có, không thì `""`)**, lấy qua hàm `engineVersion` do composition root truyền vào decorator, gọi mỗi lần dịch.

## Quyết định
Chọn c + e + h. Khoá = `sha256(text gốc của đoạn, không chuẩn hoá)` + `direction` + `glossaryVersion` (thuật ngữ liên quan của đoạn) + `promptVersion` + `configuredModel`. Không có `hint`, không có model thực tế (lưu thành cột `model`).
- Decorator không biết Claude CLI: nhận `engineVersion: () => EngineVersion | Promise<EngineVersion>`. `core-translate` cung cấp `claudeCliEngineVersion(configPath)` (dùng `loadCliConfig` như adapter) và `extractConfiguredModel(args)`.
- Decorator kiểm request trước khi chạm cache; đoạn không có chữ cần dịch không tra/ghi; đoạn trùng khoá trong một request gửi một lần; không còn đoạn trượt thì không gọi engine (`model = null`).
- `inner` lỗi → ném nguyên lỗi, không ghi gì. Lỗi `engineVersion`/đọc/ghi cache → bỏ qua cache cho phần đó, báo qua `observer`, không bao giờ làm lần dịch lỗi vì cache.
- `store` ghi đè khi trùng khoá (để 012 có thể dịch lại cùng khoá).
- Bảng `translation` (migration `0002`), không lưu text nguồn; `created_at` ISO UTC từ `Clock` của app. Port bất đồng bộ.
- Không xoá/hết hạn ở 003; quyết định sau khi 009 có số liệu dung lượng.

## Hệ quả
- Port `Translator` không đổi; bên gọi (006, 003b, tool dịch chat) lắp decorator ở composition root.
- Quên tăng `promptVersion` khi đổi prompt thì cache cũ được dùng âm thầm.
- Model chọn qua `env` hoặc file `--settings` không vào khoá; alias (`sonnet`) đổi model thật khi Claude Code cập nhật mà khoá không đổi. Cột `model` giữ dấu vết.
- Cấu hình CLI được đọc hai lần mỗi lần dịch (phiên bản engine và adapter); không đáng kể so với thời gian gọi.
- Bản dịch kém bị giữ cho tới khi glossary liên quan, `promptVersion` hoặc `configuredModel` đổi, hoặc 012 cho dịch lại.
- Bảng chỉ tăng cho tới khi có chính sách dọn dẹp.
- Lần gọi con thứ k của một yêu cầu dài lỗi thì kết quả các lần trước bị bỏ (bất biến không có kết quả một phần); cache theo lần gọi con là cải tiến có thể làm sau.
- Hash text gốc không chuẩn hoá: khác biệt `\r\n`/`\n` làm trượt (an toàn, chỉ tốn thêm một lần dịch).
