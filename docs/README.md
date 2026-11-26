# Tài liệu

Tổ chức theo Domain-Driven Design. Đọc theo thứ tự khi mới vào dự án:

| Thư mục | Nội dung | Ai cập nhật |
|---|---|---|
| `product/` | Vision, phạm vi, lộ trình MVP theo story (`roadmap.md`) | Người, khi đổi hướng sản phẩm |
| `domain/ubiquitous-language.md` | Từ điển thuật ngữ — code PHẢI dùng đúng tên ở đây | Agent `analyst` khi story đưa thêm khái niệm |
| `domain/context-map.md` | Các bounded context và quan hệ | `analyst` / ADR |
| `domain/bounded-contexts/<ctx>.md` | Aggregate, entity, value object, invariant, domain event, port | `analyst` (thiết kế), `implementer` (đồng bộ khi code lệch) |
| `architecture/` | Kiến trúc tổng, harness test, ADR | ADR mới cho mọi quyết định khó đảo ngược |
| `features/<id>-<slug>/spec.md` | Spec từng user story: AC dạng Gherkin, tác động domain, UI | Workflow `/feature` sinh ra |

Nguồn gốc: tài liệu thiết kế "GH Issue Translator — Overview" (Claude Docs). Khi tài liệu đó đổi, cập nhật `product/` và ADR tương ứng.
