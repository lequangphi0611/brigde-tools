# 005b — Poller một project (logic, chạy trọn trong container)

- Trạng thái: done (2026-11-27)
- Context: Tracking (domain, `PollCycle`, `PollScheduler`, bảng Tracking); hạ tầng dùng chung (bus event, `UnitOfWork`); chế độ fake của composition root + route `/__test__/poll`
- Cần UI: không

> **Tách ở GATE 1 (2026-11-27).** Bản draft gồm cả logic poller lẫn lắp nhánh adapter thật (32 AC). User chọn tách ngay: **005b** (spec này) là phần kiểm được hoàn toàn trong container; **005c** (`docs/features/005c-real-adapter-wiring/spec.md`) lắp nhánh adapter thật (`config.json`, `GH_HOST`, `openAppStorage` + `dataDir`, `GhCliGateway`, `buildRealTranslator`, `formatStorageError`, `pnpm start`) và bảng kiểm trên Windows thật. Đánh số AC: AC-1…AC-27 giữ nguyên; AC-32 cũ → **AC-28**; AC-28…AC-31 cũ → AC-1…AC-4 của 005c. Code 005b/005c gộp chung PR #11 với 005a.

> Tách từ story 005 (GATE 1 của 005a, 2026-11-27). Nguồn: dòng 005b trong `docs/product/roadmap.md` và mục "Phần sau: 005b" của `docs/features/005a-github-gateway/spec.md` (AC nháp B1–B19, câu hỏi 005b-1…7). Spec này thay bản nháp đó; bảng đối chiếu B → AC ở cuối mục Acceptance criteria.
>
> Dựa trên 005a: port `GitHubGateway` hai pha (`scanProject(project, { statusField })` → `ProjectIssueStamp { nodeId, updatedAt, state, status }`; `fetchIssueDetails(ids)` → `IssueDetails { issues, missing }`), `GhCliGateway`, ADR-0010. Không dựa vào `GhCliGateway.detailStats` (finding 005a, đang sửa song song): mọi số đếm của chu kỳ do `PollCycle` tự đếm.

## User story
Là người dùng theo dõi một board Projects v2 tiếng Nhật trên GHES, tôi muốn app tự quét board theo chu kỳ, nhận ra issue mới và comment mới theo `Issue.updatedAt` của từng issue, lần đầu chỉ lấy mốc (không dồn issue cũ), bỏ qua issue đã đóng, và issue bị sửa thì được đánh dấu để dịch lại mà không báo, để khi hàng đợi dịch (006) và toast (007) có thì mở ra là có bản dịch mà không bị làm phiền. Mỗi chu kỳ cho ra một dòng log `[poll] …` chỉ có mã và số đếm (005c dùng dòng này để kiểm trên máy Windows thật).

## Ràng buộc đã chốt (user, 2026-11-27)
1. Mốc theo dõi là `Issue.updatedAt` (không phải `updatedAt` của project item), so theo **từng issue**. `nodeId` chưa biết = issue mới, kể cả khi `Issue.updatedAt` cũ hơn mọi mốc (issue cũ vừa được kéo vào board) — trả lời câu 005b-2.
2. Lần đầu chạy (project chưa lấy mốc) chỉ lưu mốc, không lấy chi tiết, không phát event.
3. Issue bị sửa (title/body/comment có hash khác) → `ContentChanged(edited)`, không `IssueDiscovered`; dịch lại nhưng không báo (bên báo không nghe `edited`).
4. **Issue đã đóng** = `state = CLOSED` **hoặc** giá trị Status của item thuộc `closedStatuses` của project. Áp dụng mọi chu kỳ: đang đóng thì không lấy chi tiết, không phát event, kể cả có comment mới. Mở lại thì theo dõi bình thường. Theo dõi thủ công issue đóng thuộc 011 / 019 / 006b.
5. 005b **không dịch, không hàng đợi (006), không toast (007)**. Chỉ lưu trạng thái Tracking và phát `IssueDiscovered` / `ContentChanged { reason: new_issue | new_comment | edited }`. Chưa có cờ unlisten issue (006b), nhưng thiết kế để chỗ (mục Thiết kế, "Quyết định theo dõi").

Ràng buộc `GH_HOST` bắt buộc và lắp nhánh adapter thật của bản draft chuyển sang 005c.

## Phạm vi
- **Có:**
  - Domain Tracking thuần: quy tắc close (`CloseRule`, `isIssueClosed`), quyết định theo dõi từng issue (`trackingDecision`), phân loại nội dung (`diffContents`), `ContentId`, hash nội dung.
  - Event `IssueDiscovered`, `ContentChanged` (kiểu ở `shared/events/`), port `DomainEventPublisher` + `UnitOfWork`, adapter `InProcessEventBus` + `SqliteUnitOfWork` (ADR-0011).
  - Migration `0003-tracking.sql` (`tracked_project`, `issue`, `content`), `SqliteTrackingRepository`.
  - `PollCycle` (application): quét → quyết định → lấy chi tiết theo lô → lưu + phát event theo từng issue trong transaction → `PollReport`.
  - `PollScheduler`: chạy ngay khi khởi động, sau đó mỗi `pollIntervalMin` phút tính từ lúc chu kỳ trước xong; không chồng chu kỳ; lỗi không dừng vòng lặp.
  - Dòng log `[poll] …` (chỉ mã và số đếm), `formatPollLine` thuần. `PollScheduler` nhận hàm `log(line)` tiêm vào.
  - Cấu hình project là tham số thuần của `PollCycle` (`PollProjectConfig { owner, ownerType, number, statusField, closedStatuses }`), không đọc file.
  - Chế độ fake: lắp `PollCycle` với `FakeGitHub`, **không** tự chạy vòng lặp; thêm `POST /__test__/poll` (chạy một chu kỳ, trả `PollReport`) và `Harness.runPoll()` cho e2e của 006/007/008.
- **Không:** mọi thứ của 005c (đọc `<dataDir>/config.json`, nhánh adapter thật của `composition-root.ts`, `GH_HOST`, `openAppStorage` + `dataDir`, `GhCliGateway` / `buildRealTranslator` trong app, `formatStorageError`, `main.ts` khởi động/tắt poller, `pnpm start`, kiểm trên Windows thật). Nhánh thật sau 005b vẫn như hiện nay (chưa chạy được). Dịch, hàng đợi, toast, trang issue/inbox. Cờ unlisten issue và theo dõi thủ công issue đóng (006b / 019). Nhiều project, thêm project từ UI (013). Phát hiện assign/mention (014). Xử lý comment bị xoá, issue bị xoá khỏi board ngoài việc giữ nguyên dữ liệu. Event khi issue chuyển đóng/mở. Dọn thư mục `ghit-ai-*`, chuyển cấu hình Claude CLI ra khỏi repo (006/020/021).

## Thiết kế

### Dữ liệu (migration `0003-tracking.sql`)
Tên bảng số ít, snake_case, thời gian TEXT ISO UTC (ADR-0008). Mốc GitHub lưu nguyên chuỗi GitHub trả về, **so sánh bằng `Date.parse`**, không so chuỗi.

| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `tracked_project` | `id` (PK, khoá ổn định suy từ cấu hình: `<ownerType>:<owner>/<number>`), `owner`, `owner_type`, `number`, `baselined_at` (NULL = chưa lấy mốc), `last_polled_at` | Trạng thái chạy của project. Tên field Status, `closedStatuses`, chu kỳ lấy từ cấu hình mỗi lần chạy, không lưu. Đổi owner/number trong cấu hình = project khác = lấy mốc lại |
| `issue` | `id` (PK, GitHub node id), `project_id` (FK), `gh_updated_at`, `closed` (0/1, theo quy tắc close lúc lưu), `contents_loaded` (0/1), `repo`, `number`, `url`, `assignees` (JSON) — ba cột cuối NULL khi chưa lấy chi tiết | `contents_loaded = 0`: **issue chỉ có mốc** (từ lần lấy mốc, hoặc mới vào board lúc đã đóng) |
| `content` | `id` (PK, `ContentId`), `issue_id` (FK), `kind` (`title`/`body`/`comment`), `gh_id` (node id comment; NULL cho title/body), `author`, `text`, `hash` (sha256 hex của `text` nguyên văn), `gh_created_at`, `gh_updated_at` | Text tiếng Nhật lưu nguyên văn (không chuẩn hoá) để 006 dịch, 008 hiển thị |

- `ContentId`: `title:<issueNodeId>`, `body:<issueNodeId>`, `comment:<commentNodeId>` — ổn định qua các chu kỳ và restart.
- `lastSeen` của project không lưu thành cột: là `MAX(gh_updated_at)` của issue thuộc project (đúng nghĩa "lớn nhất đã xử lý" vì issue lỗi không tiến mốc). Repository có hàm đọc cho 009/018.
- Không thêm cột `listening` ở 005b (Quyết định 9).

### Quyết định theo dõi từng issue (domain thuần)
Đầu vào: `ProjectIssueStamp` của lần quét, issue đã lưu (hoặc không có), `CloseRule`, project đã lấy mốc chưa. Đầu ra một trong:

| Điều kiện (theo thứ tự) | Quyết định | Lấy chi tiết | Lưu | Event |
|---|---|---|---|---|
| Project chưa lấy mốc | `baseline` | không | issue chỉ có mốc (`gh_updated_at`, `closed`) | không |
| Issue đóng (theo `CloseRule`), chưa biết | `store_closed` | không | issue chỉ có mốc | không |
| Issue đóng, đã biết | `skip_closed` | không | `gh_updated_at` = max(cũ, mới), `closed = 1` (nội dung đã lưu giữ nguyên, không làm mới) | không |
| Issue mở, chưa biết | `discover` | có | issue + mọi `Content` | `IssueDiscovered` + `ContentChanged(new_issue)` mọi content |
| Issue mở, đã biết, `updatedAt` mới > đã lưu | `refresh` | có | xem "Phân loại nội dung" | tuỳ phân loại |
| Issue mở, đã biết, `updatedAt` mới ≤ đã lưu | `unchanged` | không | chỉ cập nhật `closed = 0` nếu vừa mở lại | không |

- Đây là **chỗ duy nhất** quyết định "có theo dõi issue này không". 006b thêm `listening === false → skip_closed`-tương-đương (cập nhật mốc, không chi tiết, không event); 019 thêm "listen riêng thắng quy tắc close" — cả hai chỉ sửa hàm này (Quyết định 9).
- Chuyển đóng ↔ mở không phát event (Quyết định 5). Trong lúc đóng mốc vẫn tiến, nên comment phát sinh lúc đóng **không** được tính là mới khi mở lại (Quyết định 6).
- `updatedAt` lùi (nhỏ hơn đã lưu) → coi như không đổi, mốc không lùi.
- Phát hiện không dùng `Clock`: chỉ so mốc GitHub với mốc GitHub đã lưu, nên lệch giờ giữa máy và GHES không ảnh hưởng. `Clock` chỉ dùng cho `baselined_at`, `last_polled_at`.

### Quy tắc close
- `CloseRule { statusField: string; closedStatuses: string[] }` từ cấu hình project.
- `closedStatuses` rỗng → gọi `scanProject` với `statusField: null` (không tốn phần query Status), chỉ dùng `state`.
- So tên option: chuẩn hoá NFKC + trim + viết thường cả hai phía (Quyết định 7). `optionId` không dùng ở 005b.
- `ProjectScan.statusField` là `missing` / `not_single_select` mà `closedStatuses` không rỗng → chỉ dùng `state`, dòng `[poll]` thêm `warn=status_field_missing` / `warn=status_field_not_single_select`.

### Phân loại nội dung (`refresh`)
Mốc so sánh `M` = `gh_updated_at` đã lưu **trước** chu kỳ này.
- Comment có `nodeId` chưa lưu và `createdAt > M` → **mới** → `ContentChanged(new_comment)`.
- Comment có `nodeId` chưa lưu và `createdAt ≤ M` → lưu im lặng (comment cũ của issue chỉ có mốc, hoặc comment lúc đang đóng).
- Issue chỉ có mốc (`contents_loaded = 0`): title/body lưu im lặng lần đầu, không bao giờ coi là `edited` (Quyết định 8).
- Content đã lưu có hash khác → `ContentChanged(edited)` (title, body, comment). Cập nhật `text`, `hash`, `gh_updated_at`.
- Content đã lưu không còn trong snapshot (comment bị xoá) → giữ nguyên hàng, không event.
- Một issue một chu kỳ: tối đa một `ContentChanged` mỗi `reason`, thứ tự `new_comment` rồi `edited`. `contentIds` theo thứ tự title, body, comment theo `createdAt`.
- `ContentChanged(new_comment)` chỉ mang id comment mới; 006 tự quyết có kèm title/body làm ngữ cảnh khi dịch (Quyết định 4).

### Event (`apps/app/src/shared/events/`, ADR-0011)
```ts
type ContentChangeReason = "new_issue" | "new_comment" | "edited";
interface IssueDiscovered { type: "IssueDiscovered"; projectId: string; issueId: string; occurredAt: string }
interface ContentChanged  { type: "ContentChanged";  projectId: string; issueId: string; contentIds: string[]; reason: ContentChangeReason; occurredAt: string }
```
- Chỉ ID, `reason`, `occurredAt` (từ `Clock`); không có text.
- 005b chưa có bên nghe. Event vẫn đi qua `InProcessEventBus` trong transaction; test dùng bus ghi lại.

### `PollCycle`
1. Đọc/khởi tạo `tracked_project` theo `PollProjectConfig` được tiêm vào.
2. `scanProject` (lỗi → `FAIL github:<reason>`, không ghi gì).
3. Với mỗi stamp, `trackingDecision`. Sắp các issue cần xử lý theo `Issue.updatedAt` tăng dần (rồi `nodeId`).
4. Gom id của `discover` + `refresh` → **một** lời gọi `fetchIssueDetails(ids)` (adapter tự chia lô 25). Lỗi → `FAIL github:<reason>`, không ghi gì (kể cả các issue không cần chi tiết, để chu kỳ là "tất cả hoặc không" ở phần GitHub).
5. Project chưa lấy mốc: một transaction lưu mọi issue chỉ có mốc + `baselined_at`.
   Ngược lại: mỗi issue một `UnitOfWork.run` (lưu issue + content + `publish(events)`). Lỗi trong transaction của một issue → rollback issue đó, đếm `failed`, xử lý tiếp issue khác. Issue trong `missing`: không lưu, không event, mốc không tiến, đếm `missing`. Các quyết định không cần chi tiết (`store_closed`, `skip_closed`, `unchanged` có mở lại) cũng mỗi issue một transaction.
6. Cập nhật `last_polled_at`. Trả `PollReport`.

Không `await` trong transaction (`node:sqlite` đồng bộ).

### Vòng lặp (`PollScheduler`)
- `start()`: chạy một chu kỳ ngay, xong (thành công hay lỗi) thì hẹn chu kỳ sau sau `pollIntervalMin` phút. Không bao giờ hai chu kỳ cùng lúc (hẹn giờ chỉ đặt sau khi chu kỳ trước kết thúc).
- Mọi lỗi (kể cả exception không phải `GitHubFailure`) được bắt, in `[poll] FAIL …`, vòng lặp tiếp tục.
- `stop()`: huỷ hẹn giờ; chu kỳ đang chạy bị bỏ dở được (transaction theo từng issue nên không có trạng thái nửa vời).
- Hàm hẹn giờ, `pollIntervalMin` và hàm `log(line)` được tiêm vào (test không chờ thật). 005b chưa lắp `PollScheduler` vào đâu (chế độ fake không tự chạy); 005c lắp vào nhánh thật.

### Dòng log `[poll]`
Một dòng mỗi chu kỳ ra stdout. Không bao giờ in owner, số project, hostname, node id, tên field, tên Status, title hay nội dung.
```
[poll] BASELINE issues=286 closed=263 skipped=pr:0,draft:0,noaccess:0 pages=3 ms=1900
[poll] OK issues=286 closed=263 details=2 missing=0 new=1 newComments=1 edited=0 closedChanged=1 failed=0 pages=3 ms=2600
[poll] PARTIAL issues=286 closed=263 details=2 missing=0 new=0 newComments=1 edited=0 closedChanged=0 failed=1 pages=3 ms=2500
[poll] FAIL github:not_authenticated ms=800
[poll] FAIL storage sqlite=5
[poll] FAIL internal
```

| Trường | Ý nghĩa |
|---|---|
| `issues`, `closed`, `skipped`, `pages` | Từ `ProjectScan`; `closed` = số issue đóng theo `CloseRule` |
| `details`, `missing` | Số id gửi `fetchIssueDetails`; số id không còn đọc được |
| `new` | Số `IssueDiscovered` |
| `newComments` | Số comment trong các `ContentChanged(new_comment)` |
| `edited` | Số content trong các `ContentChanged(edited)` |
| `closedChanged` | Số issue bị quy tắc close bỏ qua mà lẽ ra phải xem (đã biết có `updatedAt` mới, hoặc mới vào board) |
| `failed` | Số issue rollback vì lỗi trong transaction; > 0 → chữ đầu là `PARTIAL` |
| `warn=` | Chỉ có khi Status field không dùng được (mục Quy tắc close) |
| `ms` | Thời gian cả chu kỳ |

### Chế độ fake
- Project cố định `{ owner: "fake", ownerType: "org", number: 1, statusField: "Status", closedStatuses: [] }`.
- Không tự chạy `PollScheduler` (e2e tất định). `POST /__test__/poll` chạy một `PollCycle` và trả `PollReport` (JSON). `/__test__/reset` xoá cả bảng Tracking → chu kỳ kế tiếp là lấy mốc.
- Cách dùng cho e2e sau này: `seedIssues` → `runPoll()` (lấy mốc) → `seedIssues` thêm → `runPoll()` (phát hiện).

## Acceptance criteria
Không có e2e (Quyết định 11): 005b không đổi UI, không bắn toast; mọi hành vi khoá bằng Vitest với `FakeGitHub` + SQLite `:memory:` + `ControllableClock` + bus ghi lại. Trừ khi ghi khác, "chu kỳ" = `PollCycle.run()` trên cùng một DB; project có `closedStatuses = []`.

```gherkin
Scenario: AC-1 Lần đầu chỉ lấy mốc
  Given project chưa lấy mốc và board có issue A (mở, updatedAt 10:00), B (mở, 11:00), C (state CLOSED, 09:00)
  When chạy một chu kỳ
  Then không gọi fetchIssueDetails và không có event nào
  And A, B, C được lưu là issue chỉ có mốc với gh_updated_at và closed đúng
  And lastSeen của project là 11:00 và baselined_at là giờ của Clock
  And PollReport là BASELINE issues=3 closed=1

Scenario: AC-2 Lần đầu board rỗng, issue thêm sau là mới
  Given project chưa lấy mốc và board rỗng
  When chạy một chu kỳ
  Then project được đánh dấu đã lấy mốc với 0 issue
  When board có thêm issue A đang mở rồi chạy chu kỳ tiếp
  Then có IssueDiscovered(A) và ContentChanged(new_issue) của A

Scenario: AC-3 Issue mới đang mở
  Given project đã lấy mốc
  And board có thêm issue N (mở) với title, body và 2 comment
  When chạy một chu kỳ
  Then fetchIssueDetails được gọi đúng một lần với [N]
  And có đúng một IssueDiscovered { issueId: N } và một ContentChanged { reason: new_issue, contentIds: [title:N, body:N, comment:c1, comment:c2] }
  And event không chứa title, body hay text comment
  And N được lưu kèm 4 Content (text nguyên văn, hash sha256) và contents_loaded = 1
  And PollReport có new=1 details=1

Scenario: AC-4 Issue cũ vừa được kéo vào board là issue mới
  Given project đã lấy mốc với lastSeen 2026-11-20
  And board có thêm issue O (mở) có updatedAt 2025-01-01, nodeId chưa biết
  When chạy một chu kỳ
  Then có IssueDiscovered(O) và ContentChanged(new_issue) của O

Scenario: AC-5 Không có thay đổi thì không lấy chi tiết
  Given project đã lấy mốc, issue A đã lưu với gh_updated_at 10:00
  When chu kỳ quét thấy A có updatedAt 10:00 (hoặc 09:00, tức mốc lùi)
  Then không gọi fetchIssueDetails, không event, gh_updated_at của A vẫn 10:00

Scenario: AC-6 Comment mới trên issue đã có nội dung
  Given issue A đã lưu kèm nội dung, gh_updated_at 10:00, có comment c1
  And trên GitHub A có comment c2 (createdAt 10:30) và updatedAt 10:30
  When chạy một chu kỳ
  Then có đúng một ContentChanged { issueId: A, reason: new_comment, contentIds: [comment:c2] }
  And không có IssueDiscovered
  And c2 được lưu, gh_updated_at của A là 10:30
  And PollReport có newComments=1 new=0

Scenario: AC-7 Issue chỉ có mốc có comment mới
  Given issue A chỉ có mốc (từ lần lấy mốc) với gh_updated_at 10:00
  And trên GitHub A có c1 (createdAt 09:00), c2 (createdAt 10:00), c3 (createdAt 10:30), updatedAt 10:30
  When chạy một chu kỳ
  Then có đúng một ContentChanged { reason: new_comment, contentIds: [comment:c3] }
  And title, body, c1, c2 được lưu im lặng (không nằm trong event nào), contents_loaded = 1

Scenario: AC-8 Issue chỉ có mốc đổi mà không có comment mới
  Given issue A chỉ có mốc với gh_updated_at 10:00
  And trên GitHub A có updatedAt 10:30 (title đã sửa hoặc đổi label) và không có comment createdAt > 10:00
  When chạy một chu kỳ
  Then không có event nào
  And title, body, comment của A được lưu, gh_updated_at là 10:30

Scenario: AC-9 Title hoặc body bị sửa
  Given issue A đã lưu kèm nội dung
  And trên GitHub body của A đổi (title giữ nguyên), updatedAt mới hơn
  When chạy một chu kỳ
  Then có đúng một ContentChanged { reason: edited, contentIds: [body:A] }
  And không có IssueDiscovered
  And text và hash của body:A được cập nhật
  And PollReport có edited=1

Scenario: AC-10 Comment bị sửa (khi updatedAt của issue đổi)
  Given issue A đã lưu kèm comment c1
  And trên GitHub text của c1 đổi và updatedAt của A mới hơn
  When chạy một chu kỳ
  Then có ContentChanged { reason: edited, contentIds: [comment:c1] }

Scenario: AC-11 Comment mới và body sửa trong cùng chu kỳ
  Given issue A đã lưu kèm nội dung
  And trên GitHub body đổi và có comment mới c2 (createdAt > mốc đã lưu)
  When chạy một chu kỳ
  Then có đúng hai ContentChanged của A, theo thứ tự: new_comment [comment:c2] rồi edited [body:A]

Scenario: AC-12 updatedAt đổi mà nội dung không đổi, hoặc comment bị xoá
  Given issue A đã lưu kèm comment c1, c2
  And trên GitHub updatedAt của A mới hơn, title/body/c1 không đổi, c2 không còn
  When chạy một chu kỳ
  Then không có event nào
  And gh_updated_at của A được cập nhật, hàng content của c2 vẫn còn

Scenario: AC-13 Nội dung rỗng và tiếng Nhật đặc biệt được lưu nguyên văn
  Given issue mới N có body rỗng và một comment tiếng Nhật chứa code block, inline code, link Markdown, @mention, emoji và CRLF
  When chạy một chu kỳ
  Then body:N được lưu với text "" và có trong ContentChanged(new_issue)
  And text comment được lưu đúng từng byte như snapshot (không NFKC, không trim, không đổi xuống dòng)
  When chu kỳ sau GitHub trả cùng text và updatedAt mới hơn
  Then không có ContentChanged(edited)
  When chu kỳ sau nữa text chỉ khác một khoảng trắng cuối dòng
  Then có ContentChanged(edited) cho comment đó

Scenario: AC-14 Lỗi gh khi quét
  Given project đã lấy mốc
  And scanProject ném GitHubFailure("not_authenticated")
  When chạy một chu kỳ
  Then không có thay đổi nào trong DB (kể cả last_polled_at) và không có event
  And PollReport là FAIL github:not_authenticated
  When chu kỳ sau quét thành công
  Then thay đổi được phát hiện như bình thường, mỗi thay đổi đúng một lần
  And nếu project chưa lấy mốc thì chu kỳ thành công đầu tiên vẫn là BASELINE

Scenario: AC-15 Lỗi gh khi lấy chi tiết
  Given project đã lấy mốc, issue mới N và issue A có comment mới
  And một issue đóng D có updatedAt mới
  And fetchIssueDetails ném GitHubFailure("timeout")
  When chạy một chu kỳ
  Then không lưu gì (kể cả mốc của D) và không có event
  And PollReport là FAIL github:timeout
  When chu kỳ sau fetchIssueDetails thành công
  Then có IssueDiscovered(N), ContentChanged(new_issue) của N và ContentChanged(new_comment) của A, mỗi cái đúng một lần

Scenario: AC-16 Issue không còn đọc được (missing)
  Given project đã lấy mốc, issue A đã lưu có updatedAt mới, issue N mới
  And fetchIssueDetails trả A và N trong missing
  When chạy một chu kỳ
  Then không event, A giữ nguyên dữ liệu và gh_updated_at cũ, N không được lưu
  And PollReport có missing=2 failed=0 và chữ đầu là OK

Scenario: AC-17 Issue biến khỏi board rồi quay lại
  Given issue A đã lưu kèm nội dung
  When chu kỳ quét không còn thấy A
  Then không event, dữ liệu của A giữ nguyên
  When A quay lại board với updatedAt mới hơn và một comment mới
  Then A không được coi là issue mới (không IssueDiscovered), chỉ có ContentChanged(new_comment)

Scenario: AC-18 Issue đóng theo state có comment mới
  Given issue A đã lưu kèm nội dung, gh_updated_at 10:00
  And trên GitHub A có state CLOSED, comment mới c2 và updatedAt 10:30
  When chạy một chu kỳ
  Then không gọi fetchIssueDetails cho A và không có event
  And A được lưu closed = 1, gh_updated_at 10:30
  And PollReport có closedChanged=1 newComments=0

Scenario: AC-19 Issue đóng theo Status
  Given project có closedStatuses ["完了", " Done "]
  And scanProject được gọi với statusField "Status"
  And issue A đang mở theo state, Status của item là "done", có comment mới
  And issue B đang mở theo state, Status "ｸﾛｰｽﾞ" không thuộc danh sách, có comment mới
  When chạy một chu kỳ
  Then A bị bỏ qua như issue đóng (không chi tiết, không event, closed = 1)
  And B được lấy chi tiết và có ContentChanged(new_comment)
  And so khớp dùng NFKC + trim + không phân biệt hoa thường

Scenario: AC-20 Issue mới vào board mà đã đóng
  Given project đã lấy mốc
  And board có thêm issue N có state CLOSED (hoặc Status thuộc closedStatuses)
  When chạy một chu kỳ
  Then không gọi fetchIssueDetails, không IssueDiscovered, không ContentChanged
  And N được lưu là issue chỉ có mốc, closed = 1
  And PollReport có closedChanged=1 new=0

Scenario: AC-21 Issue mở lại
  Given issue A đã lưu, đang đóng, gh_updated_at 10:00 (đã tiến trong lúc đóng)
  And comment c2 được tạo lúc 09:30 trong lúc A đóng
  When chu kỳ quét thấy A mở lại (state OPEN và Status không thuộc closedStatuses) với updatedAt 11:00
  And A có comment c3 createdAt 11:00
  Then không có event riêng cho việc mở lại
  And có ContentChanged(new_comment) chỉ với [comment:c3]; c2 được lưu im lặng
  And A được lưu closed = 0
  When chu kỳ quét thấy A mở lại nhưng updatedAt không đổi (chỉ đổi Status)
  Then không gọi chi tiết, không event, A được lưu closed = 0

Scenario: AC-22 Danh sách close rỗng
  Given project có closedStatuses []
  When chạy một chu kỳ
  Then scanProject được gọi với statusField null
  And chỉ issue có state CLOSED là đóng

Scenario: AC-23 Field Status không dùng được
  Given project có closedStatuses ["Done"]
  And scanProject trả statusField "missing" (hoặc "not_single_select")
  When chạy một chu kỳ
  Then chỉ state quyết định issue đóng
  And PollReport có warn=status_field_missing (hoặc warn=status_field_not_single_select)

Scenario: AC-24 Restart giữa hai chu kỳ
  Given đã chạy chu kỳ lấy mốc và một chu kỳ phát hiện comment mới c2 của A
  When dựng PollCycle mới trên cùng DB (như restart) và chạy chu kỳ với cùng dữ liệu GitHub
  Then không có event nào và PollReport không phải BASELINE

Scenario: AC-25 Lỗi khi lưu một issue không chặn issue khác
  Given project đã lấy mốc, issue mới N1 và N2 (N1 có updatedAt nhỏ hơn)
  And bus ném lỗi khi publish event của N1
  When chạy một chu kỳ
  Then N1 không được lưu và event của N1 không còn hiệu lực (rollback)
  And N2 được lưu và có event của N2
  And PollReport là PARTIAL với failed=1
  When chu kỳ sau bus không lỗi
  Then có event của N1 đúng một lần, không có event lặp của N2

Scenario: AC-26 Vòng lặp không chạy chồng và tiếp tục sau lỗi
  Given PollScheduler với pollIntervalMin 5 và hàm hẹn giờ giả
  When start()
  Then một chu kỳ chạy ngay
  And chu kỳ sau chỉ được hẹn sau khi chu kỳ trước kết thúc, cách 5 phút
  And khi một chu kỳ đang chạy, không có chu kỳ thứ hai bắt đầu
  When một chu kỳ ném lỗi không phải GitHubFailure
  Then dòng "[poll] FAIL internal" được in và chu kỳ sau vẫn được hẹn
  When stop()
  Then không chu kỳ nào được hẹn thêm

Scenario: AC-27 Dòng log chỉ có mã và số đếm
  Given PollReport các loại BASELINE, OK, PARTIAL, FAIL github:<reason>, FAIL storage, FAIL internal
  When format bằng formatPollLine
  Then dòng đúng định dạng ở mục "Dòng log [poll]", trường thiếu giá trị thì bỏ
  And với dữ liệu chứa owner, node id, title, tên Status đặc trưng thì dòng không chứa chuỗi nào trong số đó

Scenario: AC-28 Chế độ fake: chạy chu kỳ qua harness
  Given app chạy APP_ADAPTERS=fake
  Then không có chu kỳ nào tự chạy
  When POST /__test__/poll
  Then trả PollReport BASELINE của board giả
  When seed thêm issue rồi POST /__test__/poll
  Then trả PollReport có new=1
  When POST /__test__/reset rồi POST /__test__/poll
  Then trả PollReport BASELINE (bảng Tracking đã bị xoá)
```

| AC | Khoá bằng | File |
|---|---|---|
| AC-1 … AC-25 | unit (`PollCycle` + `FakeGitHub` + SQLite `:memory:` + `ControllableClock` + bus ghi lại); logic thuần còn có test riêng cho `trackingDecision`, `isIssueClosed`, `diffContents` | `apps/app/src/contexts/tracking/application/poll-cycle.test.ts`, `apps/app/src/contexts/tracking/domain/*.test.ts` |
| AC-26 | unit | `apps/app/src/contexts/tracking/application/poll-scheduler.test.ts` |
| AC-27 | unit | `apps/app/src/contexts/tracking/application/poll-line.test.ts` |
| AC-28 | unit (Hono `app.request`) | `apps/app/src/test-harness/routes.test.ts` |

Tên file là đề xuất; implementer giữ đúng tầng.

Đối chiếu nháp 005a: B1→AC-1, B2→AC-3/4, B3→AC-6, B4→AC-9, B5→AC-10, B6→AC-7, B7→AC-12, B8→AC-14/15, B9→AC-16/17, B10→AC-24, B11→AC-13, B12→AC-26, B13→005c AC-4, B14→005c AC-2, B15→AC-18/19, B16→AC-20, B17→AC-21, B18→AC-22/23, B19→ngoài phạm vi (019).

## Tác động domain
- Thuật ngữ mới (→ `ubiquitous-language.md`, đã thêm): Lấy mốc (`baseline`, `baselinedAt`), Issue chỉ có mốc (`contentsLoaded = false`), Quy tắc close (`CloseRule`, `isIssueClosed`), Quyết định theo dõi (`trackingDecision`), Mã nội dung (`ContentId`), Lý do thay đổi (`ContentChangeReason`), Báo cáo chu kỳ (`PollReport`), Vòng lặp poll (`PollScheduler`), `DomainEventPublisher`, `UnitOfWork`. (Cấu hình app `AppConfig` dùng ở 005c.) Chốt tên `closedStatuses`, `statusField`.
- Aggregate / invariant / event thay đổi (→ `bounded-contexts/tracking.md`, đã cập nhật): invariant "lần thêm đầu `lastSeen = now`" thay bằng "lần poll đầu chỉ lấy mốc từng issue"; `Issue` thêm `closed`, `contentsLoaded`, bỏ `listening` khỏi 005b (để 006b); `lastSeen` là giá trị suy ra; payload `IssueDiscovered` / `ContentChanged`; quy tắc phân loại nội dung.
- Port mới: `DomainEventPublisher`, `UnitOfWork` (`shared/ports`); `TrackingRepository` (port của context Tracking, đồng bộ). `GitHubGateway` không đổi.
- ADR: **ADR-0011 (Accepted sau review)** — domain event trong process, phát đồng bộ trong transaction của bên phát, không outbox.

## Ngoài phạm vi
- Dịch, hàng đợi, retry (006); toast (007); trang issue / inbox (008 / 010); trang tình trạng (009 dùng `last_polled_at`, `lastSeen`, dòng `[poll]`).
- Cờ unlisten issue, theo dõi thủ công issue đóng, listen riêng (006b / 019). Unlisten project (018).
- Nhiều project, cấu hình từ UI (013 / 014). Một issue nằm trên hai board (013).
- Event `IssueClosed` / `IssueReopened`; huỷ job của issue vừa đóng (006 quyết).
- Comment bị xoá, issue bị xoá khỏi board: chỉ giữ dữ liệu, không đánh dấu.
- Comment bị sửa mà không đẩy `Issue.updatedAt`: không thấy cho tới khi issue đổi lần sau (khi đó phát `edited` muộn). Comment tạo cùng giây với mốc đã lưu mà không đẩy `Issue.updatedAt`: có thể bỏ sót (rất hiếm, chấp nhận).
- Phát hiện assign / mention (014). Pull request, draft issue (chỉ đếm).
- Lắp nhánh adapter thật, cấu hình `config.json`, kiểm trên máy thật (005c).
- Ghi log ra file (009). Chạy nền / một instance (020).

## Quyết định (GATE 1, 2026-11-27)
User duyệt toàn bộ khuyến nghị. Câu 3, 12, 13, 15 thuộc phần đã chuyển sang 005c, ghi ở đây để giữ số.

- [x] 1. **(005b-1) Giao event:** handler đồng bộ trong cùng transaction SQLite, đơn vị transaction = một issue, không outbox (ADR-0011). Handler phải đồng bộ và chỉ ghi DB; handler lỗi lặp lại làm issue kẹt, thấy qua `failed=`.
- [x] 2. **(005b-2)** Issue cũ mới vào board = issue mới (`nodeId` chưa biết = issue mới).
- [x] 3. **(005b-3) Chỗ để cấu hình:** `<dataDir>/config.json` → 005c.
- [x] 4. **(005b-4)** `ContentChanged(new_comment)` chỉ mang id comment mới; 006 tự lấy title/body làm ngữ cảnh qua port đọc của Tracking.
- [x] 5. **(005b-5)** Không phát event khi đóng/mở lại, chỉ lưu `closed`.
- [x] 6. **(005b-6)** Phương án (a): mốc vẫn tiến trong lúc đóng, mở lại chỉ comment sau đó là mới. Issue mới vào board mà đã đóng: chỉ lưu mốc (AC-20).
- [x] 7. **(005b-7)** So Status theo tên option, NFKC + trim, **không** phân biệt hoa thường. Không dùng `optionId`.
- [x] 8. Issue chỉ có mốc đổi mà không có comment mới: lưu nội dung im lặng, không `edited` (AC-8).
- [x] 9. Chưa thêm cột `listening`; dồn quyết định vào `trackingDecision`, 006b thêm một nhánh + migration `ADD COLUMN`.
- [x] 10. PK của `issue` = GitHub node id, có `project_id`. Issue trên hai board (013) tách bảng liên kết bằng migration mới.
- [x] 11. Không e2e cho 005b (bỏ bước `e2e-writer`). Thêm `POST /__test__/poll` + `Harness.runPoll()` (khoá bằng unit, AC-28) cho e2e của 006/007/008.
- [x] 12. Chu kỳ mặc định 5 phút, cho phép 1–60. `PollScheduler` nhận `pollIntervalMin` tiêm vào; giá trị mặc định và kiểm khoảng nằm ở cấu hình (005c).
- [x] 13. Kiểm trên máy thật → 005c: project cá nhân trên GHES (`ownerType: "user"`) có repo/issue thử, đủ 7 bước.
- [x] 14. Tách ngay: 005b (logic) / 005c (lắp nhánh thật + kiểm máy thật).
- [x] 15. Root script `pnpm start` → 005c.

## Câu hỏi mở
Không còn.

## Kế hoạch implement
(Implementer làm theo thứ tự, mỗi bước một commit, test xanh sau mỗi bước. Commit `feat(tracking): … (005b)`.)
1. **Domain Tracking thuần** (`contexts/tracking/domain/`): `CloseRule` + `isIssueClosed` (chuẩn hoá NFKC/trim/lowercase), `contentId`, `contentHash` (sha256), `trackingDecision`, `diffContents` (mới/im lặng/edited theo mốc `M`); kiểu event ở `shared/events/`. Unit test phần thuần của AC-1, 5, 6–13, 18–23.
2. **Hạ tầng event + transaction**: port `DomainEventPublisher`, `UnitOfWork` (`shared/ports`); `InProcessEventBus` (đăng ký theo `type`, gọi tuần tự), `SqliteUnitOfWork`; bus ghi lại (có chế độ ném lỗi) trong `test-harness/`. Test: handler ném → rollback.
3. **Lưu trữ Tracking**: `migrations/0003-tracking.sql`; port `TrackingRepository` (đồng bộ) trong `contexts/tracking/application/`; `SqliteTrackingRepository` trong `contexts/tracking/infrastructure/` (lưu/đọc project, issue, content, `lastSeen`); kiểm `clearAllTables` tự gồm bảng mới. Test với `:memory:`.
4. **`PollCycle` + `PollReport` + `formatPollLine`** (`contexts/tracking/application/`): `PollProjectConfig` tiêm vào; AC-1 … AC-25, AC-27 với `FakeGitHub` (`load(fixture)` để có state/Status) và bus ghi lại. Không dùng `detailStats` của `GhCliGateway`.
5. **`PollScheduler`** (`contexts/tracking/application/`; hẹn giờ, `pollIntervalMin`, `log` tiêm vào): AC-26.
6. **Chế độ fake + harness + docs**: lắp `PollCycle` với project cố định trong nhánh fake của `composition-root.ts` (không chạy `PollScheduler`); `POST /__test__/poll` trong `routes.ts`; `/__test__/reset` xoá bảng Tracking; `Harness.runPoll()` trong `e2e/support/harness.ts` (không đụng `e2e/specs/`); cập nhật bảng endpoint trong `docs/architecture/testing-harness.md` — AC-28. `pnpm verify` (gồm e2e smoke) xanh.

## Workflow log
| Bước | Thời điểm | Kết quả |
|---|---|---|
| 1 Phân tích | 2026-11-27 | Spec draft từ nháp 005a (B1–B19 → AC-1…AC-32). ADR-0011 Proposed (event đồng bộ trong transaction). Cập nhật `ubiquitous-language.md`, `bounded-contexts/tracking.md`, dòng 005b roadmap. Đề xuất không e2e, giữ cỡ M với đường cắt sau bước 4 |
| GATE 1 | 2026-11-27 | User duyệt mọi khuyến nghị (Câu hỏi mở → "Quyết định (GATE 1)"). Tách ngay: 005b giữ AC-1…27 + AC-32 cũ (→ AC-28); AC-28…31 cũ + bảng kiểm Windows → 005c (`docs/features/005c-real-adapter-wiring/spec.md`). Kế hoạch chia lại 6 bước. Không e2e. Code gộp PR #11 với 005a. Trạng thái approved |
| Implement bước 1–3 | 2026-11-27 | Domain thuần (`close-rule`, `content`, `issue`, `tracking-decision`, `diff-contents`, `timestamps`), kiểu event ở `shared/events/`; port `DomainEventPublisher` / `UnitOfWork`, `InProcessEventBus`, `SqliteUnitOfWork`, `RecordingEventBus` (`failWhen`); migration `0003-tracking.sql`, port `TrackingRepository`, `SqliteTrackingRepository`. Test cũ của 003 không còn cứng số migration. Còn bước 4–6 |
| Implement bước 4–6 | 2026-11-27 | `PollCycle` + `PollReport` + `formatPollLine` (AC-1…25, 27), `PollScheduler` (AC-26), nhánh fake lắp `PollCycle` (project cố định, `InProcessEventBus` chưa có bên nghe, không chạy scheduler), `POST /__test__/poll`, `Harness.runPoll()`, cập nhật `testing-harness.md` (AC-28). Nhánh thật vẫn throw (005c). ADR-0011 vẫn Proposed |
| Review 005b + sửa finding | 2026-11-27 | Reviewer APPROVE; user chọn sửa tất cả: `PollCycle.run()` gộp lời gọi chồng + đọc lại issue trong transaction; phân loại lỗi lưu trữ tiêm qua `classifyStorageError` (`classifyStorageFailure`); domain có kiểu tối thiểu `github-view.ts`; log ném lỗi không dừng scheduler; test AC-14/23/27 chặt hơn, thêm test FAIL storage và chạy chồng; docs `tracking.md`/`ubiquitous-language.md` khớp code; ADR-0011 Accepted |
| 5 Verify | 2026-11-27 | Orchestrator chạy `pnpm verify`: xanh (551 test). Kiểm test chạy chồng đỏ khi bỏ bản sửa. Story done; code gộp PR #11 |
