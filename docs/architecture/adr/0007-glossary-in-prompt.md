# ADR-0007: Glossary trong prompt — chuẩn hoá khoá, chỉ ghép thuật ngữ liên quan, `glossaryVersion` theo nội dung

- Trạng thái: Proposed
- Ngày: 2026-11-27
- Liên quan: ADR-0006 (port theo lô), story 002 (`docs/features/002-two-tier-glossary/spec.md`), story 003 (cache), 012, 015

## Bối cảnh
- Glossary có hai tầng: chung và riêng từng project; project thắng khi trùng. Người dùng sẽ nhập ở 015 và từ màn đọc ở 012, nên cùng một thuật ngữ có thể được gõ ở dạng full-width/half-width (`ＡＰＩ`/`API`, `ｶﾞｲﾄﾞ`/`ガイド`) hoặc khác hoa thường.
- Mỗi lần gọi `claude -p` mất khoảng 100 giây; mọi thứ thêm vào stdin đều ăn vào `maxInputChars` và có thể làm tăng số lần gọi con.
- Cache (003) cần một `glossaryVersion` xác định để biết bản dịch cũ có còn đúng với glossary hiện tại không. Đổi công thức version về sau làm toàn bộ cache cũ bị coi là lỗi thời (không hỏng dữ liệu, nhưng dịch lại tốn nhiều giờ).
- `core-translate` dùng chung với tool dịch chat, không được biết `projectId` hay lưu trữ của app.
- Thuật ngữ do người dùng nhập, nhưng ở 012 có thể được chép từ nội dung issue → vẫn coi là dữ liệu, không phải lệnh.

## Các lựa chọn
Khoá trùng:
- a. So nguyên văn `ja`.
- b. **NFKC + gộp khoảng trắng + trim + viết thường.**

Thuật ngữ đưa vào prompt:
- c. Tất cả thuật ngữ đã gộp.
- d. **Chỉ thuật ngữ có phía nguồn xuất hiện trong text đã che của các đoạn trong lần gọi con đó.**

Phiên bản glossary:
- e. Số tăng dần lưu trong DB (đổi glossary thì +1).
- f. **Hash nội dung đã chuẩn hoá**, tính được ở bất cứ đâu, không cần lưu trữ.

## Quyết định
Chọn b + d + f.
- `termKey(ja) = lower(trim(collapseWhitespace(NFKC(ja))))`. Render `ja`/`vi` ở dạng đã chuẩn hoá (chưa viết thường).
- Gộp trong domain thuần (`mergeGlossary(common, project)`), đầu ra sắp theo khoá. Trùng trong một tầng hoặc thuật ngữ rỗng là lỗi dữ liệu (`Error`).
- So khớp chuỗi con sau chuẩn hoá trên text **đã che** (thuật ngữ trong code/URL không tính). Không có thuật ngữ liên quan → prompt giống hệt khi không có glossary.
- Render: khối `<glossary>` riêng, mỗi dòng một object JSON; thuật ngữ được vô hiệu hoá như hint (thẻ giả `source|segment|context|glossary`, `⟦ ⟧` → `⟨ ⟩`). Nội dung đoạn và hint cũng vô hiệu hoá thẻ `glossary`.
- `glossaryVersion(terms) = "g1-" + hex(sha256(canonical(terms)))[0..16]`; tiền tố `g1` cho phép đổi công thức có chủ đích. Story 003 chọn tính trên cả glossary hay trên thuật ngữ liên quan của từng đoạn (khuyên: theo đoạn — khớp với d và tránh làm lỗi thời mọi bản dịch khi thêm một thuật ngữ chung).

## Hệ quả
- Glossary lớn không làm phình mọi prompt; đổi lại logic chia lô phải tính thuật ngữ theo từng lô ứng viên.
- So chuỗi con không hiểu hình thái tiếng Nhật: biến thể chia động từ/okurigana khác không khớp. Thuật ngữ Latin ngắn có thể khớp nhầm trong từ dài hơn (chỉ thừa một dòng prompt).
- Không phân biệt hoa thường: không thể có hai thuật ngữ chỉ khác hoa thường.
- Model có tuân glossary hay không chỉ đảm bảo bằng prompt. **Cần kiểm chứng** trên máy thật bằng một mẫu cố định trong `pnpm diagnose` (đề xuất gộp vào S0.4).
- Version theo nội dung không cần bảng/cột riêng trong DB; đổi chuẩn hoá hay format render mà không đổi tiền tố thì cache sẽ sai lệch âm thầm — đổi một trong hai thì phải tăng `g1` → `g2`.
- Version không bao gồm phiên bản prompt/model; nếu 003 cần dịch lại khi đổi prompt thì thêm thành phần riêng vào khoá cache.
