# ADR-0001: Ghi lại quyết định kiến trúc

- Trạng thái: Accepted
- Ngày: 2026-11-26

## Bối cảnh
Dự án do người + nhiều agent cùng làm; quyết định cần truy vết được.

## Quyết định
Mỗi quyết định khó đảo ngược (thư viện lõi, schema, ranh giới context, cách gọi hệ ngoài) có một ADR `NNNN-slug.md` với: Bối cảnh, Các lựa chọn, Quyết định, Hệ quả.

## Hệ quả
Agent `analyst` đề xuất ADR khi story chạm tới quyết định như vậy; người duyệt ở cổng spec.
