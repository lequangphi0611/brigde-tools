# ADR-0006: Port `Translator` dịch theo lô đoạn, phần giữ nguyên được che bằng chỗ giữ

- Trạng thái: Proposed
- Ngày: 2026-11-26
- Liên quan: ADR-0003 (runner), story 001 (`docs/features/001-claude-cli-translator/spec.md`), `docs/spikes/claude-cli-windows.md`

## Bối cảnh
- Mỗi lần gọi `claude -p` trên máy thật mất khoảng 100 giây; với 2 lần song song chỉ được khoảng 70 lần mỗi giờ. Phải dịch **cả issue (title + body + comment mới) trong một lần gọi**.
- Port hiện tại `translate(text, direction, context): Promise<string>` chỉ dịch một chuỗi. Gộp nhiều đoạn thành một chuỗi rồi tách lại bằng dấu phân cách thì dễ vỡ và đẩy việc tách xuống từng bên gọi.
- `core-translate` dùng chung với tool dịch chat → đổi port là thay đổi khó đảo ngược.
- Code block, inline code, URL, `@mention` phải giữ nguyên. Chỉ dặn trong prompt thì không kiểm được bằng test và tốn token cho phần không cần dịch.

## Các lựa chọn
1. Giữ port một chuỗi; bên gọi tự ghép/tách. Không đổi API, nhưng mọi bên gọi phải lặp lại logic ghép/tách và kiểm tính toàn vẹn.
2. Thêm method `translateBatch` bên cạnh `translate`. Hai method cho cùng một việc; adapter phải làm cả hai.
3. **Một method nhận lô đoạn**: `translate({ direction, segments: [{ id, text }], context }) → { segments: [{ id, text }], model }`, lỗi là `TranslationFailure { reason }`. Dịch một chuỗi = lô một đoạn.

Về giữ nguyên:
- a. Chỉ dặn trong prompt.
- b. **Che bằng chỗ giữ `⟦N⟧`** trước khi gửi (logic thuần trong `domain/`), khôi phục và kiểm đủ chỗ giữ sau khi nhận.

## Quyết định
Chọn 3 + b.
- `id` của đoạn là chuỗi mờ do bên gọi đặt; adapter dùng id riêng (`s1`, `s2`, …) trong prompt.
- Kết quả có đúng tập id của request, không có kết quả một phần. Mất/thừa đoạn hoặc chỗ giữ → `TranslationFailure("bad_output")`.
- Thẻ phân cách giả và ký tự `⟦ ⟧` có sẵn trong nội dung cũng được che → vô hiệu hoá thẻ giả mà vẫn trả lại nguyên văn.
- `TranslationContext` (glossary, hint) giữ nguyên để story 002 dùng; cache (003) lọc theo từng đoạn trước khi gọi port.

## Hệ quả
- Tool dịch chat phải đổi cách gọi (hoặc dùng hàm bọc một đoạn, nếu user chọn ở câu hỏi mở 4 của story 001).
- Code block không vào prompt: ít token, ít bề mặt injection; đổi lại model mất ngữ cảnh từ code.
- Phụ thuộc vào việc model giữ `⟦N⟧` nguyên vẹn. **Cần kiểm chứng** trên máy thật bằng `pnpm diagnose` (mẫu cố định). Nếu model hay làm mất, cân nhắc chế độ kiểm mềm.
- `FakeTranslator` đổi theo port nhưng giữ hợp đồng `"[vi] " + text` mỗi đoạn mà harness e2e dựa vào. Một bộ test hợp đồng chạy cho cả fake và adapter thật (ADR-0002).
