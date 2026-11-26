# Test harness

Mục tiêu: Claude implement được mà **không cần** GitHub thật, `claude -p` thật hay Windows — và không thể vô tình đổi hành vi người dùng.

## Ba tầng

| Tầng | Công cụ | Phạm vi | Ai viết |
|---|---|---|---|
| Unit | Vitest, `*.test.ts` cạnh code | domain + application, dùng fake port | `implementer` (TDD) |
| Contract (khi có adapter thật) | Vitest, `*.contract.test.ts` | Adapter thật vs fake cùng bộ case; chạy tay/có điều kiện | `implementer` |
| E2E | Playwright, `e2e/specs` | Hành vi người dùng qua UI + toast | `e2e-writer`, **khoá** sau khi user duyệt |

## Chạy app ở chế độ fake

`APP_ADAPTERS=fake` → `composition-root.ts` lắp `FakeGitHub`, `FakeTranslator` (`"[vi] " + text`), `RecordingNotifier`, `ControllableClock`, và mount `/__test__/*`:

| Endpoint | Tác dụng |
|---|---|
| `POST /__test__/reset` | Xoá state |
| `POST /__test__/github/issues` | Nạp issue giả |
| `POST /__test__/clock` | Đặt giờ hiện tại |
| `GET /__test__/toasts` | Toast đã bắn |

Spec dùng fixture `harness` trong `e2e/support/harness.ts`, không gọi `/__test__` trực tiếp. Thêm năng lực điều khiển mới → thêm vào cả `routes.ts` và `Harness`.

## Khoá hành vi (e2e lock)

- `e2e/specs.lock.json` chứa sha256 mọi spec.
- `pnpm e2e:lock:check` chạy trong `pnpm verify` và CI → fail nếu spec đổi mà chưa re-lock.
- Chỉ orchestrator chạy `pnpm e2e:lock`, **sau khi user duyệt** spec. `implementer` không bao giờ sửa `e2e/specs/` hay chạy lock.
- Spec ghi `// @story: <id>` để truy vết về `docs/features/<id>-*/spec.md`.

## Lệnh

```
pnpm verify        # typecheck → unit → e2e lock check → e2e  (cổng bắt buộc trước PR)
pnpm test          # unit
pnpm e2e           # e2e (tự build web + chạy app fake ở :4317)
```

## Giới hạn đã biết
- E2E chạy trên Linux/CI với fake → **không** kiểm được toast Windows thật, `claude -p` từ Task Scheduler, encoding trên Windows. Những thứ này thuộc spike + contract test chạy tay trên máy Windows.
