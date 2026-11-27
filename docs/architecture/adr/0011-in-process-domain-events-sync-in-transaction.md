# ADR-0011: Domain event trong process, phát đồng bộ trong transaction của bên phát (không outbox)

- Trạng thái: Proposed
- Ngày: 2026-11-27
- Liên quan: ADR-0002 (port + fake), ADR-0004 / ADR-0008 (`node:sqlite`, một file `app.db`, một chuỗi migration), story 005b (`docs/features/005b-project-poller/spec.md`, câu hỏi 005b-1), 006 (hàng đợi dịch, bên nghe đầu tiên), 007 / 014 (thông báo)

## Bối cảnh
- `context-map.md`: các context giao tiếp bằng domain event trong process, không gọi chéo repository của nhau.
- 005b là bên phát đầu tiên: Tracking phát `IssueDiscovered` và `ContentChanged` sau mỗi chu kỳ poll. Bên nghe đầu tiên là 006: `ContentChanged` → tạo `TranslationJob` (ghi bảng `job` trong cùng `app.db`). 007 / 014 nghe `TranslationReady` (Translation phát), không nghe event thô của Tracking.
- Mất event = issue không bao giờ được dịch/báo. Phát trùng event = dịch lại (cache gần như miễn phí) và có thể báo trùng (007 phải chống).
- `node:sqlite` là API **đồng bộ**; `Database.transaction(fn)` không cho `await` bên trong (ADR-0008).
- App một người dùng, một process, một file DB. Không có broker.
- Mốc của Tracking (`Issue.ghUpdatedAt`) chỉ được tiến lên khi đã xử lý xong thay đổi; chu kỳ sau sẽ phát hiện lại thay đổi nếu mốc chưa tiến.

## Các lựa chọn
- a. **Bus đồng bộ, handler chạy trong transaction của bên phát.** Bên phát lưu trạng thái và gọi `publish(events)` trong cùng một `UnitOfWork.run(() => …)`. Handler đồng bộ, chỉ ghi DB (vd. 006 chèn hàng `job`). Handler ném lỗi → rollback cả phần lưu trạng thái lẫn event → mốc không tiến → chu kỳ sau phát lại.
- b. **Bảng outbox của Tracking + dispatcher.** Lưu trạng thái và chèn event vào `tracking_outbox` trong một transaction; dispatcher đọc outbox, gọi handler (có thể bất đồng bộ), đánh dấu đã giao; handler phải idempotent vì có thể được gọi lại.
- c. Bus bất đồng bộ trong bộ nhớ, phát sau khi commit: đơn giản nhất nhưng process chết giữa commit và handler là mất event. Loại.

## Quyết định (đề xuất)
Chọn **a**.
- Port `DomainEventPublisher.publish(events): void` (đồng bộ) và `UnitOfWork.run<T>(fn: () => T): T` trong `apps/app/src/shared/ports/`. Adapter: `InProcessEventBus` (đăng ký handler theo `type`, gọi tuần tự theo thứ tự đăng ký) và `SqliteUnitOfWork` (bọc `Database.transaction`). Composition root là nơi duy nhất đăng ký handler.
- Kiểu event (hợp đồng giữa context, "published language") nằm ở `apps/app/src/shared/events/`, chỉ chứa ID, `reason` và thời điểm; **không chứa nội dung** issue. Context nghe không import domain của Tracking.
- Đơn vị transaction của Tracking là **một issue trong một chu kỳ** (lưu issue + `Content` + phát event của issue đó). Lỗi một issue không chặn các issue khác; issue lỗi không tiến mốc nên chu kỳ sau làm lại. Mọi `await` (gọi `gh`) xảy ra **trước** transaction.
- Handler: đồng bộ, không I/O ngoài DB, không gọi `claude`/`gh`/toast. Việc chậm (dịch, toast) chạy ngoài transaction, do bên nghe tự lấy từ bảng của mình (vd. 006 worker đọc bảng `job`).

## Hệ quả
- Không mất event và không phát trùng event cho cùng một thay đổi khi process chết giữa chừng: trạng thái và việc giao event commit hoặc rollback cùng nhau.
- Không thêm bảng, không dispatcher, không trạng thái "đã giao", handler không cần idempotent với chính event đó.
- Ràng buộc: handler bất đồng bộ không cắm trực tiếp được; bên nào cần việc bất đồng bộ phải ghi một hàng vào bảng của mình rồi tự xử lý ngoài transaction. Nếu sau này có bên nghe bắt buộc bất đồng bộ (vd. gọi HTTP), chuyển sang outbox (lựa chọn b) bằng một migration mới; port `DomainEventPublisher` giữ nguyên với bên phát.
- Handler lỗi lặp lại (poison) làm issue đó kẹt: chu kỳ nào cũng thử lại và báo `failed=1` trong dòng `[poll]`. Chấp nhận cho app một người dùng; 009 hiển thị.
- Transaction của Tracking chứa cả bảng của context khác (vd. `job`). Context vẫn không đọc bảng của nhau; chỉ chung transaction. ADR-0008 đã chọn một file DB để làm được việc này.
- Thời gian giữ khoá ghi tăng theo số handler; với 10–50 thay đổi/ngày không đáng kể. `busy_timeout = 5000` (ADR-0008) lo phần tranh chấp với `translate-issue` chạy cùng lúc.

## Cần kiểm chứng
- Không có: hành vi transaction của `node:sqlite` đã có test ở 004.
