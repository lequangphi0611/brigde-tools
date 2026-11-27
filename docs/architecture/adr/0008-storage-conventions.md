# ADR-0008: Quy ước lưu trữ — thư mục dữ liệu, một chuỗi migration, SQLite thật trong chế độ fake

- Trạng thái: Accepted
- Ngày: 2026-11-27
- Liên quan: ADR-0002 (port + fake), ADR-0004 (`node:sqlite`), story 004 (`docs/features/004-sqlite-storage/spec.md`), 003 (cache), 006 (bảng `job`)

## Bối cảnh
- ADR-0004 chọn `node:sqlite` nhưng chưa chốt: file DB nằm đâu, migration của nhiều context đánh số thế nào, thời gian lưu dạng gì, và chế độ `APP_ADAPTERS=fake` (e2e) dùng gì để lưu.
- Code lên máy thật bằng zip, mỗi bản mới giải nén ra một thư mục mới hoặc ghi đè thư mục cũ. Nếu DB nằm trong thư mục code thì đổi bản là mất dữ liệu.
- Máy công ty có antivirus từng khoá file tạm thời (EPERM ở spike S0.1). Thư mục profile `Roaming` có thể bị đồng bộ hoặc chuyển hướng bởi chính sách công ty.
- `PRAGMA user_version` chỉ là **một** số nguyên cho cả file, nên không thể có chuỗi phiên bản riêng cho mỗi context trong cùng một file.
- Đồng hồ trong e2e là `ControllableClock`. Nếu schema dùng `CURRENT_TIMESTAMP` của SQLite thì logic theo thời gian (006 retry, 017 hết hạn tạm dừng) thoát khỏi đồng hồ điều khiển được.
- ADR-0002 làm fake cho mọi hệ ngoài vì chúng chậm, cần xác thực hoặc chỉ có trên Windows. SQLite chạy trong process, nhanh, có trên Linux/CI.

## Quyết định
1. **Thư mục dữ liệu** (`dataDir`), theo thứ tự ưu tiên:
   - biến môi trường `APP_DATA_DIR` nếu có (đường dẫn tuyệt đối);
   - Windows: `%LOCALAPPDATA%\gh-issue-translator` (không dùng `%APPDATA%`/Roaming);
   - nơi khác: `$XDG_DATA_HOME/gh-issue-translator`, mặc định `~/.local/share/gh-issue-translator`.
   File DB: `<dataDir>/app.db` (kèm `app.db-wal`, `app.db-shm` do WAL). Không bao giờ nằm trong thư mục repo. Log file (009) dùng cùng `dataDir`.
2. **Một chuỗi migration toàn app**, file `NNNN-<tên>.sql` trong `apps/app/src/shared/infrastructure/sqlite/migrations/`, đánh số liên tục từ `0001`. Story nào thêm bảng (kể cả bảng cho port của `core-translate` như cache 003) thì thêm file kế tiếp. Tên bảng là số ít, snake_case, mang tên khái niệm trong ubiquitous language (`setting`, `job`…). File migration đã merge thì **không sửa**, chỉ thêm file mới.
3. **Thời gian lưu dạng TEXT ISO-8601 UTC lấy từ port `Clock`**. Logic không dựa vào `CURRENT_TIMESTAMP`/`datetime('now')` của SQLite.
4. **Chế độ fake dùng adapter SQLite thật với DB `:memory:`**, migration chạy như máy thật; `/__test__/reset` xoá mọi hàng của mọi bảng (giữ schema). Không viết repository fake trong bộ nhớ. Unit test của application dùng adapter SQLite `:memory:` qua một helper chung.
5. Hạ tầng lưu trữ dùng chung nằm ở `apps/app/src/shared/infrastructure/sqlite/` (mở DB, pragma, transaction, migration). Repository adapter của từng context nằm trong `infrastructure/` của context đó và nhận handle DB từ composition root. Port repository vẫn khai báo ở context (hoặc `shared/ports` nếu dùng chung, như `SettingStore`), `core-translate` không biết SQLite.
6. DB hỏng hoặc migration lỗi lúc khởi động → app **dừng** với thông báo rõ (lý do, số migration, mã lỗi SQLite), không tự xoá/ghi đè file. (Đã chốt với user 2026-11-27; trang tình trạng 009 sẽ hiển thị lỗi này.)

## Các lựa chọn đã cân nhắc
- DB trong thư mục repo: đơn giản nhưng mất dữ liệu mỗi lần thay zip. Loại.
- `%APPDATA%` (Roaming): có thể bị roam/redirect, SQLite trên ổ mạng không an toàn với WAL. Loại.
- Migration riêng từng context (nhiều file DB hoặc bảng `schema_migrations` theo context): linh hoạt hơn nhưng thừa cho app một người, và transaction chéo bảng (006 claim job + đọc cache) khó hơn. Loại.
- Repository fake trong bộ nhớ cho e2e (đúng chữ ADR-0002): phải giữ hai bản hành vi đồng bộ (thêm contract test), và e2e không chạy migration thật. Loại, vì SQLite không có lý do nào của ADR-0002 (chậm, cần xác thực, chỉ có trên Windows).

## Hệ quả
- Thay zip không mất dữ liệu; gỡ hẳn app phải xoá `dataDir` (ghi vào hướng dẫn 021).
- e2e và unit test kiểm luôn SQL thật và migration; reset giữa test phải nhanh (DELETE trên DB nhỏ trong bộ nhớ).
- Thứ tự migration phụ thuộc thứ tự merge story: hai nhánh cùng thêm `0002` sẽ xung đột tên file (dễ thấy, sửa bằng đánh lại số trước khi merge).
- Không phát hiện được file migration đã áp dụng bị sửa (không lưu checksum). Dựa vào quy ước + reviewer.
- Đổi vị trí `dataDir` về sau cần bước chuyển file. Cần kiểm chứng `%LOCALAPPDATA%` có mặt khi app chạy từ Task Scheduler (dòng `[sched]` của `diagnose`).
