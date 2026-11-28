# Kiến trúc

Một process Node nền (Task Scheduler khi đăng nhập) chứa: Poller, Translation queue, Notifier, HTTP server (Hono) phục vụ UI tĩnh (Vite + React).

## Cấu trúc thư mục

```
packages/core-translate/src/{domain,application,infrastructure}   # Translation context
apps/app/src/
  contexts/<ctx>/domain          # entity, VO, invariant, event — thuần TS, không I/O
  contexts/<ctx>/application     # use case, gọi port
  contexts/<ctx>/infrastructure  # adapter: SQLite repo, gh CLI, claude CLI, toast
  shared/ports/                  # port dùng chung: GitHubGateway (scanProject + fetchIssueDetails), Notifier, Clock
  composition-root.ts            # nơi DUY NHẤT chọn adapter thật/fake
  server/                        # Hono routes (HTTP adapter)
  test-harness/                  # fake + /__test__ API, chỉ mount khi APP_ADAPTERS=fake
apps/app/web/                    # React UI
e2e/                             # Playwright — khoá hành vi người dùng
```

## Luật phụ thuộc (bắt buộc)
- `domain` không import `application`, `infrastructure`, Node API, hay thư viện I/O.
- `application` chỉ import `domain` và port.
- `infrastructure` implement port; chỉ `composition-root.ts` khởi tạo adapter.
- Context không import `domain` của context khác — giao tiếp qua event hoặc ID.
- `packages/core-translate` không import gì từ `apps/`.
