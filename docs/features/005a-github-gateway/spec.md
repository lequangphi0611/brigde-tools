# 005a — Adapter GitHub: `GhCliGateway` + `github-check`

- Trạng thái: approved (GATE 1, 2026-11-27)
- Context: Tracking (adapter `GhCliGateway` cho port `GitHubGateway` trong `shared/ports`; lệnh vận hành `github-check`; thêm dòng cho `diagnose`)
- Cần UI: không

> **Tách từ story 005 (GATE 1, 2026-11-27).** Story 005 gốc trong roadmap gồm năm việc: adapter `gh` thật, fake `gh` mức process, logic poller (lần đầu, issue mới, comment mới, issue bị sửa), lắp storage + translator thật vào nhánh adapter thật, và dòng lỗi `StorageError`. Gộp lại là cỡ L. User đồng ý tách: spec này là **005a** (làm trước). **005b** (roadmap M2, phụ thuộc 005a + 004) chỉ có phạm vi, AC nháp và câu hỏi ở mục "Phần sau: 005b"; sẽ phân tích thành `docs/features/005b-…/spec.md` khi 005a xong. Lý do và trade-off ở mục "Tách story".

## User story
**005a.** Là người dùng có máy công ty chạy GHES, tôi muốn app có một adapter đọc được toàn bộ issue trên board Projects v2 (mốc `Issue.updatedAt`) và chi tiết issue kèm comment qua `gh`, kiểm được trên Windows thật bằng một lệnh chỉ in mã và số đếm. Như vậy poller (005b) xây trên một cổng GitHub đã chạy được với project thật, và tôi không phải mang dữ liệu công ty ra ngoài.

**005 (cả story, sau 005b).** Là người dùng, tôi muốn app tự quét một project theo chu kỳ, nhận ra issue mới và comment mới theo `Issue.updatedAt`, lần đầu chỉ lấy mốc (không báo dồn issue cũ), và issue bị sửa thì được dịch lại mà không báo, để mở ra là có bản dịch mà không bị làm phiền.

## Tách story

| | 005a (spec này) | 005b (phần sau) |
|---|---|---|
| Nội dung | Thêm dòng đo vào `diagnose` (bước 1); đổi port `GitHubGateway` thành hai pha; `runGhCli` + `GhCliGateway`; `fake-gh.mjs` mức process; contract test chung với `FakeGitHub`; lệnh `pnpm -s github-check` | Domain Tracking (`TrackedProject`, `Issue`, `Content`, so mốc từng issue); `PollCycle` + vòng lặp chu kỳ; migration bảng Tracking; phát `IssueDiscovered` / `ContentChanged`; cấu hình project; nhánh adapter thật của `buildDeps` (`openAppStorage` + `dataDir`, `buildRealTranslator`, `GhCliGateway`); dòng lỗi `StorageError` có đường dẫn DB |
| Cỡ | M | M |
| Kiểm trên máy thật | `diagnose` (dòng mới) rồi `github-check`: một dòng số đếm | Chạy app thật, comment thử vào một issue, đọc dòng log `[poll]` (chỉ số đếm) |

**Vì sao tách theo thứ tự này (rủi ro trước, đúng nguyên tắc 1 của roadmap):**
- Những gì chưa đo nằm hết ở phía `gh`: lấy comment tốn bao nhiêu, `gh` xử lý lỗi một phần (GraphQL trả `data` lẫn `errors`) thế nào, gửi query qua stdin (`--input -`) có chạy trên Windows/GHES không, comment mới có làm `Issue.updatedAt` đổi không. Mấy điều này quyết định hình dạng port. Đo và chốt port trước thì 005b viết logic trên một port không phải sửa lại.
- Logic poller (005b) kiểm hoàn toàn trong container bằng `FakeGitHub` + `ControllableClock` + SQLite `:memory:`, không cần Windows. Để sau không tăng rủi ro.
- Mỗi PR nhỏ, review được.

**Trade-off:**
- 005a một mình không cho người dùng giá trị thấy được (chưa có poll tự động). Bù lại `github-check` không phải công cụ dùng một lần: 009 (trang tình trạng) và 021 (hướng dẫn cài) dùng lại được để chẩn đoán `gh`.
- Port được thiết kế trước khi có bên dùng thật. Giảm rủi ro bằng cách viết sẵn các AC nháp của 005b (mục cuối) và thiết kế port theo đúng nhu cầu đó (quét toàn bộ để thấy issue mới cả khi `Issue.updatedAt` cũ, chi tiết có comment để so `ghId`).
- Phương án khác: làm logic poller trước (005b trước) trên `FakeGitHub`. Có giá trị domain sớm hơn, nhưng đẩy rủi ro Windows/GHES ra sau, và nếu đo xong phải đổi port thì sửa cả hai. Không chọn.
- Không tách mà cắt bớt (bỏ `github-check`, bỏ dòng `diagnose`): vẫn gần L, và mất cách kiểm adapter trên máy thật trước khi lắp vào app chạy nền.

## Phạm vi 005a
- **Có:**
  - Dòng mới trong `pnpm diagnose` (Node thuần, chạy trước `pnpm install`): `item scan`, `comments`, `gql stdin`, `gql partial` (bảng ở mục Thiết kế). Làm **đầu tiên** để người dùng chạy sớm; kết quả ghi vào `docs/spikes/projects-v2-polling.md` (Lần 4) và có thể chỉnh hằng số của adapter (cỡ lô, cách truyền query).
  - Port `GitHubGateway` đổi thành hai phương thức: quét toàn bộ issue trên board (chỉ `nodeId` + `Issue.updatedAt`), và lấy chi tiết theo lô (title, body, assignees, toàn bộ comment).
  - `runGhCli`: chạy `gh` không shell, query + biến đi qua stdin, có timeout, giới hạn stdout, phân loại lỗi thành `GitHubFailure`.
  - `GhCliGateway implements GitHubGateway`; `FakeGitHub` cập nhật theo port mới; contract test chạy cùng bộ case cho cả hai.
  - `fake-gh.mjs` (Node script thay lệnh `gh`) với các chế độ ok/lỗi/treo/rác; ghi lại argv, stdin, một số biến môi trường.
  - Lệnh `pnpm -s github-check`: dùng `GhCliGateway` thật, in **một** dòng trạng thái chỉ có mã và số đếm.
- **Không:** logic poller, bảng SQLite, domain event, vòng lặp chu kỳ, nhánh adapter thật của `buildDeps`, dòng lỗi `StorageError` (tất cả thuộc 005b). Dịch (006). Toast (007). Lọc `updated:` phía server (spike: không làm nguồn chính; không cần vì GHES tắt rate limit). Pull request và draft issue trên board (chỉ đếm). Dọn thư mục `ghit-ai-*` và chuyển cấu hình Claude CLI ra khỏi repo (không thuộc 005, xem "Việc dời từ 003b").

## Thiết kế 005a

### Port `GitHubGateway` (thay `fetchUpdatedIssues(project, since)`)
Port cũ lọc theo `since` nên không thấy issue cũ vừa được thêm vào board, và không có comment. Port mới (tên chốt ở bước implement, theo từ vựng):

```ts
interface ProjectIssueStamp { nodeId: string; updatedAt: string }   // updatedAt = Issue.updatedAt (ISO), KHÔNG phải item.updatedAt
interface ProjectScan {
  issues: ProjectIssueStamp[];                                       // mọi Issue trên board, mỗi nodeId một lần
  skipped: { pullRequest: number; draftIssue: number; inaccessible: number };
  pages: number;
}
interface GitHubCommentSnapshot { nodeId: string; author: string | null; body: string; createdAt: string; updatedAt: string }
interface GitHubIssueSnapshot {
  nodeId; repo /* owner/name */; number; url; title; body; assignees: string[]; updatedAt;
  comments: GitHubCommentSnapshot[];                                 // đủ mọi comment, sắp theo createdAt tăng dần
}
interface IssueDetails { issues: GitHubIssueSnapshot[]; missing: string[] }  // missing = nodeId không còn đọc được

interface GitHubGateway {
  scanProject(project: ProjectRef): Promise<ProjectScan>;
  fetchIssueDetails(nodeIds: readonly string[]): Promise<IssueDetails>;
}
```
- Lỗi: ném `GitHubFailure { reason, detail? }`, message không chứa owner, hostname, id hay nội dung. `reason`: `gh_not_found` / `not_authenticated` / `scope_missing` / `project_not_found` / `projects_v2_unsupported` / `network` / `timeout` / `process_failed` / `bad_output`.
- `author = null` khi tài khoản đã xoá (ghost).
- `FakeGitHub` giữ dữ liệu trong bộ nhớ theo cùng hình dạng; harness `seedIssues` nhận snapshot mới (comment tuỳ chọn, mặc định `[]`).

### Cách lấy dữ liệu (hai pha, xem ADR-0010 nháp)
1. **Quét** (mỗi chu kỳ): phân trang `projectV2.items(first: 100)` đến hết, mỗi item chỉ lấy `content { __typename ... on Issue { id updatedAt } }`. Giống query `pageQ` đã chạy được trong `diagnose` (286 item ≈ 3 trang). Item là `PullRequest` / `DraftIssue` / `content = null` (không có quyền) → đếm vào `skipped`.
2. **Chi tiết** (chỉ cho issue đã đổi, 10–50 mục/ngày theo vision): `nodes(ids: $ids)` theo lô `DETAIL_BATCH` id (mặc định 25, chỉnh theo đo ở bước 1), mỗi issue lấy `id number url title body updatedAt repository { nameWithOwner } assignees(first: 20) { nodes { login } } comments(first: 100) { pageInfo totalCount nodes { id author { login } body createdAt updatedAt } }`. Issue có hơn 100 comment → gọi thêm `node(id)` với `comments(after:)` cho tới hết.

Không gộp comment vào query quét: mỗi chu kỳ sẽ kéo body + comment của cả ~286 issue (vài MB mỗi 5 phút) chỉ để dùng vài mục. Chi phí hai pha lúc yên: 3 lần gọi `gh`/chu kỳ; lúc có thay đổi: thêm `ceil(n / DETAIL_BATCH)` lần (+ lần phân trang comment hiếm gặp).

### Gọi `gh`
- `spawn(command, [...argsPrefix, "api", "graphql", "--input", "-"], { shell: false, windowsHide: true })`; stdin là JSON `{ "query", "variables" }` UTF-8. Owner, số project, cursor, danh sách id **luôn là biến GraphQL**, không bao giờ ghép vào chuỗi query hay argv.
- `command` mặc định `"gh"` (tìm trong PATH, `gh.exe`); test truyền `process.execPath` + `argsPrefix = [fake-gh.mjs]`.
- Môi trường: kế thừa `process.env` (để `GH_HOST`, cấu hình `gh` đi xuống), thêm `GH_PROMPT_DISABLED=1`, `GH_NO_UPDATE_NOTIFIER=1`, `NO_COLOR=1`.
- Timeout mỗi lần gọi 60 s → kill, `timeout`. Giới hạn stdout 32 MB → `bad_output`. Không tạo thư mục tạm (khác runner Claude: `gh` không đọc file trong cwd).
- **Lỗi một phần (Cần kiểm chứng ở dòng `gql partial`):** `nodes(ids:)` có id không còn tồn tại thì GitHub trả `data` có `null` kèm `errors`. Giả định hiện tại: `gh` vẫn in JSON ra stdout và thoát mã 1. Adapter: stdout là JSON có `data` → dùng `data`, id ứng với `null` vào `missing`; chỉ phân loại lỗi khi không có `data`. Nếu đo ra `gh` không in stdout khi có `errors`, adapter phải chia nhỏ lô để cô lập id hỏng (ghi vào Workflow log, chỉnh AC-6).
- Phân loại lỗi theo stderr/stdout (cùng quy tắc `classifyGhError` của `diagnose`, viết lại bằng TS có test riêng): `ENOENT` → `gh_not_found`; `HTTP 401|Bad credentials|gh auth login` → `not_authenticated`; `INSUFFICIENT_SCOPES|read:project` → `scope_missing`; `Could not resolve to an? (Organization|User)` hoặc `projectV2` null → `project_not_found`; `projectV2 … doesn't exist` → `projects_v2_unsupported`; mạng/TLS/proxy → `network`; còn lại thoát ≠ 0 → `process_failed`. stdout không phải JSON hoặc sai shape (zod) → `bad_output`.

### Lệnh `github-check`
```
pnpm -s github-check --owner <org|user> --number <n> [--owner-type user] [--days <1–30, mặc định 7>] [--max-details <1–200, mặc định 50>]
```
- Root script `tsx apps/app/src/cli/github-check/main.ts` (giống `translate-issue`, cần `pnpm install`, đứng trong repo).
- Bước: kiểm `GH_HOST` → `scanProject` → chọn các issue có `Issue.updatedAt` trong `--days` ngày gần nhất (tối đa `--max-details`, mới nhất trước) → `fetchIssueDetails` → in dòng trạng thái. Không ghi DB, không gọi Claude.
- `--owner` chỉ để gọi, không bao giờ in ra.

Dòng trạng thái (một dòng, cuối cùng):
```
github-check OK host=GH_HOST items=286 issues=278 skipped=pr:5,draft:3,noaccess:0 pages=3 scanMs=4100 recent=23 details=23 missing=0 detailCalls=1 comments=140 maxComments=31 commentPages=0 jaChars=51234 newerComment=0 editedComment=2 detailMs=2900
```

| Trường | Ý nghĩa |
|---|---|
| `host` | `GH_HOST` (có đặt) — không in giá trị |
| `items`, `issues`, `skipped` | Số item trên board; số Issue; số PR / draft / không có quyền |
| `pages`, `scanMs` | Số trang và thời gian quét (chi phí mỗi chu kỳ của 005b) |
| `recent`, `details`, `missing` | Issue đổi trong `--days`; số lấy chi tiết được; số id không còn |
| `detailCalls`, `commentPages` | Số lần gọi `gh` cho chi tiết; số lần gọi thêm để phân trang comment |
| `comments`, `maxComments` | Tổng comment / nhiều nhất trên một issue |
| `jaChars` | Số ký tự kana/kanji trong title+body+comment. `0` với project tiếng Nhật = hỏng encoding giữa `gh` và Node |
| `newerComment` | Số issue có comment `createdAt` > `Issue.updatedAt`. Khác 0 → comment mới **không** làm `Issue.updatedAt` đổi, 005b sẽ bỏ sót comment |
| `editedComment` | Số issue có comment `updatedAt` > `Issue.updatedAt` (sửa comment không đẩy mốc). Khác 0 → 005b không thấy được comment bị sửa; chấp nhận được vì sửa không báo |
| `detailMs` | Thời gian lấy chi tiết |

Lỗi: `github-check FAIL <mã>`; exit 2 = đầu vào sai (`usage`, `gh_host_unset`), exit 1 = `github:<reason>` (theo `GitHubFailure`) hoặc `internal`. Không in stderr của `gh` (có thể chứa hostname, owner); `--raw` in thêm stderr gốc ra stderr để người dùng tự đọc, không gõ lại.

### Dòng mới của `diagnose` (bước 1, làm trước khi viết adapter)
Chạy cùng `--owner/--number` như hiện có, sau các dòng `filter …`. Chỉ in số đếm và mã.

| Dòng | Đo gì | Quyết định gì |
|---|---|---|
| `item scan` | Quét toàn bộ item chỉ với `content{… on Issue{id updatedAt}}`: `pages=3 items=286 issues=… ms=…` | Thời gian mỗi chu kỳ → chu kỳ poll mặc định của 005b |
| `gql stdin` | Một query nhỏ gửi bằng `gh api graphql --input -` (JSON qua stdin): `OK` / mã lỗi | `OK` → adapter dùng stdin; không thì quay về `-f query=… -F …` như `diagnose` đang dùng (đã chạy được) và danh sách id đi bằng biến kiểu mảng hoặc alias |
| `comments` | `nodes(ids:)` cho mọi issue, lô 25, `comments(last:1){totalCount nodes{createdAt updatedAt}}`: `issues=… withComments=… maxComments=… over100=… newerComment=… editedComment=… batchMs=…` | `newerComment` = 0 xác nhận giả định cốt lõi (comment mới đẩy `Issue.updatedAt`); `over100` cho biết có cần phân trang comment; `batchMs` để chọn `DETAIL_BATCH` |
| `gql partial` | `nodes(ids: [<id thật>, <id giả hợp lệ về cú pháp>])`: `exit=<mã> stdoutJson=yes|no data=<số node không null>` | Cách adapter xử lý lỗi một phần (xem "Gọi gh") |

Phần tính toán thuần (đếm, so mốc) đặt trong `scripts/diagnose/checks.mjs`, có test trong `checks.test.ts`. Hướng dẫn đọc thêm vào `docs/spikes/diagnose.md`.

## Acceptance criteria

Không có UI → không có e2e. Khoá bằng Vitest: unit (logic thuần), adapter mức process (`GhCliGateway` + `fake-gh.mjs`), và lệnh `github-check` chạy trong process với fake `gh`.

```gherkin
Scenario: AC-1 Quét toàn bộ board, mốc là Issue.updatedAt
  Given fake gh có một project 250 item là Issue, mỗi item có item.updatedAt khác Issue.updatedAt
  When gọi scanProject(project)
  Then nhận đúng 250 ProjectIssueStamp, mỗi nodeId một lần
  And updatedAt của mỗi stamp bằng Issue.updatedAt, không bằng item.updatedAt
  And pages = 3 và fake gh nhận 3 lần gọi, lần 2 và 3 mang cursor của trang trước

Scenario: AC-2 Bỏ qua pull request, draft issue và item không có quyền
  Given board có 3 Issue, 2 PullRequest, 1 DraftIssue và 1 item content = null
  When gọi scanProject(project)
  Then issues có 3 mục
  And skipped = { pullRequest: 2, draftIssue: 1, inaccessible: 1 }

Scenario: AC-3 Chi tiết issue giữ nguyên tiếng Nhật, code block, link
  Given issue "I_1" có title tiếng Nhật, body có code block ```ts```, link markdown, @mention và emoji
  And có 2 comment, một của tài khoản đã xoá (author null)
  When gọi fetchIssueDetails(["I_1"])
  Then snapshot có repo "owner/name", number, url, assignees, updatedAt đúng fixture
  And title, body, body của từng comment giống fixture từng byte (UTF-8)
  And comment sắp theo createdAt tăng dần, comment của tài khoản đã xoá có author null

Scenario: AC-4 Issue hơn 100 comment được lấy đủ
  Given issue "I_2" có 230 comment
  When gọi fetchIssueDetails(["I_2"])
  Then snapshot có đủ 230 comment, đúng thứ tự, không trùng nodeId
  And fake gh nhận 1 lần gọi nodes(ids) và 2 lần gọi thêm có cursor comment

Scenario: AC-5 Lô id lớn được chia theo DETAIL_BATCH
  Given 60 issue tồn tại và DETAIL_BATCH = 25
  When gọi fetchIssueDetails với 60 id
  Then fake gh nhận 3 lần gọi nodes(ids) với 25, 25, 10 id
  And kết quả có đủ 60 snapshot, mỗi nodeId một lần
  And fetchIssueDetails([]) không gọi gh

Scenario: AC-6 Id không còn tồn tại không làm hỏng cả lô
  Given fake gh trả data.nodes = [issue I_1, null] kèm errors "Could not resolve to a node" và thoát mã 1 (chế độ partial)
  When gọi fetchIssueDetails(["I_1", "I_gone"])
  Then issues có snapshot của I_1
  And missing = ["I_gone"]

Scenario Outline: AC-7 Lỗi gh được phân loại, không lộ dữ liệu
  Given fake gh ở chế độ <mode>
  When gọi scanProject(project)
  Then ném GitHubFailure với reason <reason>
  And message và detail không chứa owner, hostname, id hay nội dung của fixture

  Examples:
    | mode                                   | reason                  |
    | lệnh gh không tồn tại (ENOENT)         | gh_not_found            |
    | stderr "gh auth login", exit 4         | not_authenticated       |
    | stderr INSUFFICIENT_SCOPES read:project| scope_missing           |
    | data.organization.projectV2 = null     | project_not_found       |
    | stderr "Could not resolve to an Organization" | project_not_found |
    | stderr "projectV2 doesn't exist on type" | projects_v2_unsupported |
    | stderr "dial tcp: … timeout" / x509    | network                 |
    | treo quá timeout                       | timeout                 |
    | exit 1, stderr lạ, stdout rỗng         | process_failed          |
    | stdout không phải JSON                 | bad_output              |
    | stdout JSON sai shape                  | bad_output              |
    | stdout vượt giới hạn                   | bad_output              |

Scenario: AC-8 Gọi gh an toàn
  Given fake gh ghi lại argv, stdin và biến môi trường nó nhận
  And process cha có GH_HOST = "ghes.example.test"
  When gọi scanProject({ owner: "o\"; drop", ownerType: "org", number: 7 }) rồi fetchIssueDetails(["I_1"])
  Then argv chỉ gồm "api", "graphql", "--input", "-" (sau argsPrefix)
  And stdin là JSON có query và variables; owner, number, cursor, ids nằm trong variables, chuỗi query không chứa owner
  And fake gh nhận GH_HOST = "ghes.example.test" và GH_PROMPT_DISABLED = "1"
  And ownerType "user" dùng trường user(login:), "org" dùng organization(login:)

Scenario: AC-9 FakeGitHub và GhCliGateway cùng hợp đồng
  Given một bộ fixture dùng chung (board có Issue, PR, draft; issue có comment tiếng Nhật; một id không còn)
  When chạy cùng bộ test hợp đồng trên FakeGitHub và trên GhCliGateway + fake gh
  Then hai adapter trả cùng ProjectScan (issues, skipped) và cùng IssueDetails (issues, missing)

Scenario: AC-10 github-check in một dòng số đếm
  Given GH_HOST được đặt và fake gh có board 286 item (278 Issue, 5 PR, 3 draft), 23 issue đổi trong 7 ngày, tổng 140 comment tiếng Nhật
  When chạy github-check --owner acme --number 3
  Then stdout chỉ có một dòng "github-check OK host=GH_HOST items=286 issues=278 skipped=pr:5,draft:3,noaccess:0 pages=3 … recent=23 details=23 missing=0 … comments=140 …"
  And jaChars > 0, newerComment và editedComment đúng theo fixture
  And exit code 0

Scenario: AC-11 github-check giới hạn số issue lấy chi tiết
  Given 80 issue đổi trong 7 ngày
  When chạy github-check --owner acme --number 3 --max-details 30
  Then recent=80 details=30, 30 issue được chọn là 30 issue có Issue.updatedAt mới nhất

Scenario Outline: AC-12 github-check báo lỗi bằng mã
  Given <điều kiện>
  When chạy github-check <tham số>
  Then dòng cuối là "github-check FAIL <mã>" và exit code <exit>

  Examples:
    | điều kiện                     | tham số                       | mã                       | exit |
    | thiếu --number                | --owner acme                  | usage                    | 2    |
    | --days 0                      | --owner acme --number 3 --days 0 | usage                 | 2    |
    | GH_HOST chưa đặt              | --owner acme --number 3       | gh_host_unset            | 2    |
    | fake gh chế độ auth           | --owner acme --number 3       | github:not_authenticated | 1    |
    | fake gh chế độ scope          | --owner acme --number 3       | github:scope_missing     | 1    |
    | fake gh chế độ project null   | --owner acme --number 3       | github:project_not_found | 1    |

Scenario: AC-13 github-check không in dữ liệu
  Given fixture chứa các chuỗi đánh dấu trong owner, hostname, repo, nodeId, title, body, comment, login
  When chạy github-check ở chế độ OK và ở mọi chế độ lỗi của AC-12
  Then stdout và stderr (không có --raw) không chứa chuỗi đánh dấu nào

Scenario: AC-14 Phần tính toán của dòng diagnose mới
  Given danh sách issue mẫu có comments.totalCount, createdAt/updatedAt của comment cuối và Issue.updatedAt
  When gọi các hàm thuần trong checks.mjs
  Then đếm đúng withComments, maxComments, over100, newerComment, editedComment
  And phân loại kết quả gql partial đúng cho (exit 1 + stdout JSON có data), (exit 1 + stdout rỗng), (exit 0)
```

| AC | Khoá bằng | File |
|---|---|---|
| AC-1 … AC-8 | adapter mức process: `GhCliGateway` + `fake-gh.mjs` | `apps/app/src/contexts/tracking/infrastructure/gh-cli/gh-cli-gateway.test.ts` |
| AC-7 (phần phân loại thuần) | unit | `apps/app/src/contexts/tracking/infrastructure/gh-cli/gh-failure.test.ts` |
| AC-9 | contract test chung, chạy cho cả hai adapter | `apps/app/src/shared/ports/github-gateway.contract.ts` + `apps/app/src/test-harness/fake-github.test.ts` + `gh-cli-gateway.test.ts` |
| AC-10 … AC-13 | unit trong process: `runGithubCheck({ argv, env, stdout, stderr, gateway factory })` với `GhCliGateway` + fake gh thật | `apps/app/src/cli/github-check/run-github-check.test.ts` |
| AC-13 (một test) | process: spawn đúng lệnh `pnpm -s github-check` / `tsx …/main.ts` với fake gh | `apps/app/src/cli/github-check/github-check.process.test.ts` |
| AC-14 | unit | `scripts/diagnose/checks.test.ts` |

Kiểm trên máy thật (ngoài `pnpm verify`, người dùng gõ lại dòng kết quả): sau bước 1 chạy `pnpm diagnose --owner … --number …` (4 dòng mới); sau khi xong chạy `pnpm -s github-check --owner … --number …`. Kết quả ghi vào `docs/spikes/projects-v2-polling.md`.

## Tác động domain
- Thuật ngữ mới (→ `ubiquitous-language.md`, đã thêm): `ProjectScan`, `ProjectIssueStamp`, `IssueDetails`, `GitHubFailure`, `GhCliGateway`. Từ nháp cho 005b chưa thêm (chốt ở 005b).
- Aggregate / invariant / event: không đổi ở 005a. Ghi chú cho 005b trong `bounded-contexts/tracking.md`: so mốc theo từng issue (`Issue.ghUpdatedAt`) để thấy cả issue cũ mới được thêm vào board.
- Port đổi: `GitHubGateway.fetchUpdatedIssues(project, since)` → `scanProject(project)` + `fetchIssueDetails(nodeIds)`; `GitHubIssueSnapshot` thêm `comments`. Đã cập nhật `bounded-contexts/tracking.md`.
- ADR: **ADR-0010 (Proposed)** — đọc Projects v2 qua `gh api graphql` hai pha, query qua stdin, xử lý lỗi một phần.

## Việc dời từ 003b / 004: thuộc đâu
| Việc | Thuộc | Lý do |
|---|---|---|
| Lắp `openAppStorage` + `dataDir` vào nhánh adapter thật | 005b | Nhánh thật chỉ có ý nghĩa khi có poller để chạy |
| Lắp `buildRealTranslator` vào nhánh thật | 005b | `Deps.translator` bắt buộc; nhưng chưa ai gọi dịch cho tới 006 |
| Dòng lỗi `StorageError` của `main.ts` có đường dẫn DB + hàm format có unit test | 005b | Đi cùng nhánh thật (chế độ fake là `:memory:`). Đề xuất: đường dẫn nằm ở **dòng riêng** (`[storage] db=<path>`) để dòng mã gõ lại được mà không lộ tên người dùng trong đường dẫn |
| Dọn thư mục `ghit-ai-*` sót | **không phải 005** → 006 hoặc 020 | 005 không gọi Claude; thư mục chỉ dồn lại khi app dịch nền (006) chạy lâu dài (020). `tmpLeft` của 003b vẫn đang 0 |
| Chuyển cấu hình Claude CLI ra khỏi thư mục repo | **không phải 005** → 021 | Phải đổi đồng thời mặc định của `diagnose`, `translate-issue` và server; 021 là story hướng dẫn cài đặt/file cấu hình. 005b chỉ cần biết chỗ đọc (Câu hỏi 005b-3) |

## Ranh giới với 006 và 007 (cho 005b)
- 005b **không dịch, không có hàng đợi, không toast.** Poll xong, Tracking lưu trạng thái (issue, nội dung + hash, mốc từng issue) và phát domain event: `IssueDiscovered { issueId, projectId }` và `ContentChanged { issueId, contentIds, reason: "new_issue" | "new_comment" | "edited" }`.
- 006 nghe `ContentChanged` → tạo `TranslationJob` (gộp theo issue). 007/014 chỉ báo cho `new_issue`/`new_comment`, không có bên nghe nào báo cho `edited`.
- "Dịch lại nhưng không báo" ở 005b thể hiện bằng: `ContentChanged` có `reason: "edited"` và **không** có `IssueDiscovered`; khoá bằng unit test của `PollCycle`. Dịch thật xảy ra khi 006 có. Dòng log `[poll]` đếm riêng `edited=`.
- Event trước khi 006 có: không bên nào nghe, nên mất; trạng thái Tracking vẫn lưu đủ. Cách chống mất event sau khi 006 có (handler đồng bộ trong cùng transaction SQLite hay bảng outbox) là quyết định của 005b (Câu hỏi 005b-1).

## Ngoài phạm vi
- Mọi thứ của 005b (mục cuối) cho tới khi được phân tích riêng.
- Lọc `items(query: "updated:…")` phía server: spike S0.2 kết luận không được làm nguồn duy nhất; chỉ thu hẹp được mức ngày; GHES tắt rate limit nên không cần.
- Pull request trên board (vision chỉ nói issue), draft issue: chỉ đếm.
- Item bị archive trên board: theo mặc định của `items` (Cần kiểm chứng nếu sau này thiếu issue).
- Issue bị xoá khỏi board / bị xoá hẳn: 005a chỉ báo `missing`; xử lý ở 005b.
- Phát hiện assign / mention (014). Label, milestone, field của Project.

## Quyết định (GATE 1, 2026-11-27)
- [x] 1. **Tách:** làm 005a trước; 005b là dòng riêng trong roadmap M2 (phụ thuộc 005a, 004); 009 và 013 phụ thuộc 005b.
- [x] 2. **`diagnose` trước:** user chạy 4 dòng mới trên máy thật ngay sau bước 1. Kế hoạch có **điểm dừng** sau bước 1: chờ số đo, chốt `DETAIL_BATCH`, cách truyền query (`--input -` hay `-f`) và xử lý lỗi một phần trước khi viết adapter. Nếu `newerComment > 0` thì báo user, xem lại cách 005b phát hiện comment mới.
- [x] 3. **`GH_HOST` bắt buộc:** `github-check` báo `FAIL gh_host_unset` (exit 2); nhánh thật của app (005b) theo cùng quy tắc.
- [x] 4. **Lệnh:** `pnpm -s github-check --owner --number [--owner-type user] [--days] [--max-details] [--raw]`, giữ như đề xuất.
- [x] 5. **Pull request trên board:** chỉ đếm vào `skipped`, không theo dõi. Draft issue và item không có quyền cũng vậy.
- [x] 6. **Không có e2e:** khoá bằng Vitest + `fake-gh.mjs` mức process + contract test; bước `e2e-writer` bỏ qua.

## Câu hỏi mở
Không còn câu hỏi chặn 005a. Các điểm "Cần kiểm chứng" (`--input -`, lỗi một phần, `newerComment`) được trả lời bằng số đo ở điểm dừng sau bước 1.

## Kế hoạch implement 005a
(Implementer làm theo thứ tự, mỗi bước một commit, mỗi bước có test xanh.)
1. **`diagnose`:** thêm `item scan`, `gql stdin`, `comments`, `gql partial` vào `scripts/diagnose/index.mjs`; hàm thuần trong `checks.mjs` + test (AC-14); thêm dòng vào bảng đọc kết quả của `docs/spikes/diagnose.md`.    **ĐIỂM DỪNG:** implementer dừng sau commit bước 1. Người dùng chạy `pnpm diagnose --owner … --number …` trên máy thật và gõ lại 4 dòng mới; orchestrator ghi vào `docs/spikes/projects-v2-polling.md` (Lần 4). Trước khi làm tiếp bước 2, chốt và ghi vào Workflow log + mục Thiết kế: (a) `DETAIL_BATCH` theo `batchMs`; (b) cách truyền query theo `gql stdin` (`--input -` hay quay về `-f`/`-F`); (c) xử lý lỗi một phần theo `gql partial` (dùng `data` từ stdout, hay chia nhỏ lô để cô lập id hỏng; khi đó sửa AC-6 và báo user); (d) có cần phân trang comment theo `over100` (AC-4 vẫn giữ). `newerComment > 0` → báo user trước khi làm tiếp.
2. **Port:** đổi `shared/ports/github-gateway.port.ts` (kiểu ở mục Thiết kế, `GitHubFailure`); viết contract test `github-gateway.contract.ts`; cập nhật `FakeGitHub` + `routes.ts`/`Harness.seedIssues` theo hình dạng mới; contract xanh với `FakeGitHub` (AC-9 phía fake). `e2e/specs/smoke.spec.ts` không đổi.
3. **`fake-gh.mjs`** trong `contexts/tracking/infrastructure/gh-cli/testing/`: đọc fixture từ biến môi trường, nhận diện query qua `operationName` trong body, chế độ ok/partial/auth/scope/project-null/unsupported/network/hang/fail/garbage/bad-shape/huge, ghi argv/stdin/env ra file. Test riêng cho fake.
4. **`runGhCli` + phân loại lỗi** (`gh-cli-runner.ts`, `gh-failure.ts`): spawn không shell, stdin JSON, timeout + kill, giới hạn stdout, `ENOENT`; test AC-7, AC-8.
5. **`GhCliGateway`**: query quét + phân trang (AC-1, AC-2), chi tiết theo lô + phân trang comment + lỗi một phần (AC-3 … AC-6), zod cho shape; chạy contract test với fake gh (AC-9).
6. **`github-check`**: `run-github-check.ts` (parse tham số, chọn issue gần đây, đếm, `formatStatusLine`), `main.ts`, root script `github-check` trong `package.json`; test AC-10 … AC-13.
7. **Docs:** mục "Kiểm adapter GitHub (005a)" trong `docs/spikes/diagnose.md` (cách chạy, bảng trường, chỉ gõ lại dòng trạng thái); thêm lệnh vào `CLAUDE.md`; ADR-0010 sang Accepted sau khi đã chốt các điểm ở điểm dừng và user duyệt ở cuối story.

---

## Phần sau: 005b — Logic poller + lắp nhánh adapter thật (nháp, phân tích lại khi 005a xong)

### Phạm vi dự kiến
- Domain Tracking thuần: `TrackedProject` (một project từ cấu hình), `Issue` với `ghUpdatedAt` (mốc của **từng** issue, luôn là `Issue.updatedAt`), `Content` (`kind`, `ghId`, `hash`, `ghCreatedAt`); `lastSeen` của project = `Issue.updatedAt` lớn nhất đã xử lý (cho 009/018).
- `PollCycle` (application): `scanProject` → so với trạng thái đã lưu → `fetchIssueDetails` cho issue mới hoặc có `Issue.updatedAt` lớn hơn mốc đã lưu → phân loại → lưu + phát event trong một transaction.
- Vòng lặp: chu kỳ theo cấu hình (mặc định theo số đo `item scan`), không chạy chồng hai chu kỳ, lỗi một chu kỳ không dừng vòng lặp.
- Migration `0003-tracking.sql` (project, issue, content), repository SQLite trong `contexts/tracking/infrastructure/`.
- Nhánh adapter thật của `buildDeps`: `resolveDataDir` + `openAppStorage(<dataDir>/app.db)`, `buildRealTranslator`, `GhCliGateway`, notifier không làm gì cho tới 007, `systemClock`; khởi động vòng lặp poll.
- `main.ts`: tách `formatStorageError(e, dbPath)` có unit test; dòng mã và dòng đường dẫn riêng.
- Dòng log mỗi chu kỳ chỉ có số đếm: `[poll] OK issues=278 new=1 changed=2 newComments=3 edited=1 missing=0 ms=5200` / `[poll] FAIL github:<reason>`.

### AC nháp
- B1 Lần đầu: chỉ lưu mốc của mọi issue (không lấy chi tiết), không phát event, `lastSeen` = max `Issue.updatedAt`.
- B2 Issue có `nodeId` chưa biết (kể cả `Issue.updatedAt` cũ hơn `lastSeen`, tức issue cũ mới được thêm vào board) → `IssueDiscovered` + `ContentChanged(new_issue)` cho title, body, comment. (Câu hỏi 005b-2)
- B3 Issue đã biết có `Issue.updatedAt` mới hơn, có comment chưa biết với `createdAt` > mốc đã lưu → `ContentChanged(new_comment)` chỉ cho comment đó.
- B4 Title/body đổi (hash khác) → `ContentChanged(edited)`, không có `IssueDiscovered`.
- B5 Comment bị sửa (hash khác, khi thấy được) → `ContentChanged(edited)`.
- B6 Issue mới chỉ có mốc từ lần đầu, lần đầu có thay đổi: comment có `createdAt` ≤ mốc lần đầu không bị coi là mới.
- B7 `Issue.updatedAt` đổi mà nội dung không đổi (label, assign, reaction) → không event, mốc được cập nhật.
- B8 Lỗi `gh` → chu kỳ không đổi trạng thái, không event, chu kỳ sau thử lại; log `FAIL github:<reason>`.
- B9 Issue trong `missing` hoặc biến khỏi board → không event, giữ dữ liệu.
- B10 Restart giữa hai chu kỳ → không phát lại event đã phát, không mất mốc.
- B11 Body rỗng / chỉ có phần giữ nguyên → lưu `Content`, vẫn phát event (006 bỏ đoạn rỗng theo `CachingTranslator`).
- B12 Hai chu kỳ không chạy chồng (chu kỳ chậm hơn chu kỳ poll).
- B13 `formatStorageError` cho từng `reason`, có/không `migration`, `sqliteCode`; đường dẫn ở dòng riêng.
- B14 Nhánh thật: không có `GH_HOST` hoặc thiếu cấu hình project → dừng với dòng lỗi mã (không crash thô).

### Câu hỏi cho 005b (trả lời khi phân tích 005b, ghi ở đây để không quên)
- 005b-1. **Chống mất event khi 006 có:** (a) handler đồng bộ chạy trong cùng transaction SQLite với lúc lưu trạng thái Tracking (đơn giản; `node:sqlite` đồng bộ; lỗi handler làm chu kỳ rollback rồi chu kỳ sau làm lại) hay (b) bảng outbox của Tracking + dispatcher (handler bất đồng bộ được, thêm bảng và trạng thái đã giao). Nghiêng về (a) cho app một người dùng; cần ADR khi chốt.
- 005b-2. Issue cũ (`Issue.updatedAt` cũ) mới được kéo vào board: coi là "issue mới" (báo) hay chỉ lấy mốc như lần đầu? Đề xuất: issue mới, vì với người dùng nó mới xuất hiện trên board.
- 005b-3. Cấu hình project tạm (tới 013) đặt ở đâu: đề xuất `<dataDir>/config.json` (`{ project: { owner, ownerType, number }, pollIntervalMin }`), không mất khi thay zip. Cấu hình Claude CLI của server: tạm đọc `<repo>/config/claude-cli.local.json` như `translate-issue`, chuyển ra ngoài ở 021.
- 005b-4. Issue cũ (chỉ có mốc) có comment mới: 006 dịch cả title + body + comment mới (một lần gọi, cache lo phần trùng) hay chỉ comment? Đề xuất: cả ba (đúng mẫu "cả issue một lần gọi" của 001; title/body đã dịch thì cache trả lại). Khi đó lần đầu lấy chi tiết một issue, 005b lưu title/body làm `Content` và `ContentChanged` mang cả id của chúng, `reason` vẫn là `new_comment`. Chốt cùng 006.

## Workflow log
| Bước | Thời điểm | Kết quả |
|---|---|---|
| 1 Phân tích | 2026-11-27 | Spec draft. Đề xuất tách 005a (gateway + `github-check` + dòng `diagnose`) / 005b (poller + nhánh thật). Viết chi tiết 005a, 005b ở dạng nháp. ADR-0010 Proposed |
| GATE 1 | 2026-11-27 | User duyệt. Tách: 005a làm trước, thư mục đổi thành `005a-github-gateway`, roadmap thêm 005b (phụ thuộc 005a, 004; 009/013 phụ thuộc 005b). Điểm dừng sau bước 1 chờ số đo `diagnose`. `GH_HOST` bắt buộc. Giữ tên/tham số `github-check`. PR chỉ đếm vào `skipped`. Không e2e. Trạng thái approved |
