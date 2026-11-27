import { describe, expect, it } from "vitest";
import { trackingDecision, needsDetails } from "./tracking-decision.ts";

const closeRule = { statusField: "Status", closedStatuses: ["Done"] };
const stamp = (updatedAt: string, state: "OPEN" | "CLOSED" = "OPEN", status: string | null = null) => ({
  updatedAt,
  state,
  status: status === null ? null : { name: status, optionId: "o" },
});
const decide = (s: ReturnType<typeof stamp>, stored: string | undefined, baselined = true) =>
  trackingDecision({ stamp: s, stored: stored === undefined ? undefined : { ghUpdatedAt: stored }, closeRule, baselined });

describe("trackingDecision", () => {
  it("AC-1: project chưa lấy mốc → baseline, closed theo quy tắc", () => {
    expect(decide(stamp("2026-11-20T10:00:00Z"), undefined, false)).toEqual({ kind: "baseline", closed: false });
    expect(decide(stamp("2026-11-20T10:00:00Z", "CLOSED"), undefined, false)).toEqual({ kind: "baseline", closed: true });
  });
  it("AC-20: đóng, chưa biết → store_closed (kể cả theo Status)", () => {
    expect(decide(stamp("2026-11-20T10:00:00Z", "CLOSED"), undefined).kind).toBe("store_closed");
    expect(decide(stamp("2026-11-20T10:00:00Z", "OPEN", "done"), undefined).kind).toBe("store_closed");
  });
  it("AC-18: đóng, đã biết → skip_closed", () => {
    expect(decide(stamp("2026-11-20T10:30:00Z", "CLOSED"), "2026-11-20T10:00:00Z").kind).toBe("skip_closed");
  });
  it("AC-3/4: mở, chưa biết → discover, kể cả updatedAt rất cũ", () => {
    expect(decide(stamp("2025-01-01T00:00:00Z"), undefined).kind).toBe("discover");
  });
  it("AC-6: mở, đã biết, updatedAt mới hơn → refresh", () => {
    expect(decide(stamp("2026-11-20T10:30:00Z"), "2026-11-20T10:00:00Z").kind).toBe("refresh");
  });
  it("AC-5: bằng hoặc lùi → unchanged", () => {
    expect(decide(stamp("2026-11-20T10:00:00Z"), "2026-11-20T10:00:00Z").kind).toBe("unchanged");
    expect(decide(stamp("2026-11-20T09:00:00Z"), "2026-11-20T10:00:00Z").kind).toBe("unchanged");
  });
  it("so bằng thời điểm, không so chuỗi (múi giờ/định dạng khác nhau)", () => {
    expect(decide(stamp("2026-11-20T19:00:00+09:00"), "2026-11-20T10:00:00Z").kind).toBe("unchanged");
    expect(decide(stamp("2026-11-20T19:00:01+09:00"), "2026-11-20T10:00:00Z").kind).toBe("refresh");
  });
  it("chỉ discover và refresh cần chi tiết", () => {
    const need = (["baseline", "store_closed", "skip_closed", "discover", "refresh", "unchanged"] as const).filter(needsDetails);
    expect(need).toEqual(["discover", "refresh"]);
  });
});
