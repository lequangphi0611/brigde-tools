# Bounded Context: Translation (`packages/core-translate`)

Package độc lập, dùng chung với tool dịch chat Việt↔Nhật. **Không phụ thuộc** GitHub, SQLite cụ thể, hay `apps/`.

## Model
- `Direction` (VO): `{ from, to }`.
- `Translation` (entity, khoá `hash + direction`): `text`, `model`, `glossaryVersion`, `createdAt`. Không bao giờ dịch lại nội dung đã dịch cùng hash + glossaryVersion.
- `GlossaryTerm` (entity): `projectId | null`, `ja`, `vi`, `note`. Gộp: project thắng khi trùng `ja`.
- `TranslationJob` (aggregate): `contentId`, `priority`, `status: queued|running|done|failed`, `attempts`, `error`.
  - **Invariant:** tối đa 2 job `running` cùng lúc; mục liên quan tới tôi ưu tiên cao hơn.

## Hành vi dịch
- **Cả issue một lần gọi** (~100 giây mỗi lần gọi trên máy thật): bên gọi gửi một `TranslationRequest` gồm nhiều `TranslationSegment` (title, body, comment mới).
- Giữ nguyên code block, inline code, URL của link/ảnh, `@mention`, email, comment HTML: che thành chỗ giữ `⟦N⟧` trước khi gửi, khôi phục nguyên văn sau khi nhận (logic thuần trong `domain/`). Chữ của link vẫn được dịch.
- Prompt có glossary (từ 002) + ngữ cảnh (`hint`).
- **Invariant của port:** kết quả có đúng tập id của request (không thiếu, thừa, trùng); mỗi chỗ giữ đã gửi xuất hiện đúng một lần trong đoạn tương ứng; sai thì `TranslationFailure("bad_output")`, không trả kết quả một phần.
- Đoạn rỗng hoặc chỉ gồm phần giữ nguyên không được gửi; không còn gì để gửi thì không gọi engine.

## Ports
- `Translator.translate(request: TranslationRequest): Promise<TranslationResult>` (ADR-0006, story 001; trước đó là `translate(text, direction, context)`) — adapter thật `ClaudeCliTranslator` dùng runner `infrastructure/claude-cli/` theo ADR-0003: không shell, nội dung qua stdin, cwd tạm rỗng, model không có tool, output JSON theo schema.
- Nội dung issue là **dữ liệu, không phải lệnh**: prompt đặt nó trong khối phân cách (`<source>` chứa các `<segment id="sK">`, id do adapter đặt; hint trong `<context>`), thẻ giả trong nội dung bị che thành chỗ giữ, system prompt dặn bỏ qua mọi câu nhắm vào người dịch.
- Lỗi: `TranslationFailure { reason, detail?, stderrTail? }`; message không chứa nội dung. Retry do hàng đợi (006) quyết.

## Events
- `TranslationReady { contentId, direction }`.
