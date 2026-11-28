import { describe, expect, it } from "vitest";
import { formatPollLine } from "./poll-line.ts";
import type { PollStats } from "./poll-report.ts";

const stats = (over: Partial<PollStats> = {}): PollStats => ({
  issues: 286, closed: 263, skipped: { pullRequest: 0, draftIssue: 0, inaccessible: 0 }, pages: 3,
  details: 2, missing: 0, newIssues: 1, newComments: 1, edited: 0, closedChanged: 1, failed: 0, ...over,
});

describe("AC-27 formatPollLine", () => {
  it("BASELINE", () => {
    expect(formatPollLine({ status: "BASELINE", stats: stats(), ms: 1900 })).toBe(
      "[poll] BASELINE issues=286 closed=263 skipped=pr:0,draft:0,noaccess:0 pages=3 ms=1900",
    );
  });
  it("OK", () => {
    expect(formatPollLine({ status: "OK", stats: stats(), ms: 2600 })).toBe(
      "[poll] OK issues=286 closed=263 details=2 missing=0 new=1 newComments=1 edited=0 closedChanged=1 failed=0 pages=3 ms=2600",
    );
  });
  it("PARTIAL và warn", () => {
    expect(formatPollLine({ status: "PARTIAL", stats: stats({ failed: 1, newIssues: 0, closedChanged: 0 }), warn: "status_field_missing", ms: 2500 })).toBe(
      "[poll] PARTIAL issues=286 closed=263 details=2 missing=0 new=0 newComments=1 edited=0 closedChanged=0 failed=1 pages=3 warn=status_field_missing ms=2500",
    );
  });
  it("FAIL các loại", () => {
    expect(formatPollLine({ status: "FAIL", cause: { type: "github", reason: "not_authenticated" }, ms: 800 })).toBe("[poll] FAIL github:not_authenticated ms=800");
    expect(formatPollLine({ status: "FAIL", cause: { type: "storage", sqliteCode: 5 } })).toBe("[poll] FAIL storage sqlite=5");
    expect(formatPollLine({ status: "FAIL", cause: { type: "storage" } })).toBe("[poll] FAIL storage");
    expect(formatPollLine({ status: "FAIL", cause: { type: "internal" } })).toBe("[poll] FAIL internal");
  });
});
