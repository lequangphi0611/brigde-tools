# 003b — Script dịch title + body của một issue thật (`translate-issue`)

- Trạng thái: done
- Context: Translation (dùng `ClaudeCliTranslator` + `CachingTranslator` của `core-translate`; `SqliteTranslationCache` + `dataDir` của app). Lệnh vận hành, không có UI web.
- Cần UI: không

## User story
Là người dùng có máy công ty chạy được `claude -p` nhưng chưa có poller (005), tôi muốn đưa một file JSON issue do tôi tự xuất bằng `gh` cho một lệnh, nhận bản dịch tiếng Việt của title + body trên màn hình, và chạy lại lần hai thì lấy từ cache. Tôi gõ lại được dòng trạng thái của lệnh cho Claude vì dòng đó không chứa dữ liệu công ty. Như vậy tôi kiểm được toàn bộ lõi dịch M1 (001 + 003 + 004) trên Windows thật mà không mang dữ liệu ra ngoài.

## Phạm vi
- **Có:** một lệnh `pnpm translate-issue <file.json> [--config <path>] [--out <file>]`. Lệnh đọc file JSON (`gh issue view <số> --repo <owner/repo> --json title,body`), dịch ja→vi qua `CachingTranslator(ClaudeCliTranslator)` với cache `SqliteTranslationCache` trên `<dataDir>/app.db` (file DB thật của app, ADR-0008), in bản dịch rồi in **một** dòng trạng thái cuối cùng, chỉ chứa mã, số đếm và thời gian. Có thêm một hàm dựng `Translator` thật trong `composition-root.ts` để 005/006 dùng lại.
- **Không:** gọi `gh`. Comment. Glossary (đã chốt: `glossary: []`, nguồn thật ở 015). Hint. Hàng đợi, retry (006). Lắp nhánh adapter thật cho server (005). Dọn thư mục `ghit-ai-*` (chỉ đếm, xem bên dưới). UI.

## Thiết kế

### Cách gọi
```
pnpm translate-issue <file.json> [--config <path>] [--out <file>]
pnpm translate-issue --help
```
- `<file.json>` là đường dẫn tuyệt đối hoặc tương đối. Đường dẫn tương đối tính theo **thư mục người dùng đứng khi gõ lệnh**, không theo thư mục mà pnpm chuyển vào: `pnpm --filter` chạy trong `apps/app`, nhưng biến `INIT_CWD` vẫn giữ thư mục gốc. **Cách chạy đã chốt:** root script `translate-issue` = `tsx apps/app/src/cli/translate-issue/main.ts` (không dùng `pnpm --filter`, vì pnpm lồng ghi đè `INIT_CWD` thành thư mục gốc repo; `tsx` là devDependency của root). Người dùng gõ `pnpm -s translate-issue …` để pnpm không in banner `> …` (chứa đường dẫn tuyệt đối và argv) ra stdout. Một `--` đứng riêng trong argv bị bỏ qua, vì tuỳ phiên bản pnpm có thể chuyển nó tiếp vào script (Cần kiểm chứng trên pnpm 10.28 của máy thật).
- `--config` mặc định là `<repo>/config/claude-cli.local.json`, trùng mặc định của `diagnose`, nên file đã chạy được ở M0 dùng được luôn (đã chốt ở GATE 1).
- `--out <file>`: ghi bản dịch ra file UTF-8 có BOM (Notepad và `Get-Content` của PowerShell 5.1 đọc đúng). Khi đó stdout chỉ còn dòng trạng thái. File đã có thì ghi đè.
- Lệnh luôn dùng adapter thật, không đọc `APP_ADAPTERS`. Test thay Claude CLI bằng cách trỏ `--config` tới file cấu hình gọi `fake-claude-cli.mjs` (giống `caching-claude-cli.test.ts`).

### Đầu vào
- Byte của file được giải mã theo BOM: UTF-8 không BOM, UTF-8 có BOM (`Out-File -Encoding utf8` của PowerShell 5.1) và UTF-16LE có BOM (`>` của PowerShell 5.1) đều nhận. UTF-16BE, UTF-8 sai byte (giải mã `fatal`) → `input_encoding`.
- JSON phải là object có `title: string` và `body: string`. Chuỗi rỗng hợp lệ. Trường khác bị bỏ qua (người dùng có thể xuất thêm `number,url`). Mảng, thiếu trường hoặc sai kiểu → `input_bad_shape`.
- Đoạn dịch: `{ id: "title", text: title }`, `{ id: "body", text: body }`, `direction` ja→vi, `context = { glossary: [] }`, không có hint. Text giữ nguyên từng byte, không chuẩn hoá `\r\n`, để lần chạy sau ra cùng `sourceHash`.
- **Cảnh báo encoding (Cần kiểm chứng):** trong PowerShell 5.1, output của lệnh native khi đi qua `>` hoặc `|` bị giải mã bằng `[Console]::OutputEncoding` (thường là code page OEM). Nếu vậy thì tiếng Nhật đã hỏng thành `?` **trước** khi vào file, và script không cứu được. Hướng dẫn dùng ghi xuất qua `cmd /c "gh issue view <số> --repo <owner/repo> --json title,body > issue.json"`, vì redirect của cmd giữ nguyên byte. Script báo hai trường `enc=` và `jaChars=` để phát hiện trường hợp này: `jaChars=0` với một issue tiếng Nhật nghĩa là file đã hỏng. Cách kiểm chứng: xuất cùng một issue bằng `>` của PowerShell và bằng `cmd /c`, chạy script với từng file rồi so `enc` và `jaChars`.

### Xử lý
1. Phân tích argv → đọc và giải mã file → parse JSON. Lỗi ở bước này thì dừng ngay: không mở DB, không đọc cấu hình CLI.
2. `resolveDataDir(process.env, process.platform, os.homedir())` → `openAppStorage({ path: <dataDir>/app.db })`. Lỗi (`APP_DATA_DIR` tương đối, `StorageError`) → dừng, không dịch.
3. Dựng translator qua hàm mới trong `composition-root.ts`, ví dụ `buildRealTranslator({ configPath, storage, clock: systemClock, observer })`, trả về `CachingTranslator({ inner, cache: new SqliteTranslationCache(storage, clock), engineVersion: () => claudeCliEngineVersion(configPath), observer })`. Script bọc `inner = ClaudeCliTranslator(configPath)` bằng một bộ đếm số lần gọi `inner.translate` để biết `engine=called|skipped` (nếu cần thì hàm nhận thêm tham số bọc `inner`). Đây vẫn là nơi duy nhất chọn adapter; 005 lắp nhánh thật bằng chính hàm này.
4. Gọi `translate` một lần. Đo thời gian bằng đồng hồ đơn điệu (`performance.now()`). `created_at` của cache vẫn lấy từ `Clock` (ADR-0008).
5. In bản dịch (ra stdout, hoặc ra file nếu có `--out`), rồi in dòng trạng thái làm dòng **cuối cùng** của stdout. Đóng DB.

### Bản dịch trên màn hình
```
=== title ===
<bản dịch title>
=== body ===
<bản dịch body>
```
Đoạn không có chữ cần dịch (rỗng, chỉ có code) thì in nguyên văn, như port trả về.

### Dòng trạng thái: hợp đồng chống lộ dữ liệu
Một dòng, ASCII, dạng `translate-issue <OK|FAIL> [<mã>] key=value ...`. Thứ tự key cố định, key nào chưa biết thì bỏ:

| Key | Giá trị | Ghi chú |
|---|---|---|
| `enc` | `utf8` / `utf8-bom` / `utf16le-bom` | |
| `jaChars` | số ký tự kana/kanji trong title + body | 0 với issue tiếng Nhật → file đã hỏng encoding |
| `srcChars` | tổng độ dài (code unit) của các đoạn có chữ cần dịch | để so thời gian với độ dài |
| `segments` | số đoạn có chữ cần dịch (0–2) | |
| `hits` / `misses` | từ `observer.lookedUp` | không gọi tới bước tra cache thì không in |
| `engine` | `called` / `skipped` | theo bộ đếm `inner.translate` |
| `ms` | thời gian dịch, số nguyên | |
| `cache` | `ok` / `warn:<stage>[/sqlite=<errcode>]` | stage = `engineVersion` / `lookup` / `store` |
| `data` | `APP_DATA_DIR` / `LOCALAPPDATA` / `XDG_DATA_HOME` / `fallback` | nguồn của `dataDir`, **không** in đường dẫn (cùng cách `diagnose`) |
| `tmpLeft` | số thư mục `ghit-ai-*` đang có trong `os.tmpdir()` sau khi chạy | theo dõi EPERM của spike Lần 4; chỉ đếm, không xoá |

Mã lỗi (`FAIL <mã>`):
| Mã | Exit | Khi nào |
|---|---|---|
| `usage` | 2 | Thiếu file, tuỳ chọn lạ, thiếu giá trị của `--config`/`--out` |
| `input_not_found` / `input_unreadable` | 2 | Không mở hoặc không đọc được file (kèm `code=<ENOENT…>`) |
| `input_encoding` / `input_not_json` / `input_bad_shape` | 2 | Như mục Đầu vào |
| `data_dir_invalid` | 2 | `resolveDataDir` ném lỗi (`APP_DATA_DIR` tương đối) |
| `storage:<reason>` | 1 | `StorageError` (kèm `migration=`, `sqlite=` nếu có) |
| `translate:<reason>` | 1 | `TranslationFailure` (kèm `detail=` chỉ khi detail khớp `^[a-z_]+$`) |
| `output_write` | 1 | Không ghi được file `--out` (kèm `code=`). Bản dịch đã vào cache, chạy lại sẽ trúng |
| `internal` | 1 | Lỗi khác; chỉ in `error.name` |

**Không bao giờ xuất hiện trong dòng trạng thái**, ở mọi nhánh kể cả lỗi: nội dung title/body, đường dẫn (file vào, `--out`, `--config`, `dataDir`), `os.hostname()`, `error.message` (thông báo của `JSON.parse` trong V8 có trích một đoạn input), `stderrTail` của Claude CLI, tên model (model custom của gateway công ty có thể là tên nội bộ). Mọi giá trị đều là mã từ danh sách cố định, số, hoặc `code` của lỗi Node/SQLite.

Stderr có thể có `ExperimentalWarning` của `node:sqlite` khi chạy trên Node < 24.15 (máy thật đang là v24.9.0). Dòng đó không chứa dữ liệu và được chấp nhận; tắt nó không thuộc story này.

## Acceptance criteria

```gherkin
Scenario: AC-1 Lần đầu gọi engine, lần hai lấy từ cache (tiêu chí xong M1)
  Given APP_DATA_DIR là thư mục tạm rỗng, cấu hình CLI trỏ tới fake-claude-cli.mjs có --fake-record
  And file issue.json = {"title":"ログイン不具合","body":"再現手順があります","number":12}
  When chạy translate-issue issue.json
  Then exit 0, fake CLI được gọi đúng 1 lần
  And stdout có "=== title ===" rồi "[vi] ログイン不具合", "=== body ===" rồi "[vi] 再現手順があります"
  And dòng cuối stdout khớp "translate-issue OK enc=utf8 jaChars=\d+ srcChars=\d+ segments=2 hits=0 misses=2 engine=called ms=\d+ cache=ok data=APP_DATA_DIR tmpLeft=\d+"
  When chạy lại đúng lệnh đó trong một process mới
  Then exit 0, fake CLI vẫn chỉ được gọi tổng cộng 1 lần
  And phần bản dịch trên stdout giống hệt lần đầu từng byte
  And dòng cuối có "segments=2 hits=2 misses=0 engine=skipped"
  And file <APP_DATA_DIR>/app.db tồn tại, bảng translation có 2 hàng

Scenario: AC-2 Body đổi thì chỉ dịch lại body
  Given đã chạy AC-1 lần đầu
  When chạy với file có cùng title và body "再現手順を更新しました"
  Then fake CLI được gọi thêm đúng 1 lần, stdin của lần đó chứa body mới và không chứa "ログイン不具合"
  And dòng cuối có "hits=1 misses=1 engine=called"

Scenario: AC-3 Đoạn không có chữ cần dịch (một test)
  Given file {"title":"課題","body":""}
  Then exit 0, body in nguyên văn (rỗng), dòng cuối có "segments=1"
  Given file {"title":"","body":"```\nlog\n```"}
  Then exit 0, không gọi fake CLI, text in nguyên văn, dòng cuối có "segments=0 engine=skipped"

Scenario: AC-4 Giữ nguyên code block, inline code, link, @mention
  Given body "手順:\n```ts\nconst a = 1;\n```\n`npm ci` を実行。詳細は [資料](https://example.com/a) を参照 @tanaka\r\n以上"
  When dịch
  Then bản dịch body còn nguyên từng byte "```ts\nconst a = 1;\n```", "`npm ci`", "(https://example.com/a)", "@tanaka" và "\r\n"

Scenario: AC-5 Nhận các encoding PowerShell/cmd sinh ra
  Given cùng nội dung JSON được ghi dạng UTF-8, UTF-8 có BOM, UTF-16LE có BOM
  Then cả ba cho cùng bản dịch, dòng cuối có lần lượt "enc=utf8", "enc=utf8-bom", "enc=utf16le-bom"
  And lần chạy thứ hai và thứ ba trúng cache (cùng sourceHash)
  Given file có BOM UTF-16BE, hoặc chuỗi byte UTF-8 không hợp lệ
  Then exit 2, dòng cuối "translate-issue FAIL input_encoding", không mở DB (APP_DATA_DIR vẫn rỗng)

Scenario: AC-6 Phát hiện file đã hỏng tiếng Nhật
  Given file {"title":"???????","body":"??? ??"} (mô phỏng gh qua `>` của PowerShell 5.1)
  Then dòng cuối có "jaChars=0"

Scenario: AC-7 Đầu vào sai bị từ chối trước khi chạm DB và Claude CLI
  Then không có đối số → exit 2, "translate-issue FAIL usage", stdout/stderr có cách dùng
  And --help → exit 0, in cách dùng, không mở DB
  And tuỳ chọn lạ "--foo" hoặc "--config" thiếu giá trị → exit 2 "FAIL usage"
  And file không tồn tại → exit 2 "FAIL input_not_found code=ENOENT"
  And file '{"title":"秘密ABC' (JSON cụt) → exit 2 "FAIL input_not_json", dòng trạng thái không chứa "秘密"
  And [] , {"title":"a"}, {"title":1,"body":""} → exit 2 "FAIL input_bad_shape"
  And trong mọi trường hợp trên: fake CLI không được gọi, APP_DATA_DIR không có app.db

Scenario: AC-8 Đường dẫn tương đối tính theo thư mục người dùng gõ lệnh (một test)
  Given người dùng đứng ở thư mục D (không phải apps/app) và có D/sub/issue.json
  When chạy `pnpm translate-issue -- sub/issue.json` từ D ("--" đứng riêng bị bỏ qua)
  Then exit 0 và dịch đúng file đó

Scenario: AC-9 Engine lỗi: báo mã, không lộ stderr, không ghi cache
  Given fake CLI ở mode "fail" (stderr "fake: not logged in")
  Then exit 1, dòng cuối có "translate-issue FAIL translate:process_failed" và "hits=0 misses=2"
  And stdout không có bản dịch, toàn bộ output không chứa "not logged in"
  And bảng translation rỗng; chạy lại với mode "ok" thì engine=called
  Given fake CLI ở mode "garbage"
  Then dòng cuối có "FAIL translate:bad_output" (không có detail: lỗi ở runner, không phải schema)
  Given fake CLI ở mode "batch-missing"
  Then dòng cuối có "FAIL translate:bad_output detail=missing_segment"
  Given cấu hình maxInputChars = 100 và body tiếng Nhật 500 ký tự trong một đoạn
  Then exit 1, "FAIL translate:input_too_large", không gọi fake CLI

Scenario: AC-10 Cấu hình CLI thiếu hoặc sai
  Given --config trỏ tới file không tồn tại (hoặc chứa cờ cấm "--tools")
  Then exit 1, dòng cuối có "FAIL translate:not_configured" và "cache=warn:engineVersion"
  And không chứa đường dẫn config

Scenario: AC-11 Không mở được DB thì dừng, không in đường dẫn
  Given APP_DATA_DIR trỏ tới một file thường (không phải thư mục)
  Then exit 1, dòng cuối bắt đầu "translate-issue FAIL storage:open_failed", không gọi fake CLI

Scenario: AC-12 --out ghi bản dịch ra file UTF-8 có BOM
  When chạy với --out out/vi.txt (tương đối theo thư mục gõ lệnh)
  Then file bắt đầu bằng EF BB BF, phần sau là đúng khối bản dịch như khi in ra màn hình
  And stdout chỉ có đúng một dòng: dòng trạng thái OK
  Given --out trỏ vào thư mục không tồn tại
  Then exit 1, "FAIL output_write code=ENOENT"; chạy lại không có --out thì "engine=skipped"

Scenario: AC-13 Dòng trạng thái không bao giờ chứa dữ liệu
  Given title/body chứa chuỗi đánh dấu "ZZTITLEZZ"/"ZZBODYZZ" kèm tiếng Nhật, file nằm trong thư mục có tên "ZZPATHZZ", APP_DATA_DIR có "ZZDATAZZ", config có "ZZCFGZZ"
  When chạy qua mọi nhánh của AC-1, AC-7, AC-9, AC-10, AC-11, AC-12
  Then dòng cuối luôn là một dòng ASCII, chỉ gồm "translate-issue", OK/FAIL, mã trong danh sách và các cặp key=value có key trong bảng
  And không chứa "ZZ", không chứa os.hostname(), không chứa ký tự ngoài ASCII
  And formatStatusLine từ chối (ném Error) mọi giá trị không thuộc danh sách cố định / không phải số / không khớp ^[A-Za-z0-9_:./-]+$

Scenario: AC-14 Đếm thư mục ghit-ai-* sót lại
  Given os.tmpdir() của process có sẵn 3 thư mục "ghit-ai-x1..x3" và 1 thư mục "khac-1"
  Then dòng cuối có "tmpLeft=3" (hoặc lớn hơn nếu lần gọi CLI để lại thư mục)
  And không thư mục nào bị xoá
```

Các mã `data_dir_invalid`, `storage:<reason>` khác (`schema_too_new`, `corrupt`…), `internal` và nhánh `cache=warn:lookup|store` vẫn thuộc thiết kế nhưng không có AC riêng: hành vi cache lỗi đã khoá ở 003 (AC-11 của 003), map mã lỗi đi chung một hàm với AC-11 ở đây.

| AC | Khoá bằng | File |
|---|---|---|
| AC-5, AC-6, AC-7 (phần giải mã/parse thuần), AC-13 (phần `formatStatusLine`) | unit | `apps/app/src/cli/translate-issue/issue-input.test.ts`, `status-line.test.ts` |
| AC-3 (một test), AC-7, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14 | unit trong process: gọi `runTranslateIssue({ argv, env, cwd, stdout, ... })` với fake CLI thật (`fake-claude-cli.mjs`), SQLite file trong thư mục tạm | `apps/app/src/cli/translate-issue/run-translate-issue.test.ts` |
| AC-1 (hai process liên tiếp), AC-2, AC-4, AC-8 (một test) | integration mức process: spawn đúng lệnh người dùng chạy, `APP_DATA_DIR` tạm, cấu hình fake CLI | `apps/app/src/cli/translate-issue/translate-issue.process.test.ts` |
| hàm dựng translator thật | unit | `apps/app/src/composition-root.test.ts` |

**Kiểu test: không e2e Playwright, không đụng `e2e/specs/` hay lock (đã chốt ở GATE 1).** Lý do: lệnh không có web server, không có UI, và harness `/__test__` không liên quan. Hợp đồng hành vi ở đây là argv, file, stdout và exit code, nên test bằng Vitest:
- Hàm thuần (giải mã, parse, đếm, format) test unit.
- Phần điều phối test trong process qua `runTranslateIssue`, nhận `argv/env/cwd/stdout/stderr` và trả exit code. `main` chỉ nối hàm này với `process`.
- Một vài test spawn **đúng lệnh người dùng gõ**, vì chỉ test mức process mới bắt được lỗi về `INIT_CWD`, `--`, exit code và việc "lần hai là process mới".
Mọi test dùng `fake-claude-cli.mjs` qua file cấu hình, không gọi AI thật. Test spawn chạy chậm (khoảng 1–2 giây mỗi lần do tsx) nên giữ ít. Vì không có lock e2e, user duyệt **danh sách AC + bảng trên** ở GATE 1. Bước 3 của workflow bị bỏ, như đã làm ở 003.

**Kiểm trên máy thật (không tự động, là tiêu chí xong M1):** user chạy hai lần với một issue thật rồi gõ lại hai dòng trạng thái. Lần một có `engine=called`, lần hai có `hits=2 misses=0 engine=skipped`. Ghi kết quả (`ms`, `tmpLeft`, `enc`, `jaChars`) vào `docs/spikes/claude-cli-windows.md` thành "Lần 5".

## Tác động domain
- Thuật ngữ mới: không. Story chỉ dùng `Translator`, `CachingTranslator`, `TranslationCache`, `EngineVersion`, `dataDir` đã có. "Dòng trạng thái" là khái niệm vận hành của lệnh này, không đưa vào ubiquitous language.
- Aggregate / invariant / event: không đổi. Script là bên gọi đầu tiên của `CachingTranslator` với adapter thật và dùng `observer.lookedUp` / `cacheFailed` đúng như spec 003 dự kiến.
- Port: không đổi. Thêm hàm dựng translator thật trong `composition-root.ts` và hàm thuần `dataDirSource(env, platform)` cạnh `resolveDataDir` trong `data-dir.ts`.
- ADR: không cần. Script ghi vào `app.db` thật nên cache này app (005/006) dùng lại được. Điều đó đã nằm trong ADR-0008/0009.

## UI (nếu có)
Không có.

## Ngoài phạm vi
- Gọi `gh` từ script (đã chốt ở GATE 1 của 003): `GhCliGateway` thuộc 005.
- Glossary: script dùng `glossary: []`, không có tuỳ chọn nhận glossary; nguồn glossary thật ở 015 (đã chốt ở GATE 1).
- Comment, hint, nhiều issue một lần.
- Dọn thư mục `ghit-ai-*` sót do EPERM: chỉ đếm (`tmpLeft`). Cơ chế dọn bù làm trước khi app chạy nền lâu dài (005/020).
- Tắt `ExperimentalWarning` của `node:sqlite` (ADR-0004), nâng Node máy thật lên ≥ 24.15.
- Chuyển cấu hình CLI ra khỏi thư mục repo (thay zip là mất `config/claude-cli.local.json`): quyết ở 005/021.
- Nhánh adapter thật của server (`buildDeps` khác `"fake"` vẫn `throw`).

## Rủi ro / phản biện
- **Encoding khi xuất bằng PowerShell** là rủi ro lớn nhất, và nằm **ngoài** script: tiếng Nhật có thể hỏng trước khi vào file. Script không sửa được, chỉ phát hiện được (`jaChars=0`) và hướng dẫn dùng `cmd /c`. Nếu bỏ qua điểm này, lần chạy đầu trên máy thật dễ "dịch" ra rác mà trông như thành công.
- **Story chỉ là công cụ tạm** nếu viết riêng. Vì vậy thiết kế dồn việc lắp adapter thật vào `composition-root.ts` để 005 dùng lại, còn script chỉ là lớp vỏ. Nếu không làm vậy, M1 chứng minh được một đường lắp mà app sẽ không dùng.
- **Ghi vào `app.db` thật:** đây là lần đầu file DB thật được tạo trên máy công ty. Migration chạy thật, và lỗi ở đây cũng là lỗi app sẽ gặp, đó là điều tốt. Chạy song song hai lệnh thì mỗi lệnh tự trượt và dịch (busy_timeout 5000 ms, WAL); chấp nhận.
- **"Lần hai lấy từ cache" phụ thuộc khoá:** đổi `--model` trong cấu hình, nâng `CLAUDE_CLI_PROMPT_VERSION` ở bản zip mới, hay xuất lại file làm `\r\n` thành `\n` đều làm trượt. Kết quả trượt là đúng thiết kế 003. Dòng trạng thái đủ để phân biệt (`misses` khác 0).
- **Lần chạy đầu tạo `app.db` và chạy migration**, nên lệnh chậm hơn một chút. Không ảnh hưởng `ms` vì `ms` chỉ đo `translate`.
- **Chỉ đếm thời gian của lệnh, không biết số lần gọi con:** issue dài bị `ClaudeCliTranslator` chia thành nhiều lần gọi tuần tự, nhưng `engine=called` không cho biết bao nhiêu lần. Muốn biết thì cần đổi port, không đáng ở story này.

## Câu hỏi mở
(Đã chốt ở GATE 1, 2026-11-27.)
- [x] 1. **Script có nhận glossary không?** **Chốt: không**, `glossary: []`; nguồn glossary thật ở 015.
- [x] 2. **Cấu hình CLI mặc định ở đâu?** **Chốt: `<repo>/config/claude-cli.local.json`** (giống `diagnose`), có `--config` để đổi.
- [x] 3. **Bỏ e2e Playwright?** **Chốt: bỏ**, khoá bằng Vitest (unit + trong process + vài test spawn mức process) với `fake-claude-cli.mjs`.
- [x] 4. **Cỡ S:** bỏ AC "đổi `--model` trượt cache" và "cache lỗi vẫn dịch" (đã phủ ở 003); lỗi lưu trữ chỉ giữ `storage:open_failed`; `input_too_large` gộp vào AC lỗi engine; AC đoạn rỗng và AC đường dẫn tương đối mỗi cái một test.

## Kế hoạch implement
(Implementer làm theo thứ tự, mỗi bước một commit `feat(translation): … (003b)`.)
1. **Hàm thuần đầu vào.** `apps/app/src/cli/translate-issue/issue-input.ts`: `decodeInputBytes(bytes) → { enc, text } | { error: "input_encoding" }`, `parseIssueJson(text) → { title, body } | { error }` (không giữ message của `JSON.parse`), `countJapaneseChars(text)`. Test AC-5, AC-6, AC-7 (phần thuần). Kiểm chứng: `pnpm test apps/app/src/cli/translate-issue/issue-input.test.ts`.
2. **Dòng trạng thái.** `status-line.ts`: `formatStatusLine({ outcome, code?, fields })` theo bảng key cố định và thứ tự cố định; ném `Error` với giá trị lạ. `dataDirSource(env, platform)` trong `data-dir.ts`. Test AC-13 (phần format) và các nguồn của `dataDir`. Kiểm chứng: `pnpm test apps/app/src`.
3. **Composition root.** Hàm dựng `Translator` thật (cache SQLite + `claudeCliEngineVersion` + observer, cho phép bọc `inner`). Test bằng cấu hình fake CLI + SQLite `:memory:`: dịch hai lần, lần hai không gọi CLI. Kiểm chứng: `pnpm test apps/app/src/composition-root.test.ts`.
4. **Điều phối.** `run-translate-issue.ts`: `runTranslateIssue({ argv, env, cwd, platform, homedir, stdout, stderr, buildTranslator? }) → Promise<exitCode>` (argv, đọc file theo `cwd`, mở storage, dịch, đếm `inner`, đo `ms`, đếm `tmpLeft`, in kết quả, `--out`, map lỗi thành mã, đóng DB trong `finally`). Test AC-3, AC-7, AC-9 … AC-14. Kiểm chứng: `pnpm test apps/app/src/cli`.
5. **Entrypoint + lệnh pnpm.** `apps/app/src/cli/translate-issue/main.ts` nối với `process` (cwd lấy từ `INIT_CWD` nếu có); thêm script `translate-issue` ở root `package.json` (và ở `apps/app` nếu cần). Test spawn AC-1, AC-2, AC-4, AC-8. Kiểm chứng: `pnpm typecheck && pnpm test`, rồi chạy tay `pnpm translate-issue <file>` với cấu hình fake CLI.
6. **Docs.** Thêm mục "Dịch thử một issue (003b)" vào `docs/spikes/diagnose.md`: cách xuất bằng `cmd /c`, cách chạy, cách đọc dòng trạng thái, và nhắc chỉ gõ lại dòng trạng thái. Thêm `pnpm translate-issue <file.json> [--config <path>] [--out <file>]` vào mục Lệnh của CLAUDE.md (user đã đồng ý ở GATE 1). Kiểm chứng: `pnpm verify`.

## Workflow log
| Bước | Thời điểm | Kết quả |
|---|---|---|
| 1 Phân tích | 2026-11-27 | Spec draft, 17 AC (unit + trong process + spawn mức process, không e2e), 3 câu hỏi mở. Không đổi docs domain, không ADR |
| GATE 1 | 2026-11-27 | User duyệt. Chốt: không nhận glossary (`glossary: []`, nguồn thật ở 015); cấu hình CLI mặc định `<repo>/config/claude-cli.local.json` + `--config`; không e2e, khoá bằng Vitest + `fake-claude-cli.mjs`; cắt AC giữ cỡ S (bỏ đổi model và cache lỗi vì đã phủ ở 003, lỗi lưu trữ chỉ giữ `open_failed`, `input_too_large` gộp vào AC lỗi engine, AC đoạn rỗng và đường dẫn tương đối mỗi cái một test), còn 14 AC; được thêm `pnpm translate-issue` vào CLAUDE.md. Trạng thái approved |
| 4 Implement, lượt 1 | 2026-11-27 | Xong bước 1–3 (issue-input, status-line + dataDirSource, buildRealTranslator trong composition-root); unit xanh, typecheck xanh. Còn bước 4–6 |
| 4 Implement, lượt 2 | 2026-11-27 | Xong bước 4–6: `run-translate-issue.ts` (+ test trong process), `main.ts`, script `translate-issue` ở root (thêm `tsx` vào devDependencies của root để giữ `INIT_CWD`), test spawn mức process, docs (diagnose.md, CLAUDE.md). Lệch spec: AC-9 `garbage` không cho `detail=invalid_schema` (xem báo cáo) |
| Review vòng 1 | 2026-11-27 | APPROVE. Sửa: AC-9 theo hành vi thật của fake CLI; ghi cách chạy bằng root script; docs dùng `pnpm -s`, phải đứng trong repo; `main` bọc `runTranslateIssueSafely` (FAIL internal); đồng bộ range `tsx` ^4.23.15; bỏ `!` ở `output_write` |
| 5 Verify + 7 PR | 2026-11-27 | Orchestrator chạy `pnpm verify` xanh (340 unit, e2e lock OK, smoke 1/1). Để lại 2 nit: test AC-14/AC-5 mỏng, `segments` lặp logic chọn đoạn của core. Trạng thái done. Tiêu chí M1 còn chờ chạy trên máy thật |
