# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dự án

GH Issue Translator: process Node chạy nền trên Windows, theo dõi GitHub Projects v2 tiếng Nhật, dịch issue/comment sang tiếng Việt bằng `claude -p` local, báo bằng toast Windows, UI đọc ở `localhost`. Vision, phạm vi, roadmap và câu hỏi mở: `docs/product/vision.md`. Giao tiếp với user bằng tiếng Việt.

Trạng thái hiện tại: khung + harness. Adapter thật (gh CLI, `claude -p`, toast) **chưa có** — roadmap bước 1 là spike hai điểm rủi ro đó trước khi viết tính năng phụ thuộc vào chúng.

## Lệnh

```bash
pnpm install
pnpm verify                         # cổng bắt buộc trước PR: typecheck → unit → e2e lock check → e2e
pnpm typecheck                      # tsc từng workspace (server + web riêng)
pnpm test                           # Vitest, mọi *.test.ts trong packages/*/src và apps/*/src
pnpm test path/to/file.test.ts      # một file unit
pnpm test -t "tên test"             # một test theo tên
pnpm e2e                            # Playwright; tự build web và chạy app fake ở :4317
pnpm e2e e2e/specs/<file>.spec.ts   # một file e2e
pnpm dev                            # chạy app (hiện chỉ chạy được với APP_ADAPTERS=fake)
```

## Kiến trúc tổng

pnpm monorepo, TypeScript strict, ESM, import nội bộ có đuôi `.ts` (chạy bằng `tsx`).

- `packages/core-translate` — bounded context **Translation**, package dùng chung với một tool dịch chat khác → **không được import gì từ `apps/`**.
- `apps/app/src/contexts/{tracking,notification}/{domain,application,infrastructure}` — các bounded context còn lại. Domain thuần (không I/O); application chỉ dùng domain + port; context không import domain của nhau, giao tiếp qua domain event hoặc ID.
- `apps/app/src/shared/ports` — port cho hệ ngoài (`GitHubGateway`, `Notifier`, `Clock`); `Translator` nằm trong core-translate.
- `apps/app/src/composition-root.ts` — **nơi duy nhất** chọn adapter thật hay fake, theo `APP_ADAPTERS`.
- `apps/app/src/server` (Hono) phục vụ `/api/*` và build tĩnh của `apps/app/web` (Vite + React).

Từ vựng (`docs/domain/ubiquitous-language.md`) là bắt buộc cho tên trong code. Model, invariant, event của từng context: `docs/domain/bounded-contexts/`. Quyết định kiến trúc: `docs/architecture/adr/`.

Hai bẫy đã biết từ thiết kế: mốc theo dõi luôn là `Issue.updatedAt` (không phải `updatedAt` của project item); Projects v2 không sort theo thời gian phía server.

## Test harness và e2e lock

Chi tiết: `docs/architecture/testing-harness.md`.

- `APP_ADAPTERS=fake` lắp `FakeGitHub`, `FakeTranslator` (trả `"[vi] " + text`), `RecordingNotifier`, `ControllableClock` và mount `/__test__/*` (reset, nạp issue giả, đặt giờ, đọc toast). E2E chỉ đi qua fixture `harness` trong `e2e/support/harness.ts`.
- Thêm hệ ngoài mới → port + fake trong `apps/app/src/test-harness/` trước, adapter thật sau.
- **`e2e/specs/` là hợp đồng hành vi người dùng đã được user duyệt.** `e2e/specs.lock.json` giữ sha256; `pnpm e2e:lock:check` (trong `verify`/CI) fail nếu spec đổi. Khi implement, không sửa `e2e/specs/**` và không chạy `pnpm e2e:lock`; thấy test sai hay AC bất khả thi thì dừng và báo user. Chỉ re-lock sau khi user đồng ý đổi hành vi.

## Workflow

Tính năng mới đi qua skill `/feature <story | URL issue>` (`.claude/skills/feature/SKILL.md`), có cổng duyệt của user giữa các bước:

1. `analyst` (opus) → `docs/features/NNN-slug/spec.md` theo `_template.md`
2. Design: skill `design-brief` in prompt text để user tự dán vào Claude Design — **không lưu prompt vào repo**, chỉ lưu kết quả đã chốt vào mục UI của spec
3. `e2e-writer` (sonnet) viết e2e phải đỏ → user duyệt → `pnpm e2e:lock`
4. `implementer` (sonnet), TDD, commit mỗi bước
5. Orchestrator tự chạy `pnpm verify`
6. `reviewer` (opus), chỉ đọc
7. Push + PR theo `.github/pull_request_template.md`

Tiếp tục dở dang: `/feature resume NNN` (đọc "Workflow log" trong spec). Commit: `docs(NNN): …`, `test(e2e): lock behavior for NNN`, `feat(<ctx>): … (NNN)`.
