# <NNN> — <Tên story>

- Trạng thái: draft | approved | in-progress | done
- Context: Tracking | Translation | Notification
- Cần UI: có | không

## User story
Là <người dùng>, tôi muốn <hành động>, để <giá trị>.

## Acceptance criteria
Mỗi scenario → ít nhất một e2e test (UI) hoặc unit test (logic không có UI). Ghi rõ ở cột "Khoá bằng".

```gherkin
Scenario: <AC-1 tên>
  Given ...
  When ...
  Then ...
```

| AC | Khoá bằng | File |
|---|---|---|
| AC-1 | e2e | e2e/specs/<nnn>-<slug>.spec.ts |

## Tác động domain
- Thuật ngữ mới (→ `ubiquitous-language.md`):
- Aggregate / invariant / event thay đổi:
- Port mới hoặc đổi:
- ADR cần viết:

## UI (nếu có)
Kết quả design đã chốt: màn hình, state (loading/empty/error), copy, `data-testid` cần có.

## Ngoài phạm vi

## Câu hỏi mở
- [ ] ...

## Kế hoạch implement
(Do analyst đề xuất; implementer làm theo thứ tự, mỗi bước một commit.)
1. ...

## Workflow log
| Bước | Thời điểm | Kết quả |
|---|---|---|
| 1 Phân tích | | |
