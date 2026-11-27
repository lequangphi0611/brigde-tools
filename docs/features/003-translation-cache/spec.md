# 003 — Cache bản dịch theo đoạn (`hash + direction + glossaryVersion`)

- Trạng thái: done
- Context: Translation (`packages/core-translate`: port + decorator; adapter SQLite ở `apps/app`)
- Cần UI: không

## User story
Là người dùng chạy app trên máy có `claude -p` chậm (khoảng 100 giây mỗi lần gọi, xem `docs/spikes/claude-cli-windows.md`), tôi muốn đoạn nào đã dịch rồi (cùng nội dung, cùng chiều dịch, cùng thuật ngữ áp dụng, cùng mẫu dịch và model đã cấu hình) thì lấy lại bản dịch đã lưu thay vì gọi Claude lần nữa, để issue bị sửa hay job chạy lại chỉ tốn thời gian cho phần thật sự mới, và bản dịch còn nguyên sau khi khởi động lại máy.

## Phạm vi của story này (đã chốt ở GATE 1)
- **Có:** khoá cache thuần trong domain `core-translate`; port `TranslationCache`; decorator `CachingTranslator implements Translator` trong `core-translate` (lọc đoạn đã có bản dịch **trước** khi gọi `Translator` bên trong, như ADR-0006 và spec 001 đã định); hàm `claudeCliEngineVersion(configPath)` trong `core-translate` cho biết phiên bản engine (mẫu dịch + model đã cấu hình); `InMemoryTranslationCache` trong `core-translate` (unit test của package, tool dịch chat); bảng `translation` (migration `0002`) + `SqliteTranslationCache` ở app; lắp vào nhánh fake của composition root.
- **Không:** script M1 dịch issue thật (tách thành story **003b**, Câu hỏi 8); hàng đợi, retry, gọi dịch từ poller (006); dịch lại chủ động khi glossary đổi (012 — 003 chỉ đảm bảo glossary đổi thì khoá đổi); xoá/hết hạn cache (Câu hỏi 6); UI.
- Port `Translator` **giữ nguyên chữ ký**. Bên gọi (006, 003b, tool dịch chat) chỉ thấy một `Translator` có cache.
- Luật `core-translate` không import `apps/`: giữ được. Port, decorator, khoá, `claudeCliEngineVersion` và bản in-memory nằm trong package; app chỉ cài adapter SQLite (`implements TranslationCache`, import kiểu từ `@app/core-translate`) — chiều phụ thuộc app → package như hiện tại. `core-translate` không biết SQLite, không biết `Clock` của app.

## Thiết kế (theo các câu trả lời đã chốt)

**Đơn vị cache = một đoạn** (`TranslationSegment`), không phải cả lô/issue. Issue bị sửa hoặc có comment mới thì title/body/comment cũ không đổi; lô gần như không bao giờ lặp lại nguyên vẹn.

**Khoá cache** `TranslationCacheKey` (domain, thuần, `domain/translation-cache-key.ts`):
| Thành phần | Giá trị | Ghi chú |
|---|---|---|
| `sourceHash` | sha256 hex (64 ký tự) của text gốc của đoạn, UTF-8, **không chuẩn hoá** | Khác một byte (kể cả `\r\n` vs `\n`) là khoá khác: an toàn, chỉ tốn thêm một lần dịch |
| `direction` | `"ja-vi"` (từ `Direction`) | |
| `glossaryVersion` | `glossaryVersion(relevantTerms(glossary, [protect(text).masked], direction))` — thuật ngữ liên quan **của riêng đoạn đó** | 002 Câu hỏi 3, ADR-0007. Không có thuật ngữ liên quan → `GLOSSARY_VERSION_EMPTY` |
| `promptVersion` | Hằng tăng tay, vd `CLAUDE_CLI_PROMPT_VERSION = "claude-cli/p1"` đặt cạnh `translation-prompt.ts`; fake dùng `"fake/1"` | Tăng khi đổi system prompt, định dạng stdin, luật che phần giữ nguyên |
| `configuredModel` | Giá trị của cờ `--model` trong `args` của cấu hình Claude CLI, nếu có; không khai báo → `""` | Đổi model trong cấu hình thì cache cũ hết hiệu lực. **Không** hash toàn bộ `args` |

Không vào khoá: `hint`; model thực tế (chỉ biết **sau** khi gọi, runner đọc từ `modelUsage`) — lưu thành cột `model`.

**Phiên bản engine** `EngineVersion = { promptVersion: string; configuredModel: string }`:
- `extractConfiguredModel(args: ReadonlyArray<string>): string` (thuần, `infrastructure/claude-cli/cli-config.ts`): nhận `--model <giá trị>` và `--model=<giá trị>`; tên cờ không phân biệt hoa thường (cùng cách `checkCliConfig` so cờ cấm); nhiều lần → lấy lần **cuối**; giá trị được trim, giữ nguyên hoa thường; không có, hoặc `--model` đứng cuối không có giá trị → `""`.
- `claudeCliEngineVersion(configPath): Promise<EngineVersion>` (`infrastructure/claude-cli/`): gọi `loadCliConfig` (cùng hàm `ClaudeCliTranslator` dùng), trả `{ promptVersion: CLAUDE_CLI_PROMPT_VERSION, configuredModel: extractConfiguredModel(config.args) }`; cấu hình thiếu/sai → ném `TranslationFailure("not_configured")`.
- `CachingTranslator` nhận `engineVersion: () => EngineVersion | Promise<EngineVersion>` từ composition root và gọi **mỗi lần dịch** — vì `ClaudeCliTranslator` đọc lại cấu hình mỗi lần dịch (ADR-0003: sửa không cần restart), khoá cũng phải theo cấu hình hiện tại. Decorator không biết gì về Claude CLI. Fake: `() => ({ promptVersion: "fake/1", configuredModel: "" })`.
- Giới hạn đã biết: model chọn bằng cách khác `--model` (biến môi trường trong `env`, file `--settings`) không vào khoá; alias như `sonnet` có thể trỏ sang model khác khi Claude Code cập nhật mà khoá không đổi. Cột `model` (model thực tế) giữ dấu vết cho 012/009.

**Giá trị lưu** `CachedTranslation`: `text` (bản dịch đã khôi phục phần giữ nguyên, đúng như port trả), `model: string | null` (model thực tế). Adapter SQLite thêm `created_at` (ISO UTC từ `Clock` của app, ADR-0008). **Không lưu text nguồn.**

**Port** (`application/translation-cache.port.ts`, bất đồng bộ):
```ts
interface TranslationCache {
  lookup(keys: ReadonlyArray<TranslationCacheKey>): Promise<ReadonlyMap<string, CachedTranslation>>; // map theo cacheKeyString(key)
  store(entries: ReadonlyArray<{ key: TranslationCacheKey; value: CachedTranslation }>): Promise<void>; // upsert, khoá trùng thì ghi đè
}
```
(Tên/chi tiết do implementer chốt; giữ ngữ nghĩa: tra nhiều khoá một lần, ghi nhiều mục một lần, ghi đè khi trùng.)

**Decorator** `CachingTranslator` (`application/caching-translator.ts`), dựng với `{ inner: Translator, cache: TranslationCache, engineVersion, observer? }`:
1. `assertValidTranslationRequest(request)` **trước mọi thao tác cache** (id rỗng/trùng, glossary sai → `Error` thường, kể cả khi mọi đoạn đều sẽ trúng).
2. Đoạn không có chữ cần dịch (`!hasTranslatableText(protect(text).masked)`) → trả text gốc, không tra, không ghi. Không còn đoạn nào cần dịch → trả ngay, `model = null`, không gọi `engineVersion` hay `inner`.
3. Gọi `engineVersion()`. Lỗi → **không tra, không ghi cache**, chuyển cả yêu cầu cho `inner` (với `ClaudeCliTranslator`, cấu hình hỏng thì `inner` ném `not_configured` như khi không có cache), báo `observer.cacheFailed("engineVersion", error)`.
4. Tính khoá cho từng đoạn, `lookup` một lần. Lỗi khi tra → coi như mọi đoạn trượt, báo `observer.cacheFailed("lookup", error)`.
5. Đoạn trượt: gộp các đoạn **trùng khoá** trong cùng request (giữ id của đoạn xuất hiện đầu tiên). Không còn đoạn trượt → **không gọi `inner`**, `model = null`.
6. Còn đoạn trượt → gọi `inner.translate` **một lần** với `{ direction, segments: các đoạn trượt (đã gộp), context: nguyên context }`; `inner` có thể tự chia lần gọi con như hiện tại.
7. `inner` ném lỗi → ném lại **nguyên đối tượng lỗi**, không ghi gì, không trả kết quả một phần.
8. `inner` thành công → `store` mỗi đoạn đã dịch với khoá đã tính ở bước 4 và `model` của kết quả. Lỗi khi ghi → vẫn trả kết quả, báo `observer.cacheFailed("store", error)`.
9. Trả kết quả đúng tập id, đúng thứ tự request; `model` = `model` của `inner` nếu đã gọi, ngược lại `null`.
10. `observer.lookedUp({ hits, misses })` (số đoạn có chữ cần dịch trúng/trượt, trước khi gộp trùng) — 003b in ra, 009 ghi log. Observer không bao giờ nhận nội dung; lỗi của chính observer bị nuốt.

**Bản in-memory** `InMemoryTranslationCache` (`infrastructure/in-memory-translation-cache.ts`): `Map` trong process. App **không** dùng (ADR-0008: chế độ fake dùng SQLite thật).

**Adapter SQLite** (app): migration `apps/app/src/shared/infrastructure/sqlite/migrations/0002-translation.sql`:
```sql
CREATE TABLE translation (
  source_hash TEXT NOT NULL,
  direction TEXT NOT NULL,
  glossary_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  configured_model TEXT NOT NULL,   -- '' khi cấu hình không khai báo --model
  text TEXT NOT NULL,
  model TEXT,                       -- model thực tế từ output CLI
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_hash, direction, glossary_version, prompt_version, configured_model)
) STRICT, WITHOUT ROWID;
```
`SqliteTranslationCache(db, clock)` ở `apps/app/src/contexts/translation/infrastructure/sqlite-translation-cache.ts`. `store` chạy trong một `db.transaction` với `INSERT … ON CONFLICT (…) DO UPDATE SET text, model, created_at`.

**Composition root**: nhánh fake → `translator = new CachingTranslator({ inner: new FakeTranslator(), cache: new SqliteTranslationCache(storage, clock), engineVersion: () => ({ promptVersion: "fake/1", configuredModel: "" }) })`. `/__test__/reset` đã xoá mọi bảng (`clearAllTables`), không cần route mới. Nhánh thật vẫn `throw` (005 lắp storage thật); khi lắp, dùng `engineVersion: () => claudeCliEngineVersion(configPath)` cùng `configPath` của `ClaudeCliTranslator`.

## Acceptance criteria

```gherkin
Scenario: AC-1 Lần đầu trượt cache thì dịch và lưu; lần hai lấy từ cache, không gọi engine
  Given CachingTranslator bọc một Translator đếm số lần gọi (hoặc ClaudeCliTranslator + fake CLI có record), cache rỗng
  And request ja→vi có title "ログイン不具合" và body "再現手順があります"
  When dịch lần thứ nhất
  Then Translator bên trong được gọi đúng 1 lần với đúng 2 đoạn đó
  And kết quả như khi không có cache ("[vi] " + text với fake)
  When dịch lại đúng request đó (cùng id hoặc id khác, cùng text)
  Then Translator bên trong không được gọi thêm lần nào
  And kết quả có cùng tập id, cùng thứ tự, text giống hệt từng byte lần thứ nhất, và model = null
  And observer nhận lookedUp {hits: 2, misses: 0}

Scenario: AC-2 Trúng một phần thì chỉ gửi phần trượt, trong một lần gọi
  Given cache đã có bản dịch của title "ログイン不具合" và body "再現手順があります"
  When dịch request [title, body, "comment:A" = "確認しました", "comment:B" = "修正してください"]
  Then Translator bên trong được gọi đúng 1 lần, request chỉ có 2 đoạn "comment:A" và "comment:B"
  And kết quả có đủ 4 id theo đúng thứ tự request, title/body lấy từ cache
  And model của kết quả = model của lần gọi bên trong
  And sau đó cache có bản dịch của cả 4 đoạn

Scenario: AC-3 Đoạn không có chữ cần dịch không tra và không ghi cache
  Given request có "body" = "", "c1" = "```\nlog\n```", "c2" = "  \n" và "title" = "課題"
  When dịch
  Then cache chỉ được tra và ghi cho "title"
  And các đoạn còn lại trả nguyên văn (hợp đồng 001 AC-12)
  And request chỉ gồm các đoạn như vậy (hoặc rỗng) → không gọi engineVersion, không gọi Translator bên trong, model = null (hợp đồng 001 AC-13)

Scenario: AC-4 Khoá phân biệt text, chiều dịch, phiên bản mẫu dịch
  Given cache có bản dịch ja→vi của "確認しました" với promptVersion "claude-cli/p1", configuredModel "sonnet"
  Then dịch "確認しました。" (thêm một ký tự), hoặc text nhiều dòng đổi "\n" thành "\r\n", là trượt
  And tra cùng text với chiều vi→ja là trượt (unit trên khoá; MVP chỉ dùng ja→vi)
  And engineVersion trả promptVersion "claude-cli/p2" thì trượt
  And hai khoá chỉ khác một thành phần bất kỳ cho cacheKeyString khác nhau

Scenario: AC-5 Khoá phân biệt model đã cấu hình
  Given đoạn "確認しました" đã được dịch và lưu khi engineVersion trả configuredModel "sonnet"
  When engineVersion trả configuredModel "opus" (cùng promptVersion)
  Then đoạn trượt và được gửi cho Translator bên trong
  And khi configuredModel là "" (cấu hình không khai báo --model) thì cũng trượt so với "sonnet", và "" trúng "" ở lần sau
  And CachingTranslator gọi engineVersion ở mỗi lần dịch (đổi giá trị giữa hai lần dịch trên cùng một instance có hiệu lực ngay)

Scenario: AC-6 Lấy model đã cấu hình từ args của cấu hình Claude CLI
  Then extractConfiguredModel(["--model", "sonnet", "--settings", "C:\\s.json"]) = "sonnet"
  And extractConfiguredModel(["--model=opus"]) = "opus" và extractConfiguredModel(["--MODEL", " opus "]) = "opus"
  And extractConfiguredModel(["--model", "a", "--model=b"]) = "b" (lần cuối thắng)
  And extractConfiguredModel([]) = "", extractConfiguredModel(["--settings", "x"]) = "", extractConfiguredModel(["--model"]) = ""
  And đổi các args khác (vd đường dẫn --settings) không đổi kết quả
  And claudeCliEngineVersion(configPath) với file cấu hình hợp lệ trả {promptVersion: CLAUDE_CLI_PROMPT_VERSION, configuredModel: giá trị trên}
  And sửa file cấu hình giữa hai lần gọi thì lần gọi sau trả giá trị mới
  And file cấu hình thiếu/sai → ném TranslationFailure("not_configured")

Scenario: AC-7 glossaryVersion tính theo thuật ngữ liên quan của từng đoạn
  Given đoạn A "課題を確認" và đoạn B "よろしく" đã được dịch và lưu với glossary [{課題, issue}]
  When dịch lại A và B với glossary [{課題, issue}, {納品, bàn giao}] (thêm thuật ngữ không xuất hiện trong A, B)
  Then cả hai trúng cache
  When dịch lại với glossary [{課題, ticket}] (đổi vi của thuật ngữ có trong A)
  Then A trượt và được dịch lại; B vẫn trúng
  And khi "課題" chỉ nằm trong code block / inline code của đoạn thì đổi thuật ngữ đó không làm đoạn trượt
  And glossary viết khác dạng full/half-width hoặc khác thứ tự nhưng cùng nội dung chuẩn hoá cho cùng khoá

Scenario: AC-8 hint không ảnh hưởng tới khoá
  Given đoạn "確認しました" đã được dịch và lưu với hint "プロジェクトA"
  When dịch lại với hint "プロジェクトB" hoặc không có hint
  Then trúng cache, Translator bên trong không được gọi

Scenario: AC-9 Đoạn trùng text trong cùng request chỉ gửi một lần
  Given cache rỗng, request có "comment:A" = "了解です", "comment:B" = "了解です" và "title" = "課題"
  When dịch
  Then Translator bên trong nhận đúng 2 đoạn (một đoạn "了解です" và "title")
  And kết quả có đủ 3 id, "comment:A" và "comment:B" cùng bản dịch

Scenario: AC-10 Translator bên trong lỗi thì không ghi gì và ném nguyên lỗi
  Given cache có title, Translator bên trong ném TranslationFailure("timeout") cho phần trượt
  When dịch request [title, body]
  Then CachingTranslator ném đúng đối tượng TranslationFailure đó (reason "timeout", detail, stderrTail giữ nguyên)
  And không có mục mới nào trong cache; không có kết quả một phần
  When dịch lại sau khi Translator bên trong hết lỗi
  Then body được gửi lại và lưu

Scenario: AC-11 Lỗi cache hoặc lỗi engineVersion không làm hỏng việc dịch
  Given cache ném lỗi (hoặc reject) khi lookup
  When dịch request 2 đoạn
  Then mọi đoạn được gửi cho Translator bên trong, kết quả trả về bình thường, observer nhận cacheFailed("lookup", lỗi)
  Given cache ném lỗi khi store
  When dịch
  Then kết quả vẫn trả về đúng, observer nhận cacheFailed("store", lỗi)
  Given engineVersion ném lỗi (vd TranslationFailure("not_configured"))
  When dịch
  Then cache không được tra hay ghi, cả yêu cầu được chuyển cho Translator bên trong, observer nhận cacheFailed("engineVersion", lỗi)
  And Translator bên trong ném not_configured thì CachingTranslator ném lại đúng lỗi đó
  And observer tự ném lỗi cũng không làm hỏng kết quả

Scenario: AC-12 Request sai bị từ chối trước khi chạm cache
  Given request có id trùng/rỗng, hoặc context.glossary trùng termKey / vi rỗng
  When CachingTranslator dịch (kể cả khi mọi đoạn đều đã có trong cache)
  Then ném Error thường (không phải TranslationFailure)
  And engineVersion không được gọi, cache không được tra hay ghi, Translator bên trong không được gọi

Scenario: AC-13 CachingTranslator thoả hợp đồng Translator chung
  Given CachingTranslator(FakeTranslator, InMemoryTranslationCache) và CachingTranslator(ClaudeCliTranslator + fake CLI, InMemoryTranslationCache, claudeCliEngineVersion cùng configPath)
  Then cả hai qua runTranslatorContract (001 AC-1, AC-12, AC-13, AC-14; 002 AC-5, AC-14)

Scenario: AC-14 Hợp đồng TranslationCache chung cho bản in-memory và SQLite
  Given InMemoryTranslationCache và SqliteTranslationCache trên SQLite ":memory:" đã migrate
  Then lookup khoá chưa có trả map rỗng
  And store rồi lookup trả đúng text và model; text có tiếng Nhật, tiếng Việt có dấu, emoji, "\r\n", "⟦1⟧", và một chuỗi dài 100 000 ký tự đều giữ nguyên từng byte
  And store lại cùng khoá với text khác thì lookup trả text mới (ghi đè)
  And model null được lưu và đọc lại là null
  And configuredModel "" và "sonnet" là hai khoá khác nhau
  And lookup nhiều khoá một lần chỉ trả các khoá có

Scenario: AC-15 Bảng translation: migration, created_at từ Clock, bền qua khởi động lại, reset xoá
  Given app storage mở trên file trong thư mục tạm
  Then schemaVersion = 2 và bảng translation có đúng các cột của thiết kế, không có cột chứa text nguồn
  And mục được store khi ControllableClock = "2026-03-01T08:00:00Z" có created_at = "2026-03-01T08:00:00.000Z"
  And đóng rồi mở lại DB, lookup vẫn trả mục đó
  And clearAllTables (dùng bởi /__test__/reset) xoá hết hàng của translation

Scenario: AC-16 Chế độ fake lắp cache SQLite, hành vi người dùng không đổi
  Given buildDeps("fake")
  Then deps.translator dịch "ログイン" thành "[vi] ログイン"; dịch lần hai cho cùng kết quả và bảng translation có 1 hàng
  And e2e smoke hiện có vẫn xanh
```

| AC | Khoá bằng | File |
|---|---|---|
| AC-4, AC-5, AC-7, AC-8 (phần khoá thuần) | unit | `packages/core-translate/src/domain/translation-cache-key.test.ts` |
| AC-1 … AC-5, AC-7 … AC-12 | unit (Translator đếm lần gọi + `InMemoryTranslationCache` / cache giả ném lỗi / `engineVersion` giả) | `packages/core-translate/src/application/caching-translator.test.ts` |
| AC-6 | unit (thuần + đọc file cấu hình tạm) | `packages/core-translate/src/infrastructure/claude-cli/cli-config.test.ts` (tạo mới nếu chưa có) |
| AC-1, AC-2, AC-5 (đầu-cuối với adapter thật: sửa `--model` trong file cấu hình tạm, đếm record fake CLI) | adapter test, Vitest + `fake-claude-cli.mjs` | `packages/core-translate/src/infrastructure/claude-cli/caching-claude-cli.test.ts` |
| AC-13 | unit (hợp đồng chung) | `packages/core-translate/src/application/translator.contract.ts`, gọi từ `caching-translator.test.ts` và `caching-claude-cli.test.ts` |
| AC-14 | unit (hợp đồng chung) | `packages/core-translate/src/application/translation-cache.contract.ts`, gọi từ `in-memory-translation-cache.test.ts` và `apps/app/src/contexts/translation/infrastructure/sqlite-translation-cache.test.ts` |
| AC-15 | unit (SQLite thật) | `apps/app/src/contexts/translation/infrastructure/sqlite-translation-cache.test.ts`, `apps/app/src/shared/infrastructure/sqlite/migrations.test.ts`, `apps/app/src/test-harness/clear-storage.test.ts` |
| AC-16 | unit | `apps/app/src/composition-root.test.ts` |

**E2E: không áp dụng — bỏ bước 3 (đã chốt, Câu hỏi 7).** Lý do: story không có hành vi người dùng thấy được qua UI. App chưa có chỗ nào gọi `Translator` (005/006/008 chưa có), và trong e2e `FakeTranslator` cho kết quả xác định nên trúng hay trượt cache hiện ra cùng một chữ trên màn hình. Không thêm file vào `e2e/specs/`, không re-lock; `pnpm verify` vẫn chạy e2e smoke (AC-16 đảm bảo smoke không vỡ). Khi cache có hệ quả người dùng thấy được (006 không gọi engine cho comment cũ, 012 dịch lại sau khi đổi glossary), story đó thêm năng lực harness quan sát số lần gọi translator (vd `GET /__test__/translator/calls`) và khoá bằng e2e.

**Ghi chú cho test:** `fake-claude-cli.mjs` không cần đổi; đếm số lần gọi bằng record có sẵn (cờ `--model` trong `args` được truyền qua như các cờ khác). Cache giả ném lỗi cho AC-11 viết ngay trong test, không export. Hợp đồng `translation-cache.contract.ts` cần import được từ test của app: package hiện chỉ export `"."`; implementer chọn thêm subpath export (vd `"./testing"`) hoặc import đường dẫn tương đối trong monorepo — ghi lựa chọn vào commit.

## Tác động domain
- Thuật ngữ mới (→ `ubiquitous-language.md`): `TranslationCache`, `TranslationCacheKey` (`sourceHash`, `direction`, `glossaryVersion`, `promptVersion`, `configuredModel`), `promptVersion` (phiên bản mẫu dịch), `configuredModel` (model đã cấu hình), `EngineVersion`, `CachingTranslator`; làm rõ `Translation` và chốt `glossaryVersion` theo đoạn.
- Aggregate / invariant / event thay đổi: entity `Translation` — khoá `TranslationCacheKey`; thuộc tính `text`, `model` (thực tế), `createdAt`. Invariant: không gọi engine cho đoạn đã có `Translation` cùng khoá; không ghi `Translation` nào khi lần dịch lỗi; lỗi cache hoặc lỗi lấy phiên bản engine không làm lần dịch lỗi. Không có event mới.
- Port mới hoặc đổi: `TranslationCache` (mới, trong `core-translate`). `Translator` giữ nguyên chữ ký. Export mới từ `index.ts`: `CachingTranslator`, `TranslationCache`, `TranslationCacheKey`, `CachedTranslation`, `EngineVersion`, `translationCacheKey`, `cacheKeyString`, `InMemoryTranslationCache`, `CLAUDE_CLI_PROMPT_VERSION`, `claudeCliEngineVersion`, `extractConfiguredModel`.
- ADR: `docs/architecture/adr/0009-translation-cache.md` (Proposed; chuyển Accepted khi xong story).

## UI (nếu có)
Không có.

## Ngoài phạm vi
- Script M1 dịch title + body một issue thật trên Windows, chạy lần hai lấy từ cache: story **003b** (roadmap M1).
- Xoá, hết hạn, giới hạn kích thước cache; lệnh dọn cache: để sau khi 009 có số liệu.
- Bỏ qua cache để dịch lại cùng khoá ("dịch lại" khi bản dịch kém): 012. `store` ghi đè nên 012 chỉ cần tuỳ chọn bỏ qua `lookup`.
- Model chọn qua `env`/file `--settings` thay vì `--model`: không vào khoá (xem Rủi ro).
- Cache từng **lần gọi con** trong `ClaudeCliTranslator` (issue rất dài bị chia N lần gọi, lần thứ k lỗi thì các lần trước bị bỏ).
- Hàng đợi, song song, retry (006). Hai job song song cùng trượt một khoá thì cả hai dịch, mục ghi sau thắng — chấp nhận.
- Lắp storage thật và `ClaudeCliTranslator` vào nhánh adapter thật của composition root (005/006).
- Ghi log lỗi cache ra file (009): 003 chỉ cung cấp `observer`.

## Rủi ro / phản biện
- **`promptVersion` tăng tay:** quên tăng khi đổi prompt/luật che thì cache cũ được dùng âm thầm. Đặt hằng cạnh `translationSystemPrompt`, reviewer kiểm; implementer có thể thêm test snapshot system prompt + stdin mẫu để buộc đổi hằng (không bắt buộc).
- **`configuredModel` chỉ theo cờ `--model`:** model đặt qua `env` hoặc file settings không vào khoá; alias (`sonnet`) có thể trỏ sang model mới khi Claude Code cập nhật mà khoá không đổi. Cột `model` (thực tế) giữ dấu vết.
- **Thuật ngữ liên quan theo đoạn vs theo lô:** prompt của một lần gọi mang thuật ngữ của cả lô, khoá chỉ tính thuật ngữ của đoạn. Chấp nhận.
- **`hint` không vào khoá:** cùng câu ở hai project có ngữ cảnh khác nhau dùng chung bản dịch.
- **Bản dịch kém bị giữ** cho tới khi glossary liên quan đổi, `promptVersion`/`configuredModel` đổi, hoặc 012.
- **Dung lượng:** chưa có số liệu; bản dịch cũ của đoạn đã sửa không bị xoá nên bảng chỉ tăng.
- **Đọc cấu hình hai lần mỗi lần dịch** (`claudeCliEngineVersion` và `ClaudeCliTranslator`): một file JSON nhỏ, không đáng kể so với ~100 giây mỗi lần gọi; sửa cấu hình đúng lúc giữa hai lần đọc có thể làm một lần dịch lưu với `configuredModel` cũ — chấp nhận.

## Câu hỏi mở
(Đã chốt ở GATE 1, 2026-11-27: user đồng ý toàn bộ khuyến nghị, có điều chỉnh câu 3 và câu 8.)
- [x] 1. **Đơn vị cache?** **Chốt: từng đoạn**; trúng một phần thì chỉ gửi đoạn trượt trong một lần gọi (AC-2).
- [x] 2. **`glossaryVersion` theo đoạn hay cả glossary?** **Chốt: hash thuật ngữ liên quan của từng đoạn** (AC-7).
- [x] 3. **Phiên bản prompt/model trong khoá?** **Chốt: khoá có `promptVersion` (hằng tăng tay) và `configuredModel`** = giá trị `--model` trong `args` của cấu hình Claude CLI nếu có, không khai báo thì `""`; đổi model trong cấu hình thì cache cũ hết hiệu lực. Không hash toàn bộ `args`. Model thực tế (từ `modelUsage`) vẫn lưu thành cột. Cách lấy: `CachingTranslator` nhận `engineVersion` từ composition root, adapter thật dùng `claudeCliEngineVersion(configPath)` đọc lại cấu hình mỗi lần dịch (AC-5, AC-6).
- [x] 4. **`hint` vào khoá?** **Chốt: không** (AC-8).
- [x] 5. **Lưu text nguồn?** **Chốt: không**, chỉ `sourceHash` (AC-15).
- [x] 6. **Xoá/hết hạn/giới hạn kích thước?** **Chốt: không làm ở 003**, để sau 009; lưu `created_at`, không có `last_used_at`.
- [x] 7. **Bỏ bước e2e?** **Chốt: bỏ**, lý do ở mục E2E; giữ lắp cache vào nhánh fake (AC-16).
- [x] 8. **Script M1 thuộc 003?** **Chốt: tách thành story 003b** (roadmap M1), 003 không có script.
- [x] 9. **Adapter SQLite đặt ở đâu?** **Chốt: `apps/app/src/contexts/translation/infrastructure/`.**
- [x] 10. **Port đồng bộ hay bất đồng bộ?** **Chốt: bất đồng bộ.**

## Kế hoạch implement
(Implementer làm theo thứ tự, mỗi bước một commit.)
1. **Domain: khoá cache.** `packages/core-translate/src/domain/translation-cache-key.ts`: kiểu `TranslationCacheKey`, `EngineVersion`, `translationCacheKey(text, direction, glossary, engineVersion)` (sha256 bằng `node:crypto` như `glossaryVersion`; `relevantTerms` trên `protect(text).masked`), `cacheKeyString(key)` không nhập nhằng (vd `JSON.stringify` của mảng thành phần). Test phần thuần AC-4, AC-5, AC-7, AC-8. Kiểm chứng: `pnpm test packages/core-translate/src/domain/translation-cache-key.test.ts`.
2. **Infrastructure CLI: model đã cấu hình.** `extractConfiguredModel(args)` trong `cli-config.ts`; `CLAUDE_CLI_PROMPT_VERSION` cạnh `translation-prompt.ts`; `claudeCliEngineVersion(configPath)`. Test AC-6. Kiểm chứng: `pnpm test packages/core-translate/src/infrastructure/claude-cli`.
3. **Application: port + hợp đồng + in-memory.** `application/translation-cache.port.ts`, `application/translation-cache.contract.ts` (AC-14), `infrastructure/in-memory-translation-cache.ts` + test chạy hợp đồng. Kiểm chứng: `pnpm test packages/core-translate`.
4. **Application: `CachingTranslator`.** `application/caching-translator.ts` theo 10 bước của thiết kế. Test AC-1…AC-5, AC-7…AC-12 với Translator đếm lần gọi và `engineVersion` giả; `runTranslatorContract` cho `CachingTranslator(FakeTranslator)` (AC-13). Export mới từ `index.ts`. Kiểm chứng: `pnpm typecheck && pnpm test`.
5. **Đầu-cuối với adapter thật trong package.** `caching-claude-cli.test.ts`: AC-1, AC-2, AC-5 (sửa `--model` trong file cấu hình tạm) và AC-13 với `ClaudeCliTranslator` + `fake-claude-cli.mjs`. Kiểm chứng: `pnpm test packages/core-translate/src/infrastructure/claude-cli`.
6. **Infrastructure app: migration + adapter SQLite.** `migrations/0002-translation.sql`; `apps/app/src/contexts/translation/infrastructure/sqlite-translation-cache.ts` (`lookup`, `store` trong `db.transaction`, `created_at` từ `Clock`); test chạy hợp đồng AC-14 + AC-15; cập nhật test migration (schemaVersion = 2) và `clear-storage.test.ts`. Kiểm chứng: `pnpm test apps/app/src`.
7. **Composition root.** Nhánh fake bọc `FakeTranslator` bằng `CachingTranslator` + `SqliteTranslationCache(storage, clock)`, `engineVersion` cố định `{ "fake/1", "" }`. Test AC-16. Kiểm chứng: `pnpm verify` (e2e smoke xanh, lock không đổi).
8. **Docs.** ADR-0009 → Accepted; đánh ✅ 003 trong roadmap.

## Workflow log
| Bước | Thời điểm | Kết quả |
|---|---|---|
| 1 Phân tích | 2026-11-27 | Spec draft, 14 AC (unit/integration, không e2e), 10 câu hỏi mở. Cập nhật ubiquitous-language, bounded-contexts/translation; ADR-0009 nháp (Proposed) |
| GATE 1 | 2026-11-27 | User duyệt, chốt 10 câu hỏi theo khuyến nghị, điều chỉnh: khoá thêm `configuredModel` (cờ `--model` trong cấu hình CLI); script M1 tách thành story 003b. Spec còn 16 AC. Trạng thái approved |
| 2 Design | 2026-11-27 | Bỏ qua (Cần UI: không) |
| 3 Khoá hành vi | 2026-11-27 | Bỏ qua theo Câu hỏi 7: không có hành vi người dùng thấy được qua UI (app chưa gọi `Translator`, `FakeTranslator` xác định nên cache không đổi gì trên màn hình); khoá bằng unit/integration, e2e smoke giữ xanh (AC-16). Khoá e2e ở 006/012 |
| 4 Implement (lượt 1) | 2026-11-27 | Xong bước 1–4 của kế hoạch trong `packages/core-translate`: khoá cache, `extractConfiguredModel`/`CLAUDE_CLI_PROMPT_VERSION`/`claudeCliEngineVersion`, port + hợp đồng + `InMemoryTranslationCache`, `CachingTranslator` (+ `runTranslatorContract` với FakeTranslator). Còn bước 5–8 (adapter thật trong package, SQLite, composition root, docs); chưa chọn subpath export cho `translation-cache.contract.ts` (quyết ở bước 6) |
| 4 Implement (lượt 2) | 2026-11-27 | Xong bước 5–7: `caching-claude-cli.test.ts` (AC-1/2/5/13 với fake CLI), migration `0002-translation.sql` + `SqliteTranslationCache` + test AC-14/AC-15, composition root fake lắp `CachingTranslator(FakeTranslator)` + cache SQLite (AC-16). Lựa chọn: chưa có tiền lệ import hợp đồng test giữa package → thêm subpath export `@app/core-translate/testing` (`packages/core-translate/src/testing.ts`, xuất `runTranslationCacheContract`, `runTranslatorContract`). Nhánh adapter thật của composition root giữ nguyên `throw` (spec để cho 005). Còn bước 8 (docs) |
| 5 Verify | 2026-11-27 | Orchestrator tự chạy `pnpm verify`: xanh (typecheck, 301 unit, e2e lock OK, e2e smoke 1 passed) |
| 6 Review | 2026-11-27 | APPROVE, không must-fix. should-fix: bước 8 docs. 5 nit chờ user chọn |
| 7 PR | 2026-11-27 | Spec done, roadmap ✅ 003. Chờ GATE 4 (ADR-0009 Accepted, nit, push) |
