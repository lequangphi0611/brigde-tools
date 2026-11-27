import { describe, expect, it } from "vitest";
import { formatStatusLine } from "./status-line.ts";

describe("formatStatusLine (AC-13)", () => {
  it("OK với thứ tự key cố định, key chưa biết bị bỏ", () => {
    const line = formatStatusLine({
      outcome: "OK",
      fields: { tmpLeft: 0, data: "APP_DATA_DIR", cache: "ok", ms: 12, engine: "called", misses: 2, hits: 0, segments: 2, srcChars: 20, jaChars: 18, enc: "utf8" },
    });
    expect(line).toBe("translate-issue OK enc=utf8 jaChars=18 srcChars=20 segments=2 hits=0 misses=2 engine=called ms=12 cache=ok data=APP_DATA_DIR tmpLeft=0");
  });

  it("FAIL: mã và chi tiết đứng ngay sau outcome", () => {
    expect(formatStatusLine({ outcome: "FAIL", code: "input_not_found", fields: { code: "ENOENT" } })).toBe("translate-issue FAIL input_not_found code=ENOENT");
    expect(formatStatusLine({ outcome: "FAIL", code: "translate:bad_output", fields: { detail: "invalid_schema", hits: 0, misses: 2 } })).toBe(
      "translate-issue FAIL translate:bad_output detail=invalid_schema hits=0 misses=2",
    );
    expect(formatStatusLine({ outcome: "FAIL", code: "storage:open_failed", fields: { migration: 3, sqlite: 14 } })).toBe(
      "translate-issue FAIL storage:open_failed migration=3 sqlite=14",
    );
    expect(formatStatusLine({ outcome: "FAIL", code: "translate:not_configured", fields: { cache: "warn:engineVersion" } })).toContain("cache=warn:engineVersion");
    expect(formatStatusLine({ outcome: "OK", fields: { cache: "warn:store/sqlite=ERR_SQLITE_ERROR" } })).toContain("cache=warn:store/sqlite=ERR_SQLITE_ERROR");
  });

  it("not_configured: detail rồi field, field phải là tên key của schema", () => {
    expect(formatStatusLine({ outcome: "FAIL", code: "translate:not_configured", fields: { detail: "config_invalid", field: "timeoutSeconds", cache: "warn:engineVersion" } })).toBe(
      "translate-issue FAIL translate:not_configured detail=config_invalid field=timeoutSeconds cache=warn:engineVersion",
    );
    expect(() => formatStatusLine({ outcome: "FAIL", code: "translate:not_configured", fields: { field: "ZZSECRETZZ" } })).toThrow();
  });

  it("từ chối mã, key, giá trị lạ và không lặp giá trị đó trong thông báo", () => {
    const bad = "ZZSECRETZZ";
    const cases: Array<() => string> = [
      () => formatStatusLine({ outcome: "FAIL", code: bad, fields: {} }),
      () => formatStatusLine({ outcome: "FAIL", code: `translate:${bad}`, fields: {} }),
      () => formatStatusLine({ outcome: "FAIL", code: "internal", fields: { code: "C:\\Users\\tên bí mật" } }),
      () => formatStatusLine({ outcome: "FAIL", code: "internal", fields: { code: "秘密" } }),
      () => formatStatusLine({ outcome: "FAIL", code: "internal", fields: { code: "a b" } }),
      () => formatStatusLine({ outcome: "FAIL", code: "translate:bad_output", fields: { detail: "Invalid Schema" } }),
      () => formatStatusLine({ outcome: "OK", fields: { enc: bad as never } }),
      () => formatStatusLine({ outcome: "OK", fields: { engine: bad as never } }),
      () => formatStatusLine({ outcome: "OK", fields: { data: "/home/u/data" as never } }),
      () => formatStatusLine({ outcome: "OK", fields: { cache: bad } }),
      () => formatStatusLine({ outcome: "OK", fields: { ms: -1 } }),
      () => formatStatusLine({ outcome: "OK", fields: { ms: 1.5 } }),
      () => formatStatusLine({ outcome: "OK", fields: { hits: Number.NaN } }),
      () => formatStatusLine({ outcome: "OK", fields: { hits: "2" as never } }),
      () => formatStatusLine({ outcome: "OK", fields: { [bad]: 1 } as never }),
      () => formatStatusLine({ outcome: "OK", code: "usage", fields: {} }),
      () => formatStatusLine({ outcome: "FAIL", fields: {} }),
      () => formatStatusLine({ outcome: "MAYBE" as never, fields: {} }),
    ];
    for (const run of cases) {
      let message = "";
      try {
        run();
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain(bad);
      expect(message).not.toContain("秘密");
    }
  });
});
