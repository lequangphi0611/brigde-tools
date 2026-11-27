import { describe, expect, it } from "vitest";
import { isIssueClosed, scanStatusField, type CloseRule } from "./close-rule.ts";

const rule = (closedStatuses: string[]): CloseRule => ({ statusField: "Status", closedStatuses });
const open = (name?: string) => ({ state: "OPEN" as const, status: name === undefined ? null : { name, optionId: "o" } });

describe("isIssueClosed (AC-18, 19, 22)", () => {
  it("state CLOSED luôn là đóng, kể cả không có closedStatuses", () => {
    expect(isIssueClosed({ state: "CLOSED", status: null }, rule([]))).toBe(true);
  });
  it("Status thuộc closedStatuses: NFKC + trim + không phân biệt hoa thường", () => {
    const r = rule(["完了", " Done "]);
    expect(isIssueClosed(open("done"), r)).toBe(true);
    expect(isIssueClosed(open("DONE  "), r)).toBe(true);
    expect(isIssueClosed(open("ＤＯＮＥ"), r)).toBe(true); // full-width
    expect(isIssueClosed(open("完了"), r)).toBe(true);
  });
  it("Status không thuộc danh sách, hoặc không có Status, là mở", () => {
    const r = rule(["完了", " Done "]);
    expect(isIssueClosed(open("ｸﾛｰｽﾞ"), r)).toBe(false);
    expect(isIssueClosed(open(), r)).toBe(false);
  });
  it("closedStatuses rỗng thì bỏ qua Status", () => {
    expect(isIssueClosed(open("Done"), rule([]))).toBe(false);
  });
});

describe("scanStatusField (AC-22)", () => {
  it("null khi closedStatuses rỗng, ngược lại là tên field", () => {
    expect(scanStatusField(rule([]))).toBeNull();
    expect(scanStatusField(rule(["Done"]))).toBe("Status");
  });
});
