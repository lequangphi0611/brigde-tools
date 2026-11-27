# 004 — Lưu trữ SQLite + migration + bảng `setting`

- Trạng thái: draft
- Context: hạ tầng dùng chung (`apps/app/src/shared`), phục vụ Tracking / Translation / Notification
- Cần UI: không

## User story
Là người dùng chạy app nền trên máy Windows công ty, tôi muốn trạng thái của app (cài đặt, và sau này mốc theo dõi, job dịch, cache bản dịch) được lưu vào một file SQLite local nằm ngoài thư mục code và tự nâng cấp schema khi khởi động, để khởi động lại máy hay thay bản zip mới không làm mất dữ liệu, và khi lưu trữ có vấn đề thì app báo rõ lý do thay vì chạy sai im lặng.

## Phạm vi (đã phản biện)
- **Có:**
  - Mở DB bằng `node:sqlite` (ADR-0004) với pragma chuẩn, phát hiện file hỏng, helper transaction.
  - Migration runner: file `.sql` đánh số, mỗi migration một transaction, phiên bản trong `PRAGMA user_version`.
  - Migration `0001-setting.sql` (bảng `setting`), port `SettingStore` và adapter SQLite.
  - Xác định **thư mục dữ liệu** (`dataDir`) trên Windows và nơi khác (ADR-0008).
  - Lắp vào composition root: chế độ fake dùng SQLite `:memory:`, `/__test__/reset` xoá dữ liệu.
  - Chỉ tắt `ExperimentalWarning` của SQLite.
  - Bổ sung `pnpm diagnose`: kiểm WAL trên **file** thật trong `dataDir` (dòng `node:sqlite` hiện tại chỉ kiểm `:memory:`, mà `:memory:` luôn trả `journal_mode=memory` nên chưa kiểm được WAL).
- **Không:** bảng của 003 (cache), 005 (project, issue, `lastSeen`), 006 (`job`): mỗi story tự thêm migration của mình. Chưa có bên nào đọc/ghi `setting` trong app (bên dùng đầu tiên dự kiến là 017 `pausedUntil`). Nhánh adapter thật của composition root vẫn `throw` như hiện tại (xem Câu hỏi mở 4).

### Những gì 003 và 006 sẽ cần từ tầng này (để thiết kế đúng ngay, không làm bảng)
| Story | Cần | 004 cung cấp |
|---|---|---|
| 003 cache (`hash + direction + glossaryVersion`) | Khoá chính ghép, `INSERT … ON CONFLICT`, text Nhật/Việt giữ nguyên byte. Port `TranslationCache` trong `core-translate`, adapter trong app | Handle DB dùng chung cho adapter ở app; quy ước migration và tên bảng; test round-trip Unicode (AC-8) |
| 006 `job` bền | Claim job trong transaction (`BEGIN IMMEDIATE`, `UPDATE … RETURNING`), phục hồi job `running` khi khởi động, thời gian retry theo `Clock` | `transaction(fn)` (AC-12), `busy_timeout`, migration chạy **trước** khi server/hàng đợi bắt đầu, quy ước thời gian ISO từ `Clock` (ADR-0008) |
| 005 `lastSeen` | Bền qua restart | AC-9 kiểm bền qua đóng/mở lại |

## Thiết kế đề xuất (để AC có nghĩa cụ thể)

**Vị trí code** (ADR-0008):
- `apps/app/src/shared/infrastructure/sqlite/` — `openDatabase`, `transaction`, migration runner, `StorageError`, `migrations/*.sql`, `SqliteSettingStore`.
- `apps/app/src/shared/infrastructure/data-dir.ts` — `resolveDataDir(env, platform, homedir)` thuần.
- `apps/app/src/shared/ports/setting-store.port.ts` — port `SettingStore`.

**Thư mục dữ liệu** `resolveDataDir`: `APP_DATA_DIR` (phải là đường dẫn tuyệt đối, không thì `Error`) → Windows `%LOCALAPPDATA%\gh-issue-translator` (thiếu `LOCALAPPDATA` thì `<homedir>\AppData\Local\gh-issue-translator`) → nơi khác `$XDG_DATA_HOME/gh-issue-translator` hoặc `<homedir>/.local/share/gh-issue-translator`. File DB = `<dataDir>/app.db`.

**Mở DB** `openDatabase(path)` (`path` là file hoặc `":memory:"`):
- Pragma: `journal_mode=WAL` (chỉ với file), `foreign_keys=ON`, `busy_timeout=5000`.
- Chạy `PRAGMA quick_check`; kết quả khác `ok`, hoặc lỗi SQLite `SQLITE_NOTADB` (26) / `SQLITE_CORRUPT` (11) ở bất kỳ bước nào → `StorageError("corrupt")`. Không xoá, không đổi tên, không ghi đè file.
- `node:sqlite` mở file rác **không** lỗi ngay; lỗi `errcode 26` chỉ xuất hiện ở câu lệnh đầu tiên (đã thử trên Node 22.23 trong container). Vì vậy pragma đầu tiên phải nằm trong khối bắt lỗi.
- Trả về handle có `transaction(fn)`, `schemaVersion()`, `close()` và truy cập `DatabaseSync` bên dưới cho repository adapter.

**`StorageError`**: `reason` = `open_failed` | `corrupt` | `invalid_migrations` | `migration_failed` | `schema_too_new`; kèm `migration?` (số), `sqliteCode?` (`errcode`), `sqliteMessage?` (`errstr`). Message không chứa giá trị của hàng dữ liệu hay nội dung SQL.

**Migration**:
- File `NNNN-<tên>.sql` (`^\d{4}-[a-z0-9-]+\.sql$`) trong `migrations/`. File `.sql` sai mẫu, số trùng, hoặc chuỗi số không liên tục từ 1 → `StorageError("invalid_migrations")` trước khi áp dụng bất cứ gì. File không đuôi `.sql` bị bỏ qua.
- `user_version` hiện tại = V, migration cao nhất = M. V > M → `StorageError("schema_too_new")`, không sửa file (vd chạy lại bản zip cũ trên DB mới). V = M → không làm gì.
- Mỗi migration N (V < N ≤ M, tăng dần): `BEGIN IMMEDIATE` → nội dung file → `PRAGMA user_version = N` → `COMMIT`. Lỗi → `ROLLBACK` (trong `node:sqlite`, `exec` lỗi giữa chừng để transaction còn mở, phải rollback tường minh) → `StorageError("migration_failed", migration: N)`; migration < N đã commit được giữ. Đã thử trong container: `PRAGMA user_version` trong transaction bị rollback cùng transaction.
- Quy ước: file migration không chứa `BEGIN`/`COMMIT` của transaction; file đã merge thì không sửa (ADR-0008).

**Khởi động** `openAppStorage({ path })`: tạo `dataDir` nếu chưa có (đệ quy) → `openDatabase` → chạy migration. Lỗi tạm thời (mã chính `errcode & 0xff` là `SQLITE_BUSY` 5, `SQLITE_LOCKED` 6, `SQLITE_IOERR` 10, `SQLITE_CANTOPEN` 14, hoặc `EPERM`/`EBUSY` khi tạo thư mục) → thử lại tối đa 3 lần, chờ 500 ms × số lần (hàm chờ được tiêm để test). `corrupt`, `invalid_migrations`, `schema_too_new`, lỗi SQL của migration → không thử lại. Hết lượt → ném lỗi cuối. `main.ts` bắt `StorageError`, in **một dòng** ra stderr (`[storage] <reason> …`, có đường dẫn DB) và thoát mã 1 trước khi mở cổng HTTP.

**Bảng `setting`** (`0001-setting.sql`): `CREATE TABLE setting (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT;`

**Port** `SettingStore` (đồng bộ, như `node:sqlite`):
- `get(key): string | null`, `set(key, value: string): void` (ghi đè), `delete(key): void` (không có thì thôi).
- Khoá theo dạng `<context>.<tên>` (`^[a-z]+\.[A-Za-z0-9_.-]{1,100}$`), vd `notification.pausedUntil`. Khoá sai mẫu → `Error` thường (lỗi lập trình). Context tự mã hoá giá trị (ISO string, JSON).

**Composition root**: `Deps` thêm `settings: SettingStore` (và handle storage để đóng khi tắt). `APP_ADAPTERS=fake` → `openAppStorage({ path: ":memory:" })`, không đụng tới `dataDir`. `harness` thêm `storage`; `POST /__test__/reset` xoá mọi hàng của mọi bảng người dùng (bảng không bắt đầu bằng `sqlite_`), giữ schema và `user_version`, tạm tắt kiểm khoá ngoại trong lúc xoá. Không thêm endpoint harness mới.

**ExperimentalWarning**: trước khi nạp `node:sqlite` lần đầu, lọc riêng cảnh báo `ExperimentalWarning` có message chứa `SQLite`; mọi cảnh báo khác vẫn in. Cảnh báo phát ra khi **nạp module**, nên module SQLite phải được nạp sau bộ lọc (vd `process.getBuiltinModule("node:sqlite")` như `diagnose`, hoặc import động), không qua import tĩnh bị hoist lên trước.

## Acceptance criteria

```gherkin
Scenario: AC-1 Lần khởi động đầu tạo thư mục dữ liệu, file DB và chạy mọi migration
  Given thư mục tạm T không chứa thư mục "data"
  When gọi openAppStorage với path "T/data/app.db"
  Then thư mục "T/data" và file "T/data/app.db" tồn tại
  And schemaVersion() bằng số của migration cao nhất trong thư mục migrations (hiện là 1)
  And bảng "setting" tồn tại với cột key (khoá chính) và value

Scenario: AC-2 Khởi động lại chỉ chạy migration chưa áp dụng
  Given DB file đã ở user_version = 1 với bảng do migration 1 tạo, có một hàng dữ liệu
  When chạy migration với danh sách [1, 2] (migration 2 tạo bảng "probe")
  Then chỉ migration 2 được thực thi, user_version = 2, hàng dữ liệu cũ còn nguyên
  When chạy lại với cùng danh sách
  Then không migration nào được thực thi, user_version vẫn = 2

Scenario: AC-3 Migration lỗi được rollback trọn vẹn
  Given DB ở user_version = 1
  And migration 2 tạo bảng "probe" rồi chứa một câu SQL sai cú pháp
  And migration 3 hợp lệ
  When chạy migration
  Then ném StorageError reason "migration_failed", migration = 2, có sqliteCode
  And user_version vẫn = 1, bảng "probe" không tồn tại, migration 3 không chạy
  And DB không còn transaction mở và vẫn dùng tiếp được (đọc được bảng của migration 1)

Scenario: AC-4 Danh sách migration không hợp lệ bị từ chối trước khi áp dụng
  Given DB mới (user_version = 0)
  When thư mục migration có một trong các trường hợp: hai file cùng số "0002"; có 0001 và 0003 nhưng thiếu 0002; file "2-setting.sql" hoặc "0002_Setting.sql"
  Then ném StorageError reason "invalid_migrations"
  And user_version vẫn = 0 và không bảng nào được tạo
  And file không có đuôi ".sql" (vd "README.md") trong thư mục bị bỏ qua, không gây lỗi

Scenario: AC-5 DB mới hơn app thì từ chối, không sửa file
  Given DB file có user_version = 5 và app chỉ biết migration tới 1
  When gọi openAppStorage
  Then ném StorageError reason "schema_too_new"
  And nội dung file DB (sha256) không đổi

Scenario: AC-6 File DB hỏng thì dừng, giữ nguyên file
  Given "app.db" là file rác (vd 4 KB chữ "garbage"), hoặc một DB hợp lệ bị ghi đè byte giữa file
  When gọi openAppStorage
  Then ném StorageError reason "corrupt" có sqliteCode khi có
  And sha256 của "app.db" không đổi, không có file DB mới nào được tạo thay thế
  And message lỗi không chứa nội dung của file

Scenario: AC-7 Pragma chuẩn trên DB file
  Given DB mở bằng openAppStorage trên file trong thư mục tạm
  Then PRAGMA journal_mode = "wal", PRAGMA foreign_keys = 1, PRAGMA busy_timeout >= 5000
  And với ":memory:" thì foreign_keys = 1 và không lỗi dù journal_mode không phải "wal"

Scenario: AC-8 SettingStore đọc, ghi, ghi đè, xoá
  Given SettingStore trên DB đã migrate
  Then get("notification.pausedUntil") = null khi chưa có
  When set("notification.pausedUntil", "2026-01-01T10:00:00.000Z") rồi set lại "2026-01-01T11:00:00.000Z"
  Then get trả "2026-01-01T11:00:00.000Z" và bảng setting chỉ có một hàng cho khoá đó
  When set("tracking.note", "課題「ログイン」— tiếng Việt có dấu ✓ \"quote\" \n dòng 2")
  Then get trả đúng chuỗi đó từng ký tự
  When delete("notification.pausedUntil") hai lần
  Then không lỗi và get trả null
  When gọi get/set/delete với khoá "", "pausedUntil", "Notification.x", hoặc khoá dài hơn 100 ký tự sau dấu chấm
  Then ném Error thường, không ghi gì

Scenario: AC-9 Setting bền qua khởi động lại
  Given openAppStorage trên file "T/app.db" và set("notification.pausedUntil", "X")
  When đóng storage rồi gọi openAppStorage lại với cùng đường dẫn
  Then get("notification.pausedUntil") = "X" và không migration nào chạy lại

Scenario: AC-10 Vị trí thư mục dữ liệu
  Then resolveDataDir với APP_DATA_DIR = đường dẫn tuyệt đối P trả P (mọi nền tảng)
  And APP_DATA_DIR là đường dẫn tương đối → ném Error
  And trên win32 với LOCALAPPDATA = "C:\Users\u\AppData\Local" trả "C:\Users\u\AppData\Local\gh-issue-translator"
  And trên win32 không có LOCALAPPDATA trả "<homedir>\AppData\Local\gh-issue-translator"
  And trên linux với XDG_DATA_HOME = "/x" trả "/x/gh-issue-translator", không có thì "<homedir>/.local/share/gh-issue-translator"
  And không bao giờ trả đường dẫn nằm trong thư mục repo hay cwd

Scenario: AC-11 Lỗi tạm thời khi khởi động được thử lại có giới hạn
  Given trình mở DB giả ném lỗi SQLite errcode 5 (BUSY) ở lần 1 và errcode 14 (CANTOPEN) ở lần 2, lần 3 thành công
  When gọi openAppStorage với hàm chờ giả
  Then mở thành công, hàm chờ được gọi 2 lần với 500 ms rồi 1000 ms
  Given trình mở giả luôn ném errcode 10 (IOERR, kể cả mã mở rộng như 5898)
  Then sau đúng 3 lần thử ném StorageError reason "open_failed" có sqliteCode
  Given lỗi là corrupt, invalid_migrations, schema_too_new hoặc lỗi SQL của migration
  Then không thử lại (trình mở chỉ được gọi 1 lần)

Scenario: AC-12 transaction(fn)
  Given handle DB đã migrate
  When transaction(fn) với fn ghi hai hàng setting rồi trả về giá trị v
  Then cả hai hàng được lưu và transaction trả v
  When fn ghi một hàng rồi ném lỗi E
  Then không hàng nào được lưu, lỗi E được ném lại nguyên vẹn, DB không còn transaction mở
  When gọi transaction lồng trong fn của transaction khác
  Then ném Error, transaction ngoài bị rollback

Scenario: AC-13 Chế độ fake dùng SQLite trong bộ nhớ và reset sạch dữ liệu
  Given app tạo bằng createApp(buildDeps("fake")) với APP_DATA_DIR trỏ tới thư mục tạm rỗng
  Then deps.settings dùng được ngay (schema đã migrate) và thư mục tạm vẫn rỗng (không file DB nào được tạo)
  When set("notification.pausedUntil", "X") rồi gọi POST /__test__/reset
  Then get("notification.pausedUntil") = null, bảng setting vẫn tồn tại, schemaVersion không đổi
  And hai lần buildDeps("fake") cho hai DB độc lập

Scenario: AC-14 Chỉ tắt ExperimentalWarning của SQLite
  Given một process Node con nạp module storage, mở DB ":memory:", rồi tự phát process.emitWarning("x", "ExperimentalWarning")
  Then stderr không chứa "SQLite is an experimental feature"
  And stderr vẫn chứa cảnh báo ExperimentalWarning "x"

Scenario: AC-15 diagnose kiểm WAL trên file trong thư mục dữ liệu
  Given chạy pnpm diagnose (không tham số) trên máy có node:sqlite
  Then có dòng "node:sqlite file" với OK khi: tạo được thư mục dữ liệu, tạo file DB tạm trong đó, journal_mode trả "wal", ghi rồi đọc lại được chuỗi Nhật/Việt, đóng và xoá được file DB tạm cùng "-wal"/"-shm"
  And bước nào lỗi thì FAIL kèm tên bước và mã lỗi (vd "EPERM", "SQLITE_CANTOPEN"), xoá không được thì WARN kèm mã lỗi
  And dòng output không chứa đường dẫn đầy đủ hay tên người dùng Windows (chỉ ghi nguồn: "APP_DATA_DIR" / "LOCALAPPDATA" / "fallback")
  And file DB thật "app.db" (nếu có) không bị mở hay sửa
```

| AC | Khoá bằng | File |
|---|---|---|
| AC-1 | integration (Vitest, thư mục tạm) | `apps/app/src/shared/infrastructure/sqlite/app-storage.test.ts` |
| AC-2 | integration | `apps/app/src/shared/infrastructure/sqlite/migrations.test.ts` |
| AC-3 | integration | `apps/app/src/shared/infrastructure/sqlite/migrations.test.ts` |
| AC-4 | unit (danh sách file thuần) + integration | `apps/app/src/shared/infrastructure/sqlite/migrations.test.ts` |
| AC-5 | integration | `apps/app/src/shared/infrastructure/sqlite/app-storage.test.ts` |
| AC-6 | integration | `apps/app/src/shared/infrastructure/sqlite/open-database.test.ts` |
| AC-7 | integration | `apps/app/src/shared/infrastructure/sqlite/open-database.test.ts` |
| AC-8 | integration (`:memory:`) | `apps/app/src/shared/infrastructure/sqlite/sqlite-setting-store.test.ts` |
| AC-9 | integration (file tạm) | `apps/app/src/shared/infrastructure/sqlite/sqlite-setting-store.test.ts` |
| AC-10 | unit | `apps/app/src/shared/infrastructure/data-dir.test.ts` |
| AC-11 | unit (trình mở + hàm chờ giả) | `apps/app/src/shared/infrastructure/sqlite/app-storage.test.ts` |
| AC-12 | integration (`:memory:`) | `apps/app/src/shared/infrastructure/sqlite/open-database.test.ts` |
| AC-13 | integration (Hono `app.request`, không Playwright) | `apps/app/src/composition-root.test.ts` |
| AC-14 | integration (process con) | `apps/app/src/shared/infrastructure/sqlite/sqlite-warning.test.ts` |
| AC-15 | unit cho phần thuần trong `checks.mjs` + chạy tay trên máy thật | `scripts/diagnose/checks.test.ts` |

**Không có e2e mới cho 004.** Lý do:
- Story không có UI, không có hành vi người dùng nào nhìn thấy được qua trình duyệt. `e2e/specs/` là hợp đồng hành vi người dùng; khoá một spec không có gì để người dùng thấy chỉ thêm chi phí re-lock.
- "Khởi động lại vẫn giữ setting" cần dừng/chạy lại process app; Playwright `webServer` do config quản lý, không restart được giữa test, và chế độ fake dùng `:memory:` (ADR-0008) nên restart vốn mất dữ liệu. Tính bền được khoá ở AC-9 (đóng/mở lại cùng file), là đúng tầng.
- Spec `smoke.spec.ts` hiện có vẫn chạy trong `pnpm verify` và chứng minh app fake khởi động được với storage + migration (webServer chờ `/api/health`). Không sửa spec đó.
- Hành vi người dùng đầu tiên dựa vào `setting` là 017 (tạm dừng toàn cục qua restart); e2e của story đó sẽ khoá nó.

## Tác động domain
- Thuật ngữ mới (→ `ubiquitous-language.md`, đã thêm): **Cài đặt** `Setting` / `SettingStore`; **Thư mục dữ liệu** `dataDir`; **Migration** `Migration`; **Phiên bản schema** `schemaVersion`; **Lỗi lưu trữ** `StorageError`.
- Aggregate / invariant / event thay đổi: không có aggregate hay event mới. Invariant hạ tầng: `schemaVersion` chỉ tăng, bằng số migration cuối đã commit; app không chạy với `schemaVersion` lớn hơn migration nó biết. `GlobalPause` (Notification) sẽ lưu qua `SettingStore` khoá `notification.pausedUntil` (ghi chú trong `bounded-contexts/notification.md`, implement ở 017).
- Port mới: `SettingStore` (`apps/app/src/shared/ports/setting-store.port.ts`). `Deps` thêm `settings`.
- ADR cần viết: ADR-0008 (Proposed) — `dataDir`, một chuỗi migration toàn app, thời gian ISO từ `Clock`, SQLite thật `:memory:` trong chế độ fake thay cho repository fake, `shared/infrastructure`, dừng khi DB hỏng.

## UI (nếu có)
Không có.

## Ngoài phạm vi
- Bảng của 003, 005, 006 và mọi repository của context.
- Bên đọc/ghi `setting` trong app (017), API HTTP cho setting.
- Hiển thị lỗi lưu trữ trên trang tình trạng, log ra file (009). 004 chỉ in một dòng stderr và thoát mã 1.
- Sao lưu, `VACUUM`, xoay vòng file, xuất/nhập dữ liệu.
- Checksum phát hiện migration đã áp dụng bị sửa; migration "down".
- Chỉ một instance (020). Migration dùng `BEGIN IMMEDIATE` + `busy_timeout` nên hai process cùng khởi động không làm hỏng schema, nhưng không chặn instance thứ hai.
- Nhánh adapter thật của `buildDeps` (vẫn `throw`, xem Câu hỏi mở 4).

## Rủi ro và điểm cần kiểm chứng
- **Cần kiểm chứng: Vitest/Vite resolve `node:sqlite`.** `node:sqlite` là builtin chỉ có dạng tiền tố `node:` (như `node:test`); một số bản Vite/Vitest từng không nhận ra và báo không tìm thấy module. Cách kiểm: bước 1 của kế hoạch là một test chỉ nạp `node:sqlite` và chạy `SELECT sqlite_version()` dưới `pnpm test` và dưới `tsx`. Nếu lỗi: nạp bằng `process.getBuiltinModule("node:sqlite")` (Node ≥ 22.3, đúng cách `diagnose` đang làm) — cách này cũng cần cho AC-14.
- **Cần kiểm chứng: kiểu TS cho `node:sqlite`.** `@types/node` đang là `^22.10`; cần chắc file `sqlite.d.ts` có `DatabaseSync`, `isTransaction` và thuộc tính `errcode`/`errstr` của lỗi. Cách kiểm: `pnpm typecheck` ở bước 1; thiếu thì nâng `@types/node` trong dải 22.x (không nâng lên 24 vì `engines` là `>=22.13`).
- **Node trong container là 22.23** (in `ExperimentalWarning`), máy thật dự kiến ≥ 24.15. API dùng trong spec (`DatabaseSync`, `exec`, `prepare`, `isTransaction`, `errcode`/`errstr`) đã thử chạy trên 22.23. Trên 24.15 cảnh báo có thể không còn; bộ lọc AC-14 vô hại khi không có cảnh báo.
- **Antivirus khoá file.** SQLite trên Windows tự thử lại I/O khi bị chia sẻ/từ chối truy cập tạm thời (cơ chế retry trong `os_win.c`), `busy_timeout` lo khoá giữa các kết nối, AC-11 lo lúc khởi động. Mức đủ hay chưa chỉ biết khi chạy thật; `diagnose` AC-15 là chỗ phát hiện sớm (EPERM/CANTOPEN trong `dataDir`).
- **Cần kiểm chứng: `LOCALAPPDATA` có mặt khi app chạy từ Task Scheduler** (020). Thường có khi task chạy dưới tài khoản người dùng ở chế độ đã đăng nhập. Cách kiểm: thêm vào dòng `[sched]` của `diagnose --scheduler` trạng thái `LOCALAPPDATA set/unset` (không in giá trị). Thiếu thì fallback `<homedir>\AppData\Local` (AC-10) vẫn đúng chỗ.
- **API đồng bộ chặn event loop.** Chấp nhận với dữ liệu nhỏ (ADR-0004). Không đọc/ghi lô lớn trong handler HTTP.
- **Cỡ story.** Phần lõi (mở DB, migration, setting, composition root) là S. Thêm thử lại khi khởi động (AC-11), bộ lọc cảnh báo (AC-14) và `diagnose` (AC-15) đẩy lên gần M. Nếu cần gọn: tách AC-15 thành việc riêng của M0 (Câu hỏi mở 5).

## Câu hỏi mở
- [ ] 1. **DB hỏng khi khởi động:** đề xuất **dừng app** (thoát mã 1, một dòng stderr, giữ nguyên file) như AC-6/ADR-0008. Phương án khác: tự đổi tên thành `app.db.corrupt-<thời điểm>` rồi tạo DB mới để app vẫn chạy (mất setting, cache, job; 005 sẽ coi project như lần đầu, lấy mốc mới, có thể bỏ lỡ thay đổi trong khoảng đó). Chạy nền từ Task Scheduler thì "dừng" nghĩa là người dùng chỉ thấy không có toast, cho tới khi có trang tình trạng/log (009). Bạn chọn dừng (khuyến nghị cho 004, xem lại ở 009) hay tự cách ly?
- [ ] 2. **Chế độ fake dùng SQLite thật `:memory:`** thay vì repository fake trong bộ nhớ (lệch chữ của ADR-0002, lý do trong ADR-0008). Bạn đồng ý để ADR-0008 chuyển sang Accepted?
- [ ] 3. **Giữ bảng `setting` trong 004 dù chưa ai dùng tới 017?** Đề xuất giữ: rất nhỏ, và là bảng thật đầu tiên để kiểm cả đường migration → repository → composition root → reset. Phương án khác: 004 chỉ làm hạ tầng + migration rỗng, `setting` dời sang 017.
- [ ] 4. **Nhánh adapter thật của `buildDeps`:** đề xuất giữ nguyên `throw` trong 004 (chưa có adapter thật nào), `openAppStorage` với `dataDir` được test riêng; story đầu tiên lắp nhánh thật (005) sẽ mở storage ở đó. Hay bạn muốn 004 đã mở DB thật ở nhánh thật trước khi `throw`?
- [ ] 5. **Phần `diagnose` (AC-15) làm trong 004 hay tách** thành việc M0 riêng? Đề xuất làm trong 004 vì là cách duy nhất biết WAL/antivirus trên máy thật ổn trước 005/006, và lần chạy `diagnose` kế tiếp (sau khi nâng Node lên ≥ 24.15) kiểm được luôn.
- [ ] 6. **Tên thư mục dữ liệu** `gh-issue-translator` (theo tên package gốc) — đúng ý bạn? Đổi sau khi đã có dữ liệu trên máy thật sẽ cần chuyển file.

## Kế hoạch implement
(Implementer làm theo thứ tự, mỗi bước một commit `feat(shared): … (004)`; mỗi bước `pnpm test` + `pnpm typecheck` xanh.)
1. **Spike trong repo:** test nạp `node:sqlite` dưới Vitest và `tsx`, kiểm kiểu TS (`DatabaseSync`, `errcode`). Chọn cách nạp (`process.getBuiltinModule` nếu import tĩnh không ổn). Bộ lọc `ExperimentalWarning` của SQLite + AC-14.
2. `resolveDataDir` thuần (AC-10).
3. `StorageError`, `openDatabase` (pragma, `quick_check`, phát hiện hỏng), `transaction(fn)` (AC-6, AC-7, AC-12).
4. Migration: kiểm danh sách file thuần, nạp thư mục `migrations/` (đường dẫn qua `import.meta.url`), runner theo `user_version` (AC-2, AC-3, AC-4, AC-5).
5. `0001-setting.sql`, port `SettingStore`, `SqliteSettingStore` (AC-8, AC-9).
6. `openAppStorage`: tạo `dataDir`, thử lại lỗi tạm thời với hàm chờ tiêm vào (AC-1, AC-11).
7. Composition root + harness: `Deps.settings`, fake dùng `:memory:`, `/__test__/reset` xoá dữ liệu mọi bảng; `main.ts` bắt `StorageError` → một dòng stderr, thoát 1 (AC-13). `smoke.spec.ts` vẫn xanh.
8. `diagnose`: dòng `node:sqlite file` (phần thuần vào `checks.mjs` có test), trạng thái `LOCALAPPDATA` trong `[sched]`; cập nhật bảng đọc kết quả ở `docs/spikes/diagnose.md` (AC-15).
9. Docs: `docs/architecture/testing-harness.md` (reset xoá cả DB `:memory:`; fake dùng SQLite thật). Đề xuất (cần user đồng ý, implementer không tự sửa) thêm vào `CLAUDE.md` mục kiến trúc: `apps/app/src/shared/infrastructure/sqlite` + quy ước migration.

## Workflow log
| Bước | Thời điểm | Kết quả |
|---|---|---|
| 1 Phân tích | 2026-11-27 | Spec draft, ADR-0008 Proposed; chờ user trả lời câu hỏi mở 1–6 |
