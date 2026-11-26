# ADR-0004: Lưu trữ bằng `node:sqlite` có sẵn trong Node

- Trạng thái: Accepted
- Ngày: 2026-11-26

## Bối cảnh
Story 004 cần SQLite local (bảng `setting`, `job`, issue, bản dịch, cache) và migration. Ràng buộc từ spike M0 trên máy thật:
- Máy công ty chạy Windows 11, Node v24.9.0. Package cài qua registry công ty sau proxy.
- Code lấy về bằng zip. Không debug được trên máy thật, nên mỗi bước cài đặt có thể hỏng là một rủi ro không chẩn đoán được từ xa.
- App một người dùng, một process, dữ liệu nhỏ (vài trăm issue mỗi project).

## Các lựa chọn
1. **Prisma.** Có schema, migration và client có kiểu. Nhưng nặng so với app local một người, và phần engine/binary tải ngoài registry npm nên dễ bị proxy chặn. Thêm một bước generate.
2. **better-sqlite3.** API đồng bộ, nhanh, đã trưởng thành. Nhưng là module native: khi cài, nó tải binary build sẵn từ GitHub releases (ngoài registry công ty). Nếu bị chặn thì phải build bằng node-gyp và Visual Studio Build Tools, mà máy công ty có thể không có.
3. **`node:sqlite` (`DatabaseSync`).** Có sẵn trong Node, không cần cài gì, không có binary native, API đồng bộ gần giống better-sqlite3. Đã bỏ cờ từ v22.13.0 và lên mức release candidate (Stability 1.2) từ v24.15.0 / v25.7.0. Bản thấp hơn vẫn in `ExperimentalWarning`. Không có công cụ migration đi kèm.

## Quyết định
Chọn 3: `node:sqlite`, ẩn sau các repository port của từng context (ADR-0002), để có thể đổi sang better-sqlite3 mà không đụng domain hay application.

- Migration tự viết: thư mục file `.sql` đánh số, chạy trong transaction, ghi phiên bản vào `PRAGMA user_version`.
- Bật `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout`.
- Tắt `ExperimentalWarning` của SQLite khi khởi động (chỉ cảnh báo đó, không tắt hết warning).
- Test chạy với file DB tạm hoặc `:memory:`. Fake vẫn dùng được cho e2e.

## Hệ quả
- Cài đặt trên máy công ty không có bước native nào, giảm hẳn rủi ro do proxy.
- `engines.node` nâng lên `>=22.13`. **Khuyến nghị nâng Node trên máy thật lên ≥ 24.15** để dùng bản release candidate. 24.9 vẫn chạy được nhưng API có thể đổi giữa các bản.
- Phải tự viết migration runner (nhỏ) và mapping hàng → object (không có ORM).
- Nếu `node:sqlite` đổi API hoặc gặp lỗi chặn: chuyển adapter sang better-sqlite3. Điều kiện là phải cài được binary qua proxy, cần kiểm bằng `diagnose` trước.
