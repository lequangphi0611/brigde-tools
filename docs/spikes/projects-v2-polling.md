# Spike S0.2: Projects v2 polling trên GHES

Nguồn: `pnpm diagnose` chạy trên máy công ty, người dùng gõ lại kết quả. Không có dữ liệu công ty trong file này.

## Lần 1 (2026-11-26)

| Hạng mục | Kết quả |
|---|---|
| Môi trường | Windows 11 (10.0.26200), Node v24.9.0, gh 2.94.0, chưa có pnpm |
| GHES | 3.20.12, đăng nhập qua `GH_HOST`, token có `read:project` |
| Rate limit | GHES tắt rate limit (`rateLimit = null`) → không phải tối ưu chi phí query |
| Projects v2 | Đọc được, khoảng 286 item |
| Filter `items(query: "updated:…")` | **Có hỗ trợ.** base 286 = gt 23 + lt 259 + eq 4; khoảng tương lai = 0 |
| Filter dựa trên | `item.updatedAt`: 23/23 item trả về có item.updatedAt sau mốc, chỉ 20/23 có Issue.updatedAt sau mốc (3 item đổi trên board mà Issue không đổi) |
| Độ chi tiết giờ/phút | Chưa kết luận: cửa sổ 2 giờ không có thay đổi (0/0) |

**Kết luận tạm:** filter `updated:` chạy được và dựa trên updatedAt của item. Còn mở: comment vào issue có làm `item.updatedAt` đổi không? Nếu không thì filter bỏ sót, và poller phải lấy hết item rồi so `Issue.updatedAt` phía client (khoảng 3 trang × 100 item mỗi chu kỳ; GHES tắt rate limit nên chấp nhận được).

## Lần 2 (2026-11-26)

`filter miss` OK 0/N, nhưng trước khi chạy chưa có comment thử nào → chưa chứng minh được. Người dùng sẽ comment thử vào một issue (không đụng board) rồi chạy lại.

## Lần 3 (2026-11-27)

| Dòng | Kết quả |
|---|---|
| `updated:` | OK, base 286 = gt 23 + lt 263 + eq 0; future = 0 |
| `filter basis` | Filter trả 23 item: item.updatedAt sau mốc 23/23, Issue.updatedAt sau mốc 19/23 |
| `filter miss` | OK, 0/19 issue cập nhật sau mốc bị filter bỏ sót |
| `issue>item` | **2/286 item có Issue.updatedAt mới hơn item.updatedAt** |
| `updated time` | WARN: filter có giờ/phút → server 0, client đếm 5; filter cả ngày → 13. **Server chỉ hiểu mức ngày** |

**Kết luận:**
- Trong cửa sổ đo, filter không bỏ sót issue nào.
- Nhưng `issue>item` 2/286 là bằng chứng trực tiếp rằng có thay đổi ở Issue **không** làm `item.updatedAt` đổi. Nếu thay đổi kiểu đó xảy ra sau mốc, filter `updated:` sẽ bỏ sót. Chưa biết đó là loại thay đổi gì (comment, label, sửa body…).
- → Filter `updated:` **không được là nguồn duy nhất** của poller. Poller phải so `Issue.updatedAt` phía client trên toàn bộ item (GHES tắt rate limit, 286 item ≈ 3 trang/chu kỳ), filter chỉ dùng được để thu hẹp nếu sau này cần.
- `updated time`: server bỏ qua phần giờ/phút, nên filter có dùng thì cũng chỉ thu hẹp được theo ngày. Thêm một lý do để poller so `Issue.updatedAt` phía client.
- Chưa rõ: lần này người dùng đã comment thử trước khi chạy hay chưa (không còn chặn 005 nếu quét toàn bộ).

## Lần 4 (2026-11-27) — đo cho adapter GitHub (005a bước 1)

Cùng máy, Node v24.9.0, gh 2.94.0, GHES 3.20.12. Các dòng đo chung (`updated:`, `filter basis`, `issue>item`, `updated time`) cho kết quả cùng hướng với Lần 2–3 (lần này base 286 = gt 23 + lt 263 + eq 0; `issue>item` vẫn 2/286).

```
item scan        OK    pages=3 items=286 issues=286 pr=0 draft=0 noaccess=0 closed=263 statusField=found statusSet=286 statusOptions=6 ms=1868
gql stdin        OK    ms=493
comments         OK    issues=286 withComments=145 maxComments=7 over100=0 newerComment=0 editedComment=0 batches=12 batchMs=520 batchMsMax=567
gql partial      INFO  exit=1 stdoutJson=yes data=1 errors=yes
```

**Kết luận:**
- Quét toàn board rẻ: 3 trang ≈ 1,9 s. Chu kỳ poll tính bằng phút là dư.
- `closed=263/286`: chỉ 23 issue đang mở. Quy tắc close (005b) cắt gần hết việc lấy chi tiết.
- `fieldValueByName` / `field(name:)` chạy được trên GHES 3.20 (`statusField=found`, 6 option, mọi item có giá trị). Quy tắc close dùng được cả state lẫn Status.
- `gh api graphql --input -` chạy được → adapter truyền query + biến qua stdin.
- Lô 25 id ≈ 0,5 s (tối đa 0,57 s), xa timeout → giữ `DETAIL_BATCH = 25` (lô thật nặng hơn vì có body và tới 100 comment, vẫn dư).
- `over100=0`, `maxComments=7`: phân trang comment hầu như không chạy, AC-4 vẫn giữ.
- `newerComment=0` trên 145 issue có comment: giả định "comment mới đẩy `Issue.updatedAt`" đúng trên mẫu này.
- Lỗi một phần: `gh` exit 1 nhưng vẫn in JSON có `data` ra stdout → dùng `data`, id null vào `missing`; AC-6 giữ nguyên.
- `editedComment=0` chỉ xét comment cuối mỗi issue: chưa có bằng chứng về sửa comment.
- Còn mở: 2/286 `issue>item` là loại thay đổi gì — không còn chặn vì poller so `Issue.updatedAt` trên toàn board.
- Node trên máy vẫn 24.9.0 (ADR-0004 khuyến nghị ≥ 24.15).
