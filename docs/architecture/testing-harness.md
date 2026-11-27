# Test harness

Mục tiêu: Claude implement được mà **không cần** GitHub thật, `claude -p` thật hay Windows — và không thể vô tình đổi hành vi người dùng.

## Ba tầng

| Tầng | Công cụ | Phạm vi | Ai viết |
|---|---|---|---|
| Unit | Vitest, `*.test.ts` cạnh code | domain + application, dùng fake port | `implementer` (TDD) |
| Adapter | Vitest, cạnh adapter | Adapter thật với hệ ngoài **giả ở mức process**: Claude CLI → `fake-claude-cli.mjs` (mode ok/slow/hang/garbage/fail/wrapped, ghi lại argv/stdin/cwd). `gh` → `fake-gh.mjs` (`contexts/tracking/infrastructure/gh-cli/testing/`; fixture JSON qua `FAKE_GH_FIXTURE`, mode qua `FAKE_GH_MODE`: ok/partial/auth/scope/project-null/not-resolved/unsupported/network/hang/fail/garbage/bad-shape/huge, ghi argv/stdin/env vào `FAKE_GH_RECORD`). Port `GitHubGateway` có contract test chung `shared/ports/testing/github-gateway.contract.ts` chạy cho cả `FakeGitHub` và `GhCliGateway` + fake gh; fixture board dùng chung ở `test-harness/github-fixture.ts` | `implementer` |
| E2E | Playwright, `e2e/specs` | Hành vi người dùng qua UI + toast | `e2e-writer`, **khoá** sau khi user duyệt |

## Chạy app ở chế độ fake

`APP_ADAPTERS=fake` → `composition-root.ts` lắp `FakeGitHub`, `FakeTranslator` (`"[vi] " + text`), `RecordingNotifier`, `ControllableClock`, `PollCycle` (với `InProcessEventBus`, `SqliteTrackingRepository`) và mount `/__test__/*`:

| Endpoint | Tác dụng |
|---|---|
| `POST /__test__/reset` | Xoá state: issue giả, toast, đồng hồ, và mọi hàng của mọi bảng SQLite (giữ schema và `user_version`) |
| `POST /__test__/github/issues` | Nạp issue giả (`GitHubIssueSnapshot`; `comments` tuỳ chọn, mặc định `[]`) thành board chỉ có Issue OPEN, không Status (`FakeGitHub.seedIssues`) |
| `POST /__test__/clock` | Đặt giờ hiện tại |
| `POST /__test__/poll` | Chạy **một** `PollCycle` (005b) với project cố định `fake/org/1` trên `FakeGitHub` và bảng Tracking thật; trả `PollReport` JSON. Không có chu kỳ nào tự chạy. Chu kỳ đầu sau reset là `BASELINE`. `Harness.runPoll()`; dùng: `seedIssues` → `runPoll()` (lấy mốc) → `seedIssues` thêm → `runPoll()` (phát hiện) |
| `GET /__test__/toasts` | Toast đã bắn |

Chế độ fake dùng **SQLite thật** ở `:memory:` (ADR-0008, `openAppStorage`) thay vì repository fake: schema và migration chạy như thật, không tạo file nào trong `dataDir`; mỗi lần `buildDeps("fake")` là một DB độc lập.

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
