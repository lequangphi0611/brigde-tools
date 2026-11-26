# Bounded Context: Notification

## Model
- `NotifyRules` (VO, theo project): `newIssue`, `assignedOrMentioned`, `newComment`.
- `GlobalPause` (VO): `pausedUntil: Date | null` — lưu bảng `setting`. Lựa chọn: 1 giờ, hết ngày, đến khi bật lại.

## Quy tắc
- Chỉ bắn toast khi **bản dịch đã sẵn** (nghe `TranslationReady`, không nghe event thô).
- Toast chỉ khi: listen hiệu lực = true ∧ khớp `NotifyRules` ∧ không trong `pausedUntil`.
- Hết `pausedUntil` → tự bật lại, **không** bắn bù.
- `ProjectResumed` → đúng **một** `SummaryToast` ("N mục mới").
- Listen lại issue → dịch bù, **không** toast bù.
- Toast title = title tiếng Việt; bấm → `http://localhost:<port>/issues/<id>`.

## Ports
- `Notifier.notify(toast)` — thật: node-notifier, dự phòng PowerShell. Fake: `RecordingNotifier`.
- `Clock`.
