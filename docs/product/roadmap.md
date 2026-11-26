# Lộ trình ra MVP

MVP = phạm vi cột "MVP" trong `vision.md`: nhiều Projects v2, dịch Nhật→Việt (title/body/comment), toast theo quy tắc, inbox, glossary hai tầng, listen/unlisten. Giai đoạn 2 (Việt→Nhật, post comment) nằm ngoài.

Nguyên tắc sắp xếp:
1. **Rủi ro trước:** spike những thứ chỉ kiểm được trên Windows trước khi viết tính năng phụ thuộc vào chúng.
2. **Có giá trị sớm:** hết M2 đã dùng thật được với một project (nhận toast, đọc bản dịch). Từ đó dùng hằng ngày để phát hiện vấn đề thật.
3. **Mỗi story vừa một lượt `/feature`:** kích cỡ S (≈ nửa ngày làm với agent) hoặc M (≈ một ngày). Story L phải tách trước khi làm.

Không ghi ngày: chưa có số liệu tốc độ thật. Sau M1, dùng số story xong mỗi tuần để ước lượng phần còn lại.

## Đường găng

```
M0 Spike ──▶ M1 Lõi dịch ──▶ M2 Walking skeleton ──▶ M3 Đọc ──┐
                                   │                          ├──▶ M6 Đóng gói ──▶ MVP
                                   └──────▶ M4 Đa project ──▶ M5 Listen ──┘
```

M3 và M4 có thể làm song song hoặc đảo thứ tự sau M2.

---

## M0 — Spike và chốt quyết định (trên máy Windows)

Không đi qua `/feature`. Người chạy trên máy thật; Claude viết script và ghi kết quả vào `docs/spikes/`.

| # | Việc | Đầu ra |
|---|---|---|
| S0.1 | Runner `claude -p` (đã có) chạy thủ công và chạy qua Task Scheduler: xác thực, PATH, UTF-8 tiếng Nhật, tên cờ trên bản đang cài, thời gian mỗi lần dịch | `docs/spikes/claude-cli-windows.md`, file `config/claude-cli.local.json` chạy được |
| S0.2 | `gh api graphql` lấy item một Project v2 với `items(query: "updated:…")`; checklist `totalCount` (base = gt + lt + eq, khoảng tương lai = 0); đo chi phí rate limit một chu kỳ | `docs/spikes/projects-v2-polling.md` |
| S0.3 | Toast: node-notifier so với PowerShell; bấm toast mở `http://localhost:<port>/issues/<id>` | `docs/spikes/windows-toast.md` |

**Quyết định cần chốt khi hết M0:**
- [ ] github.com hay GHES (chặn S0.2)
- [ ] ADR-0004: Prisma hay better-sqlite3 (chặn M2)
- [ ] ADR-0005: thư viện toast (chặn 007)
- [ ] Hai giả định về listen/unlisten trong `vision.md` (chặn M5)

**Xong khi:** dịch được một issue thật từ process do Task Scheduler chạy, và lấy được thay đổi của một project thật bằng một query.

---

## M1 — Lõi dịch (`core-translate`)

| # | Story | Context | UI | Cỡ | Phụ thuộc |
|---|---|---|---|---|---|
| 001 | Dịch một đoạn ja→vi qua `ClaudeCliTranslator`, giữ nguyên code block, inline code, link, `@mention`; nội dung issue được coi là dữ liệu (khối phân cách, vô hiệu hoá thẻ giả) | Translation | – | M | S0.1 |
| 002 | Glossary hai tầng ghép vào prompt (bản của project thắng khi trùng) | Translation | – | S | 001 |
| 003 | Cache bản dịch theo `hash + direction + glossaryVersion` (port trong core-translate, adapter ở app) | Translation | – | S | 001 |

**Xong khi:** một script dịch được title + body của một issue thật trên Windows, chạy lần hai thì lấy từ cache.

---

## M2 — Walking skeleton: một project → toast → đọc

Lần đầu tiên dùng thật được. Project cấu hình cứng trong file config.

| # | Story | Context | UI | Cỡ | Phụ thuộc |
|---|---|---|---|---|---|
| 004 | Lưu trữ SQLite + migration + bảng `setting` | hạ tầng | – | S | ADR-0004 |
| 005 | Poller một project: phát hiện issue mới và comment mới theo `Issue.updatedAt`; lần đầu chỉ lấy mốc thời gian; issue bị sửa thì dịch lại nhưng không báo. Có `GhCliGateway` + fake `gh` ở mức process | Tracking | – | M | S0.2, 004 |
| 006 | Hàng đợi dịch bền (bảng `job`): tối đa 2 job song song, retry có giới hạn, ưu tiên mục liên quan tới tôi, job dở được chạy lại sau khi restart | Translation | – | M | 003, 004 |
| 007 | Toast khi bản dịch đã sẵn (issue mới), title tiếng Việt, bấm mở đúng issue | Notification | – | S | 006, ADR-0005 |
| 008 | Trang issue: tiếng Việt và tiếng Nhật song song, có link sang GitHub, trạng thái "đang dịch" và "dịch lỗi" | Tracking | có | M | 006 |
| 009 | Trang tình trạng tối thiểu: gh đã đăng nhập chưa, Claude CLI đã cấu hình chưa, lần poll cuối, số job lỗi; ghi log ra file local | vận hành | có | S | 005, 006 |

**Xong khi (cổng dùng thật):** chạy trên máy thật ít nhất vài ngày với một project. Ghi lại lỗi gặp phải thành story mới hoặc sửa thứ tự các mốc sau.

---

## M3 — Inbox và đọc

| # | Story | Context | UI | Cỡ | Phụ thuộc |
|---|---|---|---|---|---|
| 010 | Inbox gộp mọi project, lọc theo project / chưa đọc / liên quan tới tôi, đánh dấu đã đọc | Tracking | có | M | 008 |
| 011 | "Dịch ngay" cho issue chưa có bản dịch (issue cũ, issue đang unlisten) | Translation | có | S | 008 |
| 012 | Báo dịch sai thuật ngữ → thêm thẳng vào glossary từ màn đọc, dịch lại khi glossary đổi | Translation | có | M | 002, 008 |

---

## M4 — Đa project và cấu hình

| # | Story | Context | UI | Cỡ | Phụ thuộc |
|---|---|---|---|---|---|
| 013 | Thêm project bằng URL (`orgs/…` hoặc `users/…`): kiểm quyền truy cập, lấy tên project và danh sách repo | Tracking | có | M | 005 |
| 014 | Quy tắc thông báo theo project (issue mới / assign hoặc mention tôi / comment mới) và chu kỳ poll; phát hiện assign/mention | Notification | có | M | 007, 013 |
| 015 | Quản lý glossary: chung và riêng từng project | Translation | có | S | 002 |
| 016 | Xoá project (dữ liệu và job liên quan) | Tracking | có | S | 013 |

---

## M5 — Listen / unlisten

| # | Story | Context | UI | Cỡ | Phụ thuộc |
|---|---|---|---|---|---|
| 017 | Tạm dừng toàn cục có hẹn giờ (1 giờ / hết ngày / đến khi bật lại); chỉ tắt toast; hết giờ thì tự bật lại, không bắn bù | Notification | có | S | 007 |
| 018 | Unlisten / listen project: dừng poll và dịch; listen lại thì dịch bù và gom thành một toast tóm tắt | Tracking | có | M | 013 |
| 019 | Listen / unlisten từng issue, kể cả listen riêng khi project tắt báo comment | Tracking | có | M | 018 |

---

## M6 — Đóng gói và nghiệm thu (Windows)

| # | Story | Context | UI | Cỡ | Phụ thuộc |
|---|---|---|---|---|---|
| 020 | Cài / gỡ chạy nền khi đăng nhập (Task Scheduler), chỉ một instance, cổng cố định | vận hành | – | S | M2 |
| 021 | Hướng dẫn cài đặt lần đầu (gh, Claude CLI, file cấu hình) và trang tình trạng đầy đủ | vận hành | có | S | 009 |

**Nghiệm thu MVP (trên máy thật, có checklist ghi lại):**
- [ ] Thêm hai project bằng URL, không bị báo dồn issue cũ
- [ ] Issue mới / comment mới / assign tôi → toast tiếng Việt theo đúng quy tắc của từng project
- [ ] Bấm toast mở đúng issue, đọc được song song Việt | Nhật
- [ ] Tạm dừng toàn cục, unlisten project, unlisten issue hoạt động đúng như bảng trong `vision.md`
- [ ] Khởi động lại máy → app tự chạy, không mất job, không bắn toast trùng
- [ ] gh hết đăng nhập hoặc Claude CLI lỗi → trang tình trạng chỉ rõ lỗi

---

## Đường cắt nếu cần ra MVP sớm hơn

| Có thể dời sau MVP | Lý do giữ được |
|---|---|
| 012 Thêm thuật ngữ từ màn đọc | Vẫn sửa glossary được qua 015 |
| 016 Xoá project | Có thể unlisten project thay thế |
| 019 Listen từng issue | Listen theo project và tạm dừng toàn cục đã đủ để "tắt khi không muốn nghe" |

Không nên cắt: 011 "Dịch ngay" (thiếu nó thì issue cũ không bao giờ có bản dịch), 009 trang tình trạng (app chạy nền mà lỗi im lặng thì người dùng không biết).

## Cách dùng với workflow

- Làm một story: `/feature <số story>`, ví dụ `/feature 005`. Orchestrator lấy mô tả ở bảng trên làm user story đầu vào, `analyst` mở rộng thành spec `docs/features/005-…/spec.md`.
- Xong story thì đánh dấu ở đây (thêm ✅ vào cột #). Story mới phát sinh thì thêm vào mốc phù hợp với số tiếp theo.
