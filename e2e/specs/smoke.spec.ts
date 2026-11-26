import { test, expect } from "../support/harness";

// @story: SMOKE — app khởi động và hiển thị inbox rỗng
test("mở app thấy inbox rỗng", async ({ page, harness }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await expect(page.getByTestId("inbox-empty")).toBeVisible();
  expect(await harness.toasts()).toEqual([]);
});
