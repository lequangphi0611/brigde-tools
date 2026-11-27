# Context Map

```
                 ┌────────────────────┐
  GitHub ──ACL──▶│      Tracking      │──ContentChanged──▶┌──────────────┐
  (gh CLI)       │ project, issue,    │                   │ Translation  │◀── claude -p (ACL)
                 │ content, listen,   │◀─TranslationReady─│ (core-trans- │
                 │ poller             │                   │  late pkg)   │
                 └─────────┬──────────┘                   └──────┬───────┘
                           │ IssueEvent                          │ TranslationReady
                           ▼                                     ▼
                 ┌──────────────────────────────────────────────────┐
                 │                 Notification                     │──▶ Windows toast (ACL)
                 │ notify rules, pause, toast, summary toast        │
                 └──────────────────────────────────────────────────┘
```

| Context | Vị trí code | Loại | Ghi chú |
|---|---|---|---|
| Tracking | `apps/app/src/contexts/tracking` | Core domain | Logic khó nhất: phát hiện thay đổi, listen 3 mức, backfill |
| Translation | `packages/core-translate` | Generic / shared kernel | Tái dùng cho tool dịch chat → KHÔNG được import gì từ `apps/` |
| Notification | `apps/app/src/contexts/notification` | Supporting | Chỉ bắn toast khi bản dịch đã sẵn |

## Quan hệ & quy tắc

- **Anti-Corruption Layer** cho mọi hệ ngoài: GitHub (`GitHubGateway`), Claude (`Translator`), Windows (`Notifier`). Domain không thấy JSON của GitHub hay stdout của CLI.
- Context giao tiếp qua **domain event** trong process (in-memory bus), không gọi chéo repository của nhau. Bus đồng bộ, handler chạy trong transaction SQLite của bên phát, không outbox (ADR-0011, Proposed, story 005b); kiểu event ở `apps/app/src/shared/events/`, chỉ chứa ID.
- `core-translate` là upstream; `app` là downstream (conformist với API `translate()`).

## Lưu trữ (hạ tầng dùng chung, không phải context)

- Một file SQLite `app.db` trong thư mục dữ liệu, mở bằng `node:sqlite` (ADR-0004), quy ước ở ADR-0008. Hạ tầng chung: `apps/app/src/shared/infrastructure/sqlite/`.
- Mỗi context giữ bảng của mình qua repository port riêng; adapter nằm trong `infrastructure/` của context, nhận handle DB từ composition root. Context không đọc bảng của context khác.
- `core-translate` không biết SQLite: port (vd cache 003) khai báo trong package, adapter SQLite ở app.
- Cài đặt dùng chung qua `SettingStore` (`shared/ports`), khoá có tiền tố context.
