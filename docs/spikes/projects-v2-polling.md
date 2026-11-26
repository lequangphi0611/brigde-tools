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

## Lần 3 (cần chạy)

Bản `diagnose` mới thêm `filter miss` (lấy toàn bộ item, so với kết quả filter), `issue>item`, và đo `updated time` với mốc lấy từ dữ liệu thật.
