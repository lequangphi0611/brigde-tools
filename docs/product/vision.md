# Vision — GH Issue Translator

Tool chạy nền trên Windows, theo dõi các GitHub Projects (v2) tiếng Nhật, báo khi có task mới và dịch sẵn sang tiếng Việt bằng `claude -p` local.

- **Vấn đề:** backlog và issue của dự án Nhật toàn tiếng Nhật; phải tự vào kiểm tra và tự dịch.
- **Người dùng:** một người, làm nhiều project, chung một tài khoản GitHub. Localhost, không auth.
- **Mục tiêu:** mở ra là có bản dịch; chỉ bị báo điều mình quan tâm; tắt được khi không muốn nghe.
- **Quy mô:** 10–50 issue + comment mới/ngày, tổng các project.

## Phạm vi

| Hạng mục | MVP | Giai đoạn 2 | Ngoài phạm vi |
|---|---|---|---|
| Nguồn | Nhiều Projects v2, thêm/xoá từ UI | | Issue không nằm trên board |
| Sự kiện báo | Issue mới, assign/mention tôi, comment mới — theo project | | Issue bị sửa (vẫn dịch lại, không báo) |
| Nội dung dịch | Title, body, comment | | Field của Project, chữ trong ảnh |
| Chiều dịch | Nhật→Việt | Việt→Nhật + post comment qua gh | |
| Glossary | Chung + riêng từng project | | |
| Listen/unlisten | Toàn cục, project, issue | | Đồng bộ subscribe lên GitHub |
| Lõi dịch | Package `core-translate` dùng chung với tool dịch chat | | |

## Roadmap (theo thứ tự rủi ro)

1. **Spike:** `claude -p` từ process Task Scheduler; `gh api graphql` với `items(query: "updated:...")` + checklist `totalCount`.
2. `core-translate`: `translate(text, from, to, context)`, glossary, giữ code block/link, cache theo hash.
3. Poller + hàng đợi: 1 project cấu hình cứng, SQLite, toast.
4. UI đọc: inbox, trang issue Việt | Nhật, đánh dấu đã đọc.
5. Đa project + cấu hình từ UI.
6. Listen/unlisten ba mức, dịch bù, "Dịch ngay".
7. Giai đoạn 2: comment Việt → Nhật → post.

## Câu hỏi mở (chưa chốt)

- [ ] Tạm dừng toàn cục vẫn dịch nền? Listen lại project gom một toast tóm tắt?
- [ ] github.com hay GHES?
- [ ] Độ chi tiết filter `updated:` (ngày tuyệt đối, giờ/phút).
- [ ] Prisma hay better-sqlite3 (→ ADR khi chốt ở bước 3).
