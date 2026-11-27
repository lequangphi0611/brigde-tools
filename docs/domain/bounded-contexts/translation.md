# Bounded Context: Translation (`packages/core-translate`)

Package độc lập, dùng chung với tool dịch chat Việt↔Nhật. **Không phụ thuộc** GitHub, SQLite cụ thể, hay `apps/`.

## Model
- `Direction` (VO): `{ from, to }`.
- `Translation` (entity, khoá `hash + direction`): `text`, `model`, `glossaryVersion`, `createdAt`. Không bao giờ dịch lại nội dung đã dịch cùng hash + glossaryVersion.
- `GlossaryTerm` (entity, lưu ở app — 015): `projectId | null`, `ja`, `vi`, `note`. Trong `core-translate` chỉ là `GlossaryTermInput { ja, vi, note? }`, không có `projectId`.
- `Glossary` (VO, story 002, ADR-0007): kết quả `mergeGlossary(common, project)`.
  - **Invariant:** khoá `termKey` (NFKC + gộp khoảng trắng + trim + viết thường của `ja`) duy nhất; `ja`/`vi` không rỗng sau chuẩn hoá; sắp theo khoá. Trùng giữa hai tầng → project thắng; trùng trong một tầng hoặc rỗng → `Error` (lỗi dữ liệu, 015 phải chặn lúc ghi).
  - `relevantTerms(glossary, maskedTexts, direction)`: thuật ngữ có phía nguồn xuất hiện trong text **đã che** (so sau chuẩn hoá, không phân biệt hoa thường).
  - `glossaryVersion(terms)`: `"g1-"` + 16 hex đầu sha256 của dạng chuẩn tắc; rỗng = `GLOSSARY_VERSION_EMPTY`.
- `TranslationJob` (aggregate): `contentId`, `priority`, `status: queued|running|done|failed`, `attempts`, `error`.
  - **Invariant:** tối đa 2 job `running` cùng lúc; mục liên quan tới tôi ưu tiên cao hơn.

## Hành vi dịch
- **Cả issue một lần gọi** (~100 giây mỗi lần gọi trên máy thật): bên gọi gửi một `TranslationRequest` gồm nhiều `TranslationSegment` (title, body, comment mới).
- Giữ nguyên code block, inline code, URL của link/ảnh, `@mention`, email, comment HTML: che thành chỗ giữ `⟦N⟧` trước khi gửi, khôi phục nguyên văn sau khi nhận (logic thuần trong `domain/`). Chữ của link vẫn được dịch. URL trần dừng ở ký tự không phải ASCII (chữ Nhật liền URL vẫn được dịch), nên link sau dịch có thể khác cách GitHub autolink một chút (chấp nhận).
- Prompt có glossary (từ 002) + ngữ cảnh (`hint`). Glossary: mỗi lần gọi con chỉ mang **thuật ngữ liên quan** tới các đoạn của lần đó, trong khối `<glossary>` (sau `<context>`, trước `<source>`), mỗi dòng một object JSON `{"ja","vi"}`; thuật ngữ được vô hiệu hoá như hint (thẻ giả, `⟦ ⟧`). Không có thuật ngữ liên quan → stdin và system prompt như 001. Khối glossary tính vào `maxInputChars`.
- Thẻ giả bị che/vô hiệu hoá gồm `source|segment|context|glossary`.
- **Invariant của port:** kết quả có đúng tập id của request (không thiếu, thừa, trùng); mỗi chỗ giữ đã gửi xuất hiện đúng một lần trong đoạn tương ứng; sai thì `TranslationFailure("bad_output")`, không trả kết quả một phần.
- Đoạn rỗng hoặc chỉ gồm phần giữ nguyên không được gửi; không còn gì để gửi thì không gọi engine.
- Yêu cầu vượt `maxInputChars` (tính trên stdin sau khi che) → adapter chia thành nhiều lần gọi con **tuần tự**, không cắt đôi đoạn, giữ thứ tự; đoạn đơn lẻ quá dài → `input_too_large` trước khi gọi; một lần gọi con lỗi → cả yêu cầu lỗi.

## Ports
- `Translator.translate(request: TranslationRequest): Promise<TranslationResult>` (`context.glossary` phải hợp lệ theo invariant của `Glossary`, sai → `Error` trước khi gọi engine — story 002) (ADR-0006, story 001; trước đó là `translate(text, direction, context)`) — adapter thật `ClaudeCliTranslator` dùng runner `infrastructure/claude-cli/` theo ADR-0003: không shell, nội dung qua stdin, cwd tạm rỗng, model không có tool, output JSON theo schema.
- Nội dung issue là **dữ liệu, không phải lệnh**: prompt đặt nó trong khối phân cách (`<source>` chứa các `<segment id="sK">`, id do adapter đặt; hint trong `<context>`), thẻ giả trong nội dung bị che thành chỗ giữ, system prompt dặn bỏ qua mọi câu nhắm vào người dịch.
- Lỗi: `TranslationFailure { reason, detail?, stderrTail? }`; message không chứa nội dung. Retry do hàng đợi (006) quyết.

## Events
- `TranslationReady { contentId, direction }`.
