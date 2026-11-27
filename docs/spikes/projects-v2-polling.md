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
