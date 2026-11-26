---
name: design-brief
description: Soạn prompt dạng text để user dán vào Claude Design (đóng vai designer) cho một màn hình/luồng UI. Dùng ở bước 2 của /feature, hoặc khi user cần design một màn hình. Prompt chỉ in ra chat, không lưu vào repo.
---

# Design brief cho Claude Design

Đọc spec `docs/features/NNN-slug/spec.md` (user story, AC, mục UI), `docs/product/vision.md`, và UI hiện có trong `apps/app/web/src` để giữ nhất quán. Sau đó **in ra chat** một code block chứa prompt theo khung dưới (điền cụ thể, bỏ mục không áp dụng). Không ghi file.

Sau code block, nói với user một câu: dán vào Claude Design, rồi gửi lại kết quả (ảnh/link/HTML/mô tả) để chốt mục UI.

````text
Bạn là product designer. Thiết kế <màn hình/luồng> cho "GH Issue Translator" — web app chạy localhost trên Windows, một người dùng, giúp lập trình viên Việt đọc issue GitHub tiếng Nhật đã được dịch sẵn sang tiếng Việt.

## Bối cảnh người dùng
<ai, đang làm gì khi mở màn hình này, tần suất, đến từ đâu (vd. bấm toast)>

## Mục tiêu màn hình
<user story + 1–3 việc người dùng phải làm được>

## Dữ liệu hiển thị (mẫu thật)
<liệt kê trường + ví dụ cụ thể, có tiếng Nhật và bản dịch tiếng Việt, độ dài thực tế, có code block/link nếu liên quan>

## Hành vi cần có (từ acceptance criteria)
<mỗi AC liên quan thành 1 gạch đầu dòng hành vi nhìn thấy được>

## Trạng thái phải thiết kế
- Bình thường, rỗng, đang tải/đang dịch, lỗi (gh/claude lỗi), <trạng thái riêng: tạm dừng, unlisten...>

## Ràng buộc
- Desktop trước (1280–1920px), vẫn dùng được ở ~800px.
- React + CSS thường dùng token có sẵn (dán kèm nội dung `apps/app/web/src/styles/tokens.json` hoặc tóm tắt từ `docs/architecture/design-tokens.md`): chàm `ai` là màu chính, son `shu` chỉ đánh dấu bản gốc tiếng Nhật, trạng thái luôn có chữ, font hệ thống Windows, sáng/tối theo hệ thống; ưu tiên đơn giản, mật độ thông tin cao, đọc lâu không mỏi.
- Song ngữ: tiếng Việt là chính, tiếng Nhật đối chiếu (song song hoặc bật/tắt).
- Copy UI bằng tiếng Việt.
- Nhất quán với màn hình hiện có: <mô tả ngắn hoặc "chưa có">

## Kết quả mong muốn
1. Prototype (HTML/React) cho mỗi trạng thái.
2. Danh sách thành phần và copy chính xác (nút, nhãn, thông báo rỗng/lỗi).
3. Ghi chú tương tác (hover, phím tắt, điều gì xảy ra khi bấm).
4. Đề xuất `data-testid` cho các phần tử người dùng tương tác.
````
