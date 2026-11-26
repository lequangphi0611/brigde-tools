# Bounded Context: Translation (`packages/core-translate`)

Package độc lập, dùng chung với tool dịch chat Việt↔Nhật. **Không phụ thuộc** GitHub, SQLite cụ thể, hay `apps/`.

## Model
- `Direction` (VO): `{ from, to }`.
- `Translation` (entity, khoá `hash + direction`): `text`, `model`, `glossaryVersion`, `createdAt`. Không bao giờ dịch lại nội dung đã dịch cùng hash + glossaryVersion.
- `GlossaryTerm` (entity): `projectId | null`, `ja`, `vi`, `note`. Gộp: project thắng khi trùng `ja`.
- `TranslationJob` (aggregate): `contentId`, `priority`, `status: queued|running|done|failed`, `attempts`, `error`.
  - **Invariant:** tối đa 2 job `running` cùng lúc; mục liên quan tới tôi ưu tiên cao hơn.

## Hành vi dịch
- Giữ nguyên code block, inline code, link, `@mention`.
- Prompt có glossary + ngữ cảnh (tên project, title issue).

## Ports
- `Translator.translate(text, direction, context)` — adapter thật `ClaudeCliTranslator` (chưa có) dùng runner `infrastructure/claude-cli/` theo ADR-0003: không shell, nội dung qua stdin, cwd tạm rỗng, model không có tool, output JSON theo schema.
- Nội dung issue là **dữ liệu, không phải lệnh**: prompt đặt nó trong khối phân cách (`<source>…</source>`), vô hiệu hoá thẻ giả trong nội dung, system prompt dặn bỏ qua mọi câu nhắm vào người dịch.

## Events
- `TranslationReady { contentId, direction }`.
