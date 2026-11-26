# ADR-0002: Hexagonal + fake adapter cho mọi hệ ngoài

- Trạng thái: Accepted
- Ngày: 2026-11-26

## Bối cảnh
Ba phụ thuộc ngoài (gh CLI, `claude -p`, toast Windows) chậm, cần xác thực, hoặc chỉ có trên Windows. Agent implement trong container Linux.

## Các lựa chọn
1. Gọi thẳng hệ ngoài, mock bằng thư viện (vi.mock) — nhanh lúc đầu, e2e không chạy được.
2. **Port + adapter, fake là adapter hạng nhất, chọn tại composition root** — tốn thêm interface.

## Quyết định
Chọn 2. Fake sống trong `src/test-harness`, được bật bằng `APP_ADAPTERS=fake`.

## Hệ quả
- E2E chạy được ở CI/container. Hành vi adapter thật cần contract test riêng.
- Rủi ro: fake lệch thật → contract test chạy cùng bộ case cho cả hai.
