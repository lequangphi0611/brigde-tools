---
name: feature
description: Workflow điều phối một user story từ phân tích yêu cầu → design → khoá e2e → implement → verify → review → tạo PR. Dùng khi user gõ /feature <story hoặc URL GitHub issue>, hoặc nhờ làm một tính năng mới end-to-end. Hỗ trợ tiếp tục dở dang bằng /feature resume NNN.
---

# Workflow /feature

Bạn (session chính) là **orchestrator**. Bạn không tự phân tích sâu hay tự viết code tính năng — bạn giao việc cho subagent, kiểm chứng kết quả, và dừng ở các **cổng (GATE)** để user quyết.

| Bước | Ai | Model |
|---|---|---|
| 1 Phân tích | `analyst` | opus |
| 2 Design | Claude Design (user tự chạy prompt) | — |
| 3 Khoá hành vi | `e2e-writer` | sonnet |
| 4 Implement | `implementer` | sonnet |
| 5 Verify | orchestrator chạy `pnpm verify` | — |
| 6 Review | `reviewer` | opus |
| 7 PR | orchestrator | — |

Mỗi khi chuyển bước, cập nhật mục "Workflow log" trong spec (bước, thời điểm, kết quả) để có thể `resume`.

## Bước 0 — Tiếp nhận
1. Đầu vào là text story, URL GitHub issue (đọc bằng GitHub MCP), hoặc `resume NNN` (đọc spec + Workflow log, nhảy tới bước dở).
2. `NNN` = số lớn nhất trong `docs/features/` + 1 (3 chữ số). `slug` = kebab-case tiếng Anh ngắn.
3. Branch: nếu đang ở `main` → `git checkout -b feature/NNN-slug`. Nếu môi trường chỉ định sẵn branch làm việc, dùng branch đó.
4. Story mơ hồ tới mức không phân tích được (không rõ ai, làm gì) → hỏi user 1–3 câu trước, đừng giao analyst đoán.

## Bước 1 — Phân tích (agent `analyst`)
- Giao: story, `NNN-slug`, câu trả lời trước đó (nếu có).
- Nhận về: spec, AC, phản biện, câu hỏi mở.
- **GATE 1:** trình bày cho user: tóm tắt AC (1 dòng/AC), phản biện/rủi ro, câu hỏi mở, Cần UI. Hỏi: duyệt / trả lời câu hỏi / sửa.
  - Có câu trả lời hoặc yêu cầu sửa → gửi lại cho analyst (SendMessage nếu còn, không thì Agent mới) → lặp GATE 1.
  - Duyệt → đặt spec `Trạng thái: approved`, commit `docs(NNN): spec <slug>`.

## Bước 2 — Design (chỉ khi `Cần UI: có`)
- Dùng skill `design-brief` để soạn **prompt dạng text** cho Claude Design, in ra trong chat trong một code block. **Không lưu prompt vào repo.**
- Bảo user: dán prompt vào Claude Design, rồi mang kết quả về (ảnh chụp, link, HTML export, hoặc mô tả).
- **GATE 2:** chờ user gửi kết quả. Khi có: tự cập nhật mục "UI" trong spec — màn hình, state (loading/empty/error), copy chính xác, danh sách `data-testid`. Design đổi hành vi so với AC → báo user và cập nhật AC (quay GATE 1 rút gọn). Commit `docs(NNN): ui spec`.
- User nói bỏ qua design → ghi vào Workflow log, đi tiếp với UI tối giản theo AC.

## Bước 3 — Khoá hành vi (agent `e2e-writer`)
- Giao: `NNN-slug`. Nhận về: bảng AC→test, output đỏ.
- Tự kiểm: chạy `pnpm e2e e2e/specs/NNN-slug.spec.ts` — phải đỏ vì thiếu tính năng, không phải lỗi setup. Sai → trả lại e2e-writer.
- **GATE 3:** cho user xem danh sách test (tên + bước chính). Duyệt → `pnpm e2e:lock` → commit `test(e2e): lock behavior for NNN` (gồm spec e2e, harness, `e2e/specs.lock.json`).

## Bước 4 — Implement (agent `implementer`)
- Giao: `NNN-slug`. Kế hoạch dài (> ~5 bước) → chia nhiều lượt implementer tuần tự, mỗi lượt vài bước.
- Implementer báo AC bất khả thi / e2e sai → DỪNG, hỏi user. User đồng ý đổi hành vi → cập nhật spec, giao e2e-writer sửa, user duyệt lại, `pnpm e2e:lock`, commit `test(e2e): relock NNN — <lý do>`.

## Bước 5 — Verify (orchestrator tự chạy)
- Chạy `pnpm verify`. **Không tin báo cáo của agent thay cho việc tự chạy.**
- Đỏ → gửi output lỗi cho implementer sửa. Tối đa 3 vòng; quá → dừng, báo user tình trạng + giả thuyết.

## Bước 6 — Review (agent `reviewer`)
- `must-fix` → implementer sửa → quay bước 5. Tối đa 2 vòng review.
- `should-fix`/`nit` → liệt kê cho user chọn sửa hay để lại.

## Bước 7 — PR
1. Spec → `Trạng thái: done`; ADR Proposed liên quan → Accepted nếu user đồng ý.
2. **GATE 4:** tóm tắt cho user: commits, kết quả verify, finding còn lại. Xác nhận trước khi push.
3. `git push -u origin <branch>`. Tạo PR bằng GitHub MCP theo `.github/pull_request_template.md`: title `feat: <story> (NNN)`, body link spec, bảng AC→test, kết quả verify, finding còn lại. Base = `main`.
4. Báo link PR cho user; hỏi có muốn theo dõi PR (CI/review) không.

## Nguyên tắc
- Mọi cổng là điểm dừng thật: kết thúc lượt và chờ user, không tự trả lời thay.
- Báo cáo trung thực: test đỏ thì nói đỏ, bước bị bỏ thì nói bỏ.
- Giữ chat ngắn: user cần quyết định gì, không cần đọc lại toàn bộ output agent.
