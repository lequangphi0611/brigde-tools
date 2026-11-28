# 005c — Lắp nhánh adapter thật + kiểm poller trên Windows thật

- Trạng thái: done (2026-11-28)
- Context: hạ tầng dùng chung (cấu hình app `AppConfig`, nhánh adapter thật của `composition-root.ts`, `startup.ts`, `main.ts`); dùng `PollCycle` / `PollScheduler` của Tracking (005b), `GhCliGateway` (005a), `buildRealTranslator` (003b)
- Cần UI: không

> **Tách từ 005b ở GATE 1 (2026-11-27).** Bản draft của 005b gồm cả logic poller và phần lắp ráp. User chọn tách: 005b giữ logic (kiểm trọn trong container), 005c (spec này) lắp nhánh adapter thật và kiểm trên máy thật. Thiết kế dưới đây chuyển nguyên từ draft 005b, không đổi hành vi. Đánh số AC: AC-28 → **AC-1**, AC-29 → **AC-2**, AC-30 → **AC-3**, AC-31 → **AC-4** (số cũ của draft 005b); **AC-5** mới (tách ra từ một dòng thiết kế của draft: `gh` chưa đăng nhập không chặn khởi động). Code 005b/005c gộp chung PR #11 với 005a.
>
> Phụ thuộc: 005b (`PollCycle`, `PollScheduler`, `formatPollLine`, migration `0003-tracking.sql`), 003b (`buildRealTranslator`), 005a (`GhCliGateway`, `fake-gh.mjs`), 004 (`openAppStorage`, `resolveDataDir`).

## User story
Là người dùng có máy công ty chạy GHES, tôi muốn chạy `pnpm start` là app đọc cấu hình project trong `<dataDir>/config.json`, mở DB thật, dùng `gh` thật và bắt đầu poll theo chu kỳ, lỗi cấu hình/khởi động được báo bằng một dòng mã ngắn (chi tiết như đường dẫn ở dòng riêng), để tôi kiểm được poller trên máy Windows thật chỉ bằng cách gõ lại các dòng `[startup]` / `[storage]` / `[poll]`.

## Ràng buộc đã chốt (user, 2026-11-27)
1. `GH_HOST` bắt buộc cho nhánh adapter thật (cùng quy tắc với `github-check`, ADR-0010).
2. Nhánh adapter thật: `openAppStorage(<dataDir>/app.db)`, `buildRealTranslator` (003b), `GhCliGateway`. Lỗi `StorageError` khi khởi động in đường dẫn DB ở **dòng riêng**; hàm format tách riêng, có unit test (dời từ review 004).
3. Cấu hình ở `<dataDir>/config.json` (Quyết định 3 của 005b): không mất khi thay zip. Tạm cho tới khi 013 có UI.
4. Chu kỳ mặc định 5 phút, cho phép số nguyên 1–60 (Quyết định 12 của 005b).
5. Root script `pnpm start` chạy nhánh thật; `pnpm dev` giữ cho fake (Quyết định 15 của 005b).
6. Kiểm trên máy thật: project cá nhân trên GHES (`ownerType: "user"`) có repo/issue thử, chạy đủ 7 bước (Quyết định 13 của 005b, user trả lời GATE 1).
7. 005c **không dịch, không hàng đợi, không toast**: `translator` được lắp nhưng chưa ai gọi (tới 006); notifier là bản không làm gì (tới 007).

## Phạm vi
- **Có:**
  - Cấu hình app `AppConfig` (`shared/infrastructure/app-config.ts`): đọc `<dataDir>/config.json`, kiểm bằng zod, mặc định, lỗi chỉ có mã và đường dẫn field. Ánh xạ sang `PollProjectConfig` của 005b.
  - `startup.ts`: chuỗi kiểm khởi động (`GH_HOST` → `dataDir` → cấu hình → storage), nhận env / fs / platform / homedir tiêm vào; `formatStartupError`, `formatStorageError` thuần.
  - Nhánh adapter thật của `buildDeps`: `openAppStorage`, `GhCliGateway`, `buildRealTranslator`, notifier rỗng, `systemClock`, `InProcessEventBus`, `PollCycle`, `PollScheduler` (log ra stdout).
  - `main.ts`: dùng `startup`, `scheduler.start()` sau khi server lên; SIGINT/SIGTERM tắt theo thứ tự `scheduler.stop()` → server → DB.
  - Root script `pnpm start` (`pnpm --filter @app/app start`).
  - Docs: mục "Kiểm poller (005b/005c)" trong `docs/spikes/diagnose.md`; `CLAUDE.md` (lệnh `pnpm start`, câu trạng thái "poller chưa có"); số đo máy thật vào `docs/spikes/projects-v2-polling.md` (Lần 5).
- **Không:** mọi logic poller (005b). Dịch, hàng đợi (006), toast (007), trang tình trạng / log ra file (009), nhiều project và cấu hình từ UI (013), chạy nền / một instance (020), chuyển cấu hình Claude CLI ra khỏi repo (021). Tự tạo `config.json` mẫu.

## Thiết kế

### Cấu hình app (`<dataDir>/config.json`, tới 013)
```json
{
  "project": { "owner": "<org hoặc user>", "ownerType": "org", "number": 12,
               "statusField": "Status", "closedStatuses": ["Done"] },
  "pollIntervalMin": 5,
  "claudeCliConfig": "C:\\…\\claude-cli.local.json"
}
```
- Bắt buộc: `project.owner` (chuỗi khác rỗng), `project.number` (số nguyên dương).
- Mặc định: `ownerType = "org"` (hoặc `"user"`), `statusField = "Status"`, `closedStatuses = []` (mỗi phần tử là chuỗi khác rỗng), `pollIntervalMin = 5` (số nguyên 1–60), `claudeCliConfig` = `<repo>/config/claude-cli.local.json` (cùng mặc định với `translate-issue`; 005c không gọi dịch nên file này không cần tồn tại lúc khởi động).
- Khoá lạ: bỏ qua (không lỗi), để thêm khoá ở story sau không làm hỏng file cũ.
- Đường dẫn file: `<dataDir>/config.json`, `dataDir` theo `resolveDataDir` (ADR-0008).
- Lỗi: `config_missing` (kèm đường dẫn file để in dòng riêng), `config_invalid field=(root)` (không phải JSON / không phải object), `config_invalid field=<đường dẫn field>` (vd. `project.number`, `project.closedStatuses.0`). Không bao giờ in giá trị đã nhập.

### Khởi động nhánh thật (`APP_ADAPTERS` khác `fake`)
Thứ tự, dừng ở lỗi đầu tiên; exit code 2 cho lỗi người dùng sửa được, 1 cho lỗi lưu trữ/nội bộ:
1. `GH_HOST` chưa đặt (hoặc rỗng) → `[startup] FAIL gh_host_unset` (exit 2). Không mở DB, không gọi `gh`.
2. `resolveDataDir` lỗi → `[startup] FAIL data_dir_invalid data=<nguồn>` (exit 2; `<nguồn>` theo `DataDirSource`, không in đường dẫn).
3. Đọc cấu hình: không có file → `[startup] FAIL config_missing` + dòng riêng `[startup] config=<đường dẫn>` (exit 2); JSON hỏng → `[startup] FAIL config_invalid field=(root)`; sai field → `[startup] FAIL config_invalid field=<đường dẫn field>` (exit 2).
4. `openAppStorage(<dataDir>/app.db)` lỗi → `formatStorageError`:
   ```
   [storage] FAIL migration_failed migration=3 sqlite=1: <message của StorageError>
   [storage] db=C:\Users\…\AppData\Local\gh-issue-translator\app.db
   ```
   (exit 1; `migration=` / `sqlite=` chỉ có khi có giá trị; message của `StorageError` theo ADR-0008 không chứa dữ liệu). Người dùng gõ lại dòng đầu; dòng `db=` để tự đọc.
5. Lắp `GhCliGateway`, `buildRealTranslator({ configPath: claudeCliConfig, storage, clock })`, notifier không làm gì (tới 007), `systemClock`, `InProcessEventBus`, `PollCycle` (với `PollProjectConfig` từ cấu hình), `PollScheduler` (`pollIntervalMin` từ cấu hình, `log` = `console.log`); in `listening on …` như hiện nay, rồi `scheduler.start()`.
- `gh` chưa đăng nhập / thiếu scope / mạng lỗi **không** chặn khởi động: chu kỳ in `[poll] FAIL github:<reason>`, thử lại chu kỳ sau (AC-5).
- SIGINT/SIGTERM: `scheduler.stop()` → đóng server → đóng DB.
- Dòng `[startup] FAIL …` không bao giờ chứa đường dẫn, owner, số project hay giá trị `GH_HOST`.

## Acceptance criteria
Không có e2e: 005c không đổi UI, không toast; nhánh thật không chạy được trong Playwright (cần `gh`, `GH_HOST`). Khoá bằng Vitest với env / fs tiêm vào, thư mục tạm và `fake-gh.mjs` (005a). Bảng kiểm trên Windows thật (mục sau) là điều kiện "done", không tự động.

```gherkin
Scenario: AC-1 Đọc cấu hình app
  Given dataDir có config.json chỉ khai project.owner và project.number
  Then cấu hình có ownerType "org", statusField "Status", closedStatuses [], pollIntervalMin 5, claudeCliConfig mặc định
  Given config.json có ownerType "user" và một khoá lạ ở gốc
  Then cấu hình đọc được, ownerType "user", khoá lạ bị bỏ qua
  Given không có config.json
  Then lỗi config_missing kèm đường dẫn file (để in ở dòng riêng)
  Given config.json không phải JSON (hoặc là mảng)
  Then lỗi config_invalid field=(root)
  Given project.number là "12", hoặc pollIntervalMin là 0 hoặc 61 hoặc 2.5, hoặc closedStatuses chứa "", hoặc thiếu project.owner
  Then lỗi config_invalid với field tương ứng (project.number, pollIntervalMin, project.closedStatuses.0, project.owner)
  And thông báo không chứa giá trị đã nhập

Scenario: AC-2 Khởi động nhánh thật: lỗi trước khi chạy
  Given APP_ADAPTERS không phải fake
  When GH_HOST chưa đặt
  Then in "[startup] FAIL gh_host_unset", exit 2, không tạo app.db, không gọi gh
  When GH_HOST đã đặt nhưng APP_DATA_DIR là đường dẫn tương đối
  Then in "[startup] FAIL data_dir_invalid data=APP_DATA_DIR", exit 2
  When GH_HOST đã đặt nhưng thiếu config.json
  Then in "[startup] FAIL config_missing" và một dòng riêng "[startup] config=<đường dẫn>", exit 2, không tạo app.db
  And mọi dòng FAIL không chứa đường dẫn, owner hay giá trị GH_HOST

Scenario: AC-3 Khởi động nhánh thật: lắp adapter thật
  Given GH_HOST đã đặt, APP_DATA_DIR là thư mục tạm có config.json hợp lệ
  When dựng deps nhánh thật
  Then DB nằm ở <dataDir>/app.db và schemaVersion là 3
  And github là GhCliGateway, translator dựng bằng buildRealTranslator với claudeCliConfig của cấu hình (file chưa tồn tại vẫn khởi động được)
  And PollScheduler dùng pollIntervalMin của cấu hình
  And chu kỳ đầu với fake gh mức process (board 3 issue) in "[poll] BASELINE issues=3 …"
  When dựng lại deps trên cùng thư mục và chạy một chu kỳ với cùng dữ liệu
  Then dòng in ra bắt đầu bằng "[poll] OK" và có new=0

Scenario: AC-4 Format lỗi lưu trữ
  Given StorageError với từng reason, có và không có migration, có và không có sqliteCode
  When formatStorageError(e, dbPath)
  Then dòng 1 là "[storage] FAIL <reason>[ migration=N][ sqlite=C]: <message>" và không chứa dbPath
  And dòng 2 là "[storage] db=<dbPath>"
  And khởi động nhánh thật mà openAppStorage ném StorageError thì in đúng hai dòng đó và exit 1

Scenario: AC-5 gh chưa đăng nhập không chặn khởi động
  Given GH_HOST đã đặt, config.json hợp lệ, fake gh mức process ở chế độ auth (chưa đăng nhập)
  When dựng deps nhánh thật và chạy chu kỳ đầu
  Then khởi động thành công (không exit) và in "[poll] FAIL github:not_authenticated ms=…"
  And project vẫn chưa lấy mốc
  When fake gh chuyển sang chế độ ok và chạy chu kỳ kế tiếp
  Then in "[poll] BASELINE …"
```

| AC | Khoá bằng | File |
|---|---|---|
| AC-1 | unit | `apps/app/src/shared/infrastructure/app-config.test.ts` |
| AC-2, AC-4 | unit (`startup` nhận env/fs/platform tiêm vào; hàm format thuần) | `apps/app/src/startup.test.ts` |
| AC-3, AC-5 | unit/adapter (thư mục tạm + `fake-gh.mjs`, chạy `PollCycle` trực tiếp, không chờ hẹn giờ) | `apps/app/src/composition-root.test.ts` |

Tên file là đề xuất; implementer giữ đúng tầng.

Đối chiếu draft 005b: AC-28 → AC-1, AC-29 → AC-2, AC-30 → AC-3, AC-31 → AC-4; nháp 005a B13 → AC-4, B14 → AC-2.

## Kiểm trên máy Windows thật (không tự động; người dùng gõ lại dòng `[poll]`)
Điều kiện "done" của 005c, chạy trước khi merge PR #11. Chuẩn bị: `GH_HOST` đặt sẵn; một project Projects v2 **cá nhân** trên GHES có repo/issue thử (user chốt GATE 1); tạo `%LOCALAPPDATA%\gh-issue-translator\config.json`:
```json
{ "project": { "owner": "<user>", "ownerType": "user", "number": <n>, "closedStatuses": ["<tên cột đóng nếu có>"] }, "pollIntervalMin": 1 }
```
`pnpm install`; `pnpm start`. Board thử nên có ít nhất một issue mở và một issue đóng (state CLOSED hoặc ở cột thuộc `closedStatuses`).

| Bước | Thao tác | Dòng mong đợi |
|---|---|---|
| 1 | Khởi động lần đầu | `[poll] BASELINE issues=<số issue trên board thử> closed=<…> pages=<…> ms=<…>` |
| 2 | Chờ một chu kỳ, không làm gì | `[poll] OK … details=0 new=0 newComments=0 edited=0 …` |
| 3 | Comment vào một issue đang mở | `[poll] OK … details=1 newComments=1 …` |
| 4 | Sửa body issue đó | `[poll] OK … edited=1 …` |
| 5 | Comment vào một issue đã đóng (hoặc kéo issue có comment mới sang cột close) | `[poll] OK … details=0 closedChanged=1 newComments=0 …` |
| 6 | Tắt (Ctrl+C) rồi chạy lại `pnpm start` | dòng `[poll]` đầu là `OK …` (không phải `BASELINE`), `new=0` |
| 7 | Bỏ `GH_HOST` rồi chạy | `[startup] FAIL gh_host_unset` |

Số đo ghi vào `docs/spikes/projects-v2-polling.md` (Lần 5). `closed=` ở bước 1 lệch so với số người dùng thấy trên board → kiểm `closedStatuses` / tên field. Bước nào lệch → ghi vào Workflow log, báo user trước khi sửa.

Cần kiểm chứng: Projects v2 của **user** trên GHES đọc được bằng `gh` với scope hiện có (005a chỉ đo trên project org). Kiểm trước bằng `pnpm -s github-check --owner <user> --owner-type user --number <n>`; `FAIL project_not_found` / `scope_missing` → báo user trước khi chạy bảng kiểm.

## Tác động domain
- Thuật ngữ: `AppConfig` (đã có trong `ubiquitous-language.md`, ghi rõ đọc ở 005c). Không thêm thuật ngữ mới.
- Aggregate / invariant / event: không đổi (thuộc 005b).
- Port mới hoặc đổi: không. `PollProjectConfig` (005b) nhận giá trị từ `AppConfig`.
- ADR cần viết: không. Vị trí `config.json` là tạm tới 013, dễ đổi.

## Ngoài phạm vi
- Logic poller (005b). Dịch, hàng đợi (006), toast thật (007), trang tình trạng và log ra file (009).
- Nhiều project, cấu hình từ UI (013 / 014). Tự sinh `config.json` mẫu, hướng dẫn cài đặt (021).
- Chạy nền khi đăng nhập, một instance, cổng cố định (020). Dọn thư mục `ghit-ai-*`.
- Theo dõi thay đổi `config.json` khi đang chạy (phải restart).

## Câu hỏi mở
Không còn (các quyết định liên quan đã chốt ở GATE 1 của 005b: câu 3, 12, 13, 15).

## Kế hoạch implement
(Implementer làm theo thứ tự, mỗi bước một commit, test xanh sau mỗi bước. Làm sau 005b. Commit `feat(app): … (005c)`.)
1. **Cấu hình app** (`shared/infrastructure/app-config.ts`, zod; đọc file qua fs tiêm vào; ánh xạ sang `PollProjectConfig`) — AC-1.
2. **`startup.ts`**: kiểm `GH_HOST`, `dataDir`, cấu hình; `formatStartupError`, `formatStorageError`; nhận env / fs / platform / homedir / `openStorage` tiêm vào, trả kết quả hoặc `{ lines, exitCode }` — AC-2, AC-4.
3. **Nhánh thật của `buildDeps`** (`openAppStorage`, `GhCliGateway`, `buildRealTranslator`, notifier rỗng, `systemClock`, `InProcessEventBus`, `PollCycle`, `PollScheduler`); `Deps` thêm `scheduler` (chỉ nhánh thật) — AC-3, AC-5 với thư mục tạm + `fake-gh.mjs`.
4. **`main.ts` + root script**: dùng `startup`, in dòng lỗi + exit code; `scheduler.start()` sau khi server lên; tắt theo thứ tự stop → server → DB; root `package.json` thêm `"start": "pnpm --filter @app/app start"`. Kiểm tay trong container: `GH_HOST= pnpm start` in `gh_host_unset`. `pnpm verify` xanh.
5. **Docs**: mục "Kiểm poller (005b/005c)" trong `docs/spikes/diagnose.md` (tạo `config.json`, `pnpm start`, bảng bước/dòng mong đợi, bảng trường `[poll]` từ spec 005b); thêm `pnpm start` vào `CLAUDE.md` và sửa câu trạng thái "toast và poller chưa có" (cần user đồng ý khi sửa `CLAUDE.md`).
6. **ĐIỂM DỪNG — kiểm trên máy thật** (user): `github-check` với project cá nhân, rồi 7 bước ở trên. Orchestrator ghi kết quả vào `docs/spikes/projects-v2-polling.md` (Lần 5) và Workflow log. Lệch → báo user, không tự sửa AC.

## Finding để lại
- SIGINT/SIGTERM chỉ `scheduler.stop()` → server → DB; tiến trình `gh` con đang chạy không bị dọn khi tắt. Xử lý ở 020 (chạy nền / một instance).

## Workflow log
| Bước | Thời điểm | Kết quả |
|---|---|---|
| 1 Phân tích | 2026-11-27 | Tách từ draft 005b ở GATE 1 của 005b: AC-28…31 cũ → AC-1…4, thêm AC-5 (gh chưa đăng nhập không chặn khởi động, trước là một dòng thiết kế), bảng kiểm Windows 7 bước. Không e2e |
| GATE 1 | 2026-11-27 | User duyệt (cùng GATE 1 của 005b): `config.json` ở `<dataDir>`, poll 5 phút (1–60), `pnpm start`, kiểm máy thật bằng project cá nhân GHES (`ownerType: "user"`) đủ 7 bước. Code gộp PR #11 với 005a, 005b. Trạng thái approved |
| Implement 1–5 | 2026-11-27 | AppConfig, startup/format, nhánh thật buildDeps(mode, RealWiring), main.ts + `pnpm start`, docs (diagnose.md, CLAUDE.md). Chờ bước 6 (kiểm máy thật, user) |
| Sửa theo review | 2026-11-27 | Review APPROVE; sửa: `toPollProjectConfig` về composition-root (app-config không import tracking), test claudeCliConfig vào translator, field `project.closedStatuses.0` (spec cho khớp), `isAbsoluteFor` cho claudeCliConfig, ghi chú lỗi đọc file ở diagnose.md, `pnpm dev` dùng cross-env APP_ADAPTERS=fake |
| 6 Kiểm máy thật | 2026-11-28 | User chạy 7 bước trên project cá nhân GHES: đạt đủ (kèm issue mới `new=1`). Ghi ở `docs/spikes/projects-v2-polling.md` Lần 5. Story done; code trong PR #11 |
