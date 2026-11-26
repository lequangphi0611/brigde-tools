# Design tokens

Nguồn chính là Design System artifact của dự án (brand book đầy đủ). Trong repo, `apps/app/web/src/styles/tokens.json` là bản sao, và là **nguồn cho code**: sửa token thì sửa ở cả hai nơi, rồi chạy `pnpm tokens` để sinh lại `tokens.css`. Test `scripts/tokens/tokens-css.test.ts` fail nếu CSS lệch với JSON.

Phạm vi: chỉ token. Component do từng story tự viết bằng CSS thường + `var(--…)`.

## Quy tắc

- Theme sáng trên `:root`, theme tối trong `@media (prefers-color-scheme: dark)`, nghĩa là theo cài đặt của Windows.
- **Chàm `--ai`** là màu chính: link, nút chính (chữ `--on-ai`), chấm chưa đọc, focus. `--ai-soft` làm nền nhãn "liên quan tới tôi".
- **Son `--shu`** chỉ dùng để đánh dấu bản gốc tiếng Nhật (nhãn JA). Không dùng cho lỗi.
- Nền: `--bg` (vùng đọc) → `--surface-1` (sidebar, thanh công cụ) → `--surface-2` (hover, đang chọn). Cột tiếng Nhật dùng `--ja-surface`, code dùng `--code-surface`.
- Trạng thái luôn có chữ, không chỉ dựa vào màu: `--status-translating`, `--status-failed`, `--status-ok`, `--status-paused`, mỗi cái kèm nền `-bg` (riêng tạm dừng dùng nền `--surface-2`).
- Phân tách bằng `--border` 1px, không đổ bóng. `--shadow-popover` chỉ dùng cho menu nổi.
- Font hệ thống Windows, không tải font ngoài: `--font-sans` (Segoe UI, cho tiếng Việt), `--font-ja` (Yu Gothic UI; tự áp cho `:lang(ja)`), `--font-mono` (Cascadia Mono).
- Kiểu chữ là class `.t-title-page`, `.t-title-section`, `.t-body`, `.t-body-strong`, `.t-meta`, `.t-label`, `.t-body-ja`, `.t-code`.
- Khoảng cách theo lưới 4px: `--space-1/2/3/4/6/8`. Bo góc: `--radius-sm/md/lg/pill`. Layout: `--measure` (72ch), `--sidebar-width`, `--content-max`.
- Mọi cặp chữ/nền đạt 4.5:1 ở cả hai theme. Viền ô nhập `--border-strong` đạt 3:1.
