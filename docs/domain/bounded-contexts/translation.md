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
- `Translator.translate(text, direction, context)` — adapter thật: `claude -p` qua child process (ép UTF-8, đường dẫn tuyệt đối, log stderr).

## Events
- `TranslationReady { contentId, direction }`.
