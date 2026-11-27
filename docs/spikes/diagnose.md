# Chạy `diagnose` trên máy công ty

Máy công ty không push ngược lại được và không được mang dữ liệu ra ngoài. `diagnose` chỉ in trạng thái, phiên bản, số đếm, thời gian và mã lỗi, nên **gõ lại các dòng đó** cho Claude là đủ. Đừng gửi output của `--raw`: nó có thể chứa hostname hoặc owner, chỉ dùng để tự đọc.

## Chuẩn bị

1. Tải zip của repo, giải nén. Không cần `pnpm install`, chỉ cần Node ≥ 22 và `gh`.
2. `gh auth login --hostname <host GHES>`. Token phải có scope `read:project`: `gh auth refresh -s read:project --hostname <host>`.
3. (Tuỳ chọn) chép `config/claude-cli.example.json` → `config/claude-cli.local.json`, sửa `command` thành đường dẫn tuyệt đối tới `claude.exe`. Không có file này thì `diagnose` tìm `claude` trong PATH.

## Chạy (PowerShell, ở thư mục repo)

```powershell
$env:GH_HOST = "<host GHES>"
node scripts/diagnose/index.mjs --owner <org> --number <số project>                # GitHub + claude -p
node scripts/diagnose/index.mjs --owner <org> --number <n> --scheduler --toast     # thêm Task Scheduler + toast
```

- Project của user thay vì org: thêm `--owner-type user`. Số project nằm trong URL `.../orgs/<org>/projects/<n>`.
- `--scheduler` tạo một task tạm, chạy lại phần Claude trong ngữ cảnh Task Scheduler, rồi tự xoá task. Có thể có cửa sổ console bật lên.
- `--toast` hiện một toast thử và hỏi y/n.
- `--skip-claude` để bỏ qua phần Claude, `--raw` để xem lỗi gốc (chỉ tự đọc).

## Đọc kết quả

| Dòng | Ý nghĩa nếu không OK |
|---|---|
| `scope WARN` | Thiếu `read:project`, query Projects v2 sẽ lỗi `SCOPE_MISSING` |
| `projectsV2 FAIL PROJECTS_V2_UNSUPPORTED` | Bản GHES chưa có Projects v2, phải xem lại toàn bộ cách theo dõi |
| `updated: FAIL ARG_QUERY_UNSUPPORTED` hoặc `server bỏ qua filter` | Poller phải lấy hết item rồi lọc phía client |
| `filter miss FAIL` | Có issue cập nhật (comment…) mà `item.updatedAt` không đổi nên filter bỏ sót → không dùng filter `updated:` làm nguồn chính; phải so `Issue.updatedAt` phía client |
| `filter basis` | Filter dựa trên updatedAt của item hay của Issue. App theo dõi `Issue.updatedAt`: nếu filter dựa trên item thì chỉ dùng nó để thu hẹp, vẫn phải so lại `Issue.updatedAt` |
| `updated time` | Server có hiểu giờ/phút không. Không hiểu thì chỉ lọc được ở mức ngày |
| `item scan` | `FAIL`: không quét được toàn bộ item (mã lỗi). `OK`: `pages`, `items`, `issues`, `pr`, `draft`, `noaccess`, `ms` = chi phí **một chu kỳ poll** của 005b (số lần gọi `gh` = `pages`) → chọn chu kỳ poll mặc định. Thêm: `closed` (số Issue có `state` CLOSED), `statusField` (`found` = project có field tên `--status-field`, mặc định `Status`; `missing` = không có field đó, kiểm lại tên; `unsupported` = GHES không nhận `fieldValueByName`/`field(name:)`, phép đo chạy lại không có Status), `statusSet` (số item có giá trị Status), `statusOptions` (số optionId khác nhau). Không in tên field hay tên giá trị. Dùng để chốt cách poller nhận issue "đóng" (state CLOSED hoặc Status thuộc danh sách cấu hình) ngay trong pha quét |
| `gql stdin` | `FAIL <mã>`: `gh api graphql --input -` (JSON `{query, variables}` qua stdin) không chạy → adapter dùng `-f query=… -F …` (đã chạy được ở dòng `projectsV2`), id đi inline. `OK ms=…` → adapter dùng stdin |
| `comments WARN … newerComment=N` | N > 0: comment mới KHÔNG làm `Issue.updatedAt` đổi → thiết kế 005b (phát hiện comment mới) sai, **báo lại trước khi làm tiếp** |
| `comments` | `issues` (số Issue lấy được), `withComments`, `maxComments`, `over100` (số issue hơn 100 comment → phải phân trang comment; 0 = ít cần), `newerComment` (phải 0), `editedComment` (comment cuối được sửa sau `Issue.updatedAt`; chấp nhận được), `batches`, `batchMs` (trung bình mỗi lô 25 id), `batchMsMax` → chọn `DETAIL_BATCH` |
| `gql partial` | `nodes(ids:[thật, giả])`: `exit=<mã gh> stdoutJson=yes\|no data=<số node không null> errors=yes\|no`. `exit=1 stdoutJson=yes data=1` → dùng `data` và coi `null` là id mất (giả định hiện tại). `stdoutJson=no` → `gh` bỏ stdout khi có lỗi, adapter phải chia nhỏ lô để cô lập id hỏng. `exit=0` → server không coi id hỏng là lỗi |
| `claude -p FAIL NOT_FOUND` | `command` không spawn được (shim npm không đuôi, alias PowerShell). Dùng `--write-config` hoặc sửa config, xem README |
| `claude path FAIL` | `command` đang trỏ tới `.cmd`/`.ps1`. Cần trỏ tới `claude.exe`, hoặc `node` + `cli.js` |
| `claude -p FAIL UNKNOWN_FLAG --x` | Bản Claude CLI đang cài không có cờ đó, ADR-0003 cần chỉnh |
| `claude cfg FAIL … chứa cờ --x` | Config có cờ mà app tự đặt hoặc cấm (cấp tool, bỏ quyền…). Xoá cờ đó khỏi `args` |
| `scheduler FAIL task không chạy xong …` | Task con không xong trong hạn chờ (60s + `timeoutSeconds` + 120s). Các dòng `[sched]` phía trên cho biết nó dừng ở bước nào. `0x41301` = vẫn đang chạy (chậm), `0x41303` = chưa từng chạy (GPO/quyền logon), `0x80070002` = không thấy node/script, `1` = crash hoặc có FAIL |
| `[sched] …` | Kết quả của cùng phép thử khi chạy qua Task Scheduler (khác PATH, khác môi trường) |
| `node:sqlite file FAIL bước "…": <mã>` | Không tạo/ghi/bật WAL trong thư mục dữ liệu (`dataDir`). Mã như `EPERM`, `SQLITE_CANTOPEN`, `JOURNAL_DELETE` (ổ không hỗ trợ WAL, vd chia sẻ mạng). Dòng chỉ ghi nguồn đường dẫn (`APP_DATA_DIR`/`LOCALAPPDATA`/`fallback`), không ghi đường dẫn. Dùng `APP_DATA_DIR` để đổi chỗ. Không mở `app.db` thật |
| `node:sqlite file WARN bước "dọn file tạm"` | Ghi/đọc được nhưng xoá `diagnose-*.db` (và `-wal`/`-shm`) không được: nghi antivirus/khoá file. Ghi lại mã lỗi để quyết định story thử lại khi khởi động |
| `[sched] LOCALAPPDATA INFO unset` | Task Scheduler chạy không có `LOCALAPPDATA`; app dùng fallback `<homedir>\AppData\Local` (vẫn đúng chỗ) |
| `node:sqlite FAIL` | Không dùng được SQLite có sẵn trong Node → xem lại ADR-0004 (better-sqlite3) |
| `sched toast FAIL` | Toast gửi từ process nền không hiện → xem lại ADR-0005 |
| `toast click FAIL` | Cần cách toast khác, đưa vào ADR-0005 |

### Bốn dòng đo cho adapter GitHub (005a, bước 1)

Chạy khi có `--owner` và `--number` (cần `projectsV2 OK`), sau các dòng `filter …`/`updated time`. Chỉ chạy lệnh đọc, không ghi gì lên GitHub. Dòng `gql partial` cố ý gửi một id không tồn tại (id thật đổi ký tự cuối); lỗi đó là phép thử, không phải sự cố.

```powershell
$env:GH_HOST = "<host GHES>"
node scripts/diagnose/index.mjs --owner <org> --number <n> --skip-claude            # thêm --status-field <tên> nếu field không tên "Status"
```

Mẫu output (số liệu minh hoạ):

```
item scan        OK    pages=3 items=286 issues=278 pr=5 draft=3 noaccess=0 closed=120 statusField=found statusSet=270 statusOptions=5 ms=4100
gql stdin        OK    ms=700
comments         OK    issues=278 withComments=190 maxComments=31 over100=0 newerComment=0 editedComment=2 batches=12 batchMs=2400 batchMsMax=3100
gql partial      INFO  exit=1 stdoutJson=yes data=1 errors=yes
```

Gõ lại cả 4 dòng (chỉ có số đếm, mã và thời gian). Cách đọc để chốt thiết kế:

| Quyết định | Đọc ở đâu |
|---|---|
| Chu kỳ poll mặc định | `item scan ms` (và `pages`): chu kỳ phải lớn hơn nhiều lần `ms` |
| `DETAIL_BATCH` | `comments batchMs`/`batchMsMax` (lô 25 id, chỉ lấy comment cuối). `batchMsMax` gần 60 s (timeout mỗi lần gọi) → giảm lô; thấp → có thể tăng. Lô thật còn lấy body + tối đa 100 comment nên nặng hơn: chừa dư |
| Cách truyền query | `gql stdin`: `OK` → `--input -`; `FAIL` → `-f query=… -F …` |
| Lỗi một phần | `gql partial`: xem bảng trên |
| Phân trang comment | `comments over100`: AC-4 vẫn giữ; 0 nghĩa là nhánh phân trang hiếm khi chạy |
| Giả định cốt lõi | `comments newerComment` phải bằng 0 |

## Dịch thử một issue (003b)

Kiểm lõi dịch M1 (`claude -p` + cache SQLite) trên một issue thật mà không cần poller. Khác `diagnose`, lệnh này cần `pnpm install` (dùng `tsx` và `node:sqlite`, Node ≥ 22.13).

1. Xuất issue ra file bằng **`cmd /c`** (giữ nguyên byte; `>` của PowerShell 5.1 có thể làm hỏng tiếng Nhật thành `?` trước khi vào file):
   ```
   cmd /c "gh issue view <số> --repo <owner/repo> --json title,body > issue.json"
   ```
   Ghi chú: file do `>`/`Out-File` của PowerShell (UTF-8 có BOM, UTF-16LE) vẫn đọc được, nhưng nếu tiếng Nhật đã hỏng thì script không cứu được.
2. Chạy bằng `pnpm -s` (`-s` tắt banner `> …` mà pnpm in ra stdout, có đường dẫn tuyệt đối và tên file; nếu quên `-s` thì **không gõ lại các dòng `>` đó**). Phải đứng trong thư mục repo (thư mục gốc, hoặc thư mục con không có `package.json` riêng); không chạy từ `apps/app`. Đường dẫn tương đối tính theo thư mục đang đứng; file ở ngoài repo thì truyền đường dẫn tuyệt đối.
   ```
   pnpm -s translate-issue issue.json
   pnpm -s translate-issue issue.json --config <path> --out vi.txt
   ```
   `--config` mặc định `config/claude-cli.local.json` (cùng file `diagnose` dùng). `--out` ghi bản dịch ra file UTF-8 có BOM, khi đó màn hình chỉ có dòng trạng thái. Chạy lại lần hai để thấy cache.
3. Dòng cuối là **dòng trạng thái**, chỉ gồm mã, số đếm và thời gian. **Chỉ gõ lại dòng này** cho Claude; đừng gửi bản dịch hay đường dẫn.

```
translate-issue OK enc=utf8 jaChars=120 srcChars=200 segments=2 hits=0 misses=2 engine=called ms=8000 cache=ok data=LOCALAPPDATA tmpLeft=0
```

| Trường | Ý nghĩa |
|---|---|
| `enc` | Encoding của file: `utf8`, `utf8-bom`, `utf16le-bom` |
| `jaChars` | Số ký tự kana/kanji. **0 với issue tiếng Nhật = file đã hỏng encoding**, xuất lại bằng `cmd /c` |
| `srcChars`, `segments` | Độ dài và số đoạn có chữ cần dịch (title, body) |
| `hits` / `misses` | Số đoạn trúng / trượt cache. Lần hai phải là `hits=2 misses=0 engine=skipped` |
| `engine` | `called` nếu có gọi `claude -p`, `skipped` nếu cache đủ |
| `ms` | Thời gian dịch (không gồm mở DB) |
| `cache` | `ok` hoặc `warn:<engineVersion\|lookup\|store>[/sqlite=<mã>]` (cache lỗi nhưng vẫn dịch) |
| `data` | Nguồn của `dataDir` (không in đường dẫn) |
| `tmpLeft` | Số thư mục `ghit-ai-*` còn trong thư mục tạm (theo dõi EPERM, chỉ đếm) |

Lỗi: `FAIL <mã>`. Exit 2 là đầu vào sai (`usage`, `input_not_found`, `input_unreadable`, `input_encoding`, `input_not_json`, `input_bad_shape`, `data_dir_invalid`); exit 1 là `storage:<lý do>`, `translate:<lý do>` (kèm `detail=`), `output_write`, `internal`. `translate:not_configured` nghĩa là `--config` thiếu hoặc sai; xem `detail=` và `field=`: `config_missing` (không có file), `config_not_json`, `config_invalid field=<key>` (key sai kiểu hoặc ngoài khoảng, vd `timeoutSeconds` 10–1800, `concurrency` 1–4, `maxInputChars` 100–200000), `forbidden_flag field=args` (cờ cấm trong `args`), `command_cmd_bat field=command` (Windows không nhận `.cmd`/`.bat`). Dòng `claude cfg FAIL` của `diagnose` cũng nêu trường và khoảng hợp lệ. Stderr có thể có `ExperimentalWarning` của SQLite trên Node < 24.15, không chứa dữ liệu.

Ghi kết quả hai lần chạy (`ms`, `tmpLeft`, `enc`, `jaChars`) vào `docs/spikes/claude-cli-windows.md` mục "Lần 5".

## Kiểm adapter GitHub (005a)

Kiểm `GhCliGateway` (quét board Projects v2 + chi tiết issue kèm comment qua `gh`) trên máy thật, chạy sau `pnpm diagnose`. Cần `pnpm install`, `GH_HOST` đã đặt (không đặt: `FAIL gh_host_unset`, exit 2). Chỉ đọc: không ghi DB, không gọi Claude.

```
pnpm -s github-check --owner <org|user> --number <n> [--owner-type user] [--status-field <tên, mặc định Status>] [--days <1-30, mặc định 7>] [--max-details <1-200, mặc định 50>]
```

Chạy bằng `pnpm -s` từ thư mục repo (như `translate-issue`). **Chỉ gõ lại dòng cuối** (`github-check OK …` hoặc `github-check FAIL …`): chỉ có mã và số đếm; owner, hostname, tên field/giá trị Status, tên repo, nội dung không bao giờ được in. `--raw` in thêm stderr gốc của `gh` ra stderr để tự đọc (có thể có hostname/owner), không gõ lại.

```
github-check OK host=GH_HOST items=286 issues=278 skipped=pr:5,draft:3,noaccess:0 closed=40 statusField=found statusSet=270 statusOptions=5 pages=3 scanMs=4100 recent=23 details=23 missing=0 detailCalls=1 comments=140 maxComments=31 commentPages=0 jaChars=51234 newerComment=0 editedComment=2 detailMs=2900
```

| Trường | Ý nghĩa |
|---|---|
| `host` | Luôn là chữ `GH_HOST` (có đặt), không in giá trị |
| `items`, `issues`, `skipped` | Số item trên board; số Issue; số PR / draft / không có quyền |
| `closed` | Số Issue có `state = CLOSED` |
| `statusField`, `statusSet`, `statusOptions` | `found` / `missing` / `not_single_select`; số Issue có giá trị Status; số giá trị Status khác nhau đang dùng |
| `pages`, `scanMs` | Số trang và thời gian quét (chi phí mỗi chu kỳ của 005b) |
| `recent`, `details`, `missing` | Issue đổi trong `--days`; số lấy chi tiết được (tối đa `--max-details`, mới nhất trước); số id không còn |
| `detailCalls`, `commentPages` | Số lần gọi `gh` lấy chi tiết (lô 25); số lần gọi thêm để phân trang comment |
| `comments`, `maxComments` | Tổng comment / nhiều nhất trên một issue |
| `jaChars` | Số ký tự kana/kanji trong title+body+comment. **0 với project tiếng Nhật = hỏng encoding giữa `gh` và Node** |
| `newerComment` | Số issue có comment `createdAt` > `Issue.updatedAt`. Khác 0 = comment mới không đẩy mốc, 005b sẽ bỏ sót comment |
| `editedComment` | Số issue có comment `updatedAt` > `Issue.updatedAt` (gồm cả comment mới, vì `updatedAt` ≥ `createdAt`) |
| `detailMs` | Thời gian lấy chi tiết |

Lỗi: `github-check FAIL <mã>`. Exit 2 = đầu vào sai (`usage`, `gh_host_unset`); exit 1 = `github:<reason>` (`gh_not_found`, `not_authenticated`, `scope_missing`, `project_not_found`, `projects_v2_unsupported`, `network`, `timeout`, `process_failed`, `bad_output`) hoặc `internal`.

Ghi kết quả vào `docs/spikes/projects-v2-polling.md` (Lần 5).

## Kiểm poller (005b/005c)

Kiểm `pnpm start` (nhánh adapter thật: `gh` thật, DB thật, `PollScheduler`) trên máy Windows thật. Không dịch, không toast. Cần `pnpm install`, `GH_HOST` đã đặt, và `gh` đã đăng nhập. Nên kiểm trước bằng `pnpm -s github-check --owner <user> --owner-type user --number <n>` (xem mục trên); `FAIL project_not_found` / `scope_missing` thì dừng và báo lại.

Tạo `%LOCALAPPDATA%\gh-issue-translator\config.json` (app không tự tạo; thư mục `dataDir` có thể chưa có, tự tạo):

```json
{ "project": { "owner": "<user hoặc org>", "ownerType": "user", "number": <n>, "closedStatuses": ["<tên cột đóng nếu có>"] }, "pollIntervalMin": 1 }
```

Mặc định: `ownerType` "org", `statusField` "Status", `closedStatuses` [], `pollIntervalMin` 5 (số nguyên 1–60), `claudeCliConfig` `config/claude-cli.local.json` trong repo (chưa dùng ở 005c, file không cần tồn tại). Khoá lạ bị bỏ qua. Đổi cấu hình thì chạy lại app.

Chạy `pnpm start` (không phải `pnpm dev`, vốn chỉ chạy fake). Dòng cần gõ lại là dòng `[startup]`, `[storage]` (trừ dòng `db=` / `config=`, để tự đọc) và `[poll]`.

| Bước | Thao tác | Dòng mong đợi |
|---|---|---|
| 1 | Khởi động lần đầu | `[poll] BASELINE issues=<số issue trên board> closed=<…> skipped=… pages=<…> ms=<…>` |
| 2 | Chờ một chu kỳ, không làm gì | `[poll] OK … details=0 new=0 newComments=0 edited=0 …` |
| 3 | Comment vào một issue đang mở | `[poll] OK … details=1 … newComments=1 …` |
| 4 | Sửa body issue đó | `[poll] OK … edited=1 …` |
| 5 | Comment vào issue đã đóng (hoặc kéo issue có comment mới sang cột close) | `[poll] OK … details=0 … closedChanged=1 newComments=0 …` |
| 6 | Ctrl+C rồi chạy lại `pnpm start` | dòng `[poll]` đầu là `OK …` (không phải `BASELINE`), `new=0` |
| 7 | Bỏ `GH_HOST` rồi chạy | `[startup] FAIL gh_host_unset` |

Dòng `[poll]` (chỉ mã và số đếm, không owner, số project, hostname, tên field/Status, title, nội dung):

| Trường | Ý nghĩa |
|---|---|
| `issues`, `closed`, `skipped`, `pages` | Từ lần quét board; `closed` = số issue đóng theo `state` hoặc `closedStatuses` |
| `details`, `missing` | Số id lấy chi tiết; số id không còn đọc được |
| `new` | Issue mới thấy |
| `newComments` | Số comment mới trong các issue có comment mới |
| `edited` | Số nội dung bị sửa |
| `closedChanged` | Số issue đóng mà lẽ ra phải xem (có `updatedAt` mới, hoặc mới vào board) |
| `failed` | Số issue rollback vì lỗi lưu trữ; > 0 thì chữ đầu là `PARTIAL` |
| `warn=` | Chỉ có khi Status field không dùng được |
| `ms` | Thời gian cả chu kỳ |

Lỗi khởi động (exit 2): `[startup] FAIL gh_host_unset` · `data_dir_invalid data=<nguồn>` · `config_missing` (kèm dòng riêng `[startup] config=<đường dẫn>`) · `config_invalid field=<field>` (`(root)` = không phải JSON/object; field như `project.number`, `pollIntervalMin`, `project.closedStatuses.0`). Lưu ý: lỗi đọc `config.json` khác "không có file" (không có quyền, đường dẫn là thư mục, `EPERM`) hiện in `config_invalid field=(root)`, không phải `config_missing`. Lỗi lưu trữ (exit 1): `[storage] FAIL <reason>[ migration=N][ sqlite=C]: <message>` kèm dòng riêng `[storage] db=<đường dẫn>`. `gh` chưa đăng nhập / thiếu scope / mạng lỗi không chặn khởi động: chu kỳ in `[poll] FAIL github:<reason> ms=…` rồi thử lại chu kỳ sau.

Ghi số đo vào `docs/spikes/projects-v2-polling.md` (Lần 5). `closed=` ở bước 1 lệch số thấy trên board thì kiểm `closedStatuses` và tên field.
