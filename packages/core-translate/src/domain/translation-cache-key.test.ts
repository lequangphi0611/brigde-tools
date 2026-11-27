import { describe, expect, it } from "vitest";
import { cacheKeyString, translationCacheKey, type EngineVersion } from "./translation-cache-key.ts";

const ja2vi = { from: "ja", to: "vi" } as const;
const vi2ja = { from: "vi", to: "ja" } as const;
const engine: EngineVersion = { promptVersion: "claude-cli/p1", configuredModel: "sonnet" };
const str = (text: string, glossary: Array<{ ja: string; vi: string }> = [], e: EngineVersion = engine, d = ja2vi) =>
  cacheKeyString(translationCacheKey(text, d, glossary, e));

describe("translationCacheKey", () => {
  it("sourceHash là sha256 hex 64 ký tự, direction dạng ja-vi", () => {
    const k = translationCacheKey("確認しました", ja2vi, [], engine);
    expect(k.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.direction).toBe("ja-vi");
    expect(k.promptVersion).toBe("claude-cli/p1");
    expect(k.configuredModel).toBe("sonnet");
  });

  it("AC-4 khác text (thêm ký tự, \\r\\n vs \\n) cho khoá khác; cùng đầu vào cho khoá giống", () => {
    expect(str("確認しました")).toBe(str("確認しました"));
    expect(str("確認しました")).not.toBe(str("確認しました。"));
    expect(str("a\nb")).not.toBe(str("a\r\nb"));
  });

  it("AC-4 khác chiều dịch hoặc promptVersion thì khoá khác", () => {
    expect(str("確認しました")).not.toBe(str("確認しました", [], engine, vi2ja));
    expect(str("確認しました")).not.toBe(str("確認しました", [], { ...engine, promptVersion: "claude-cli/p2" }));
  });

  it("AC-4 khoá chỉ khác một thành phần bất kỳ cho cacheKeyString khác nhau", () => {
    const base = translationCacheKey("x", ja2vi, [], engine);
    const variants = [
      { ...base, sourceHash: "0".repeat(64) },
      { ...base, direction: "vi-ja" },
      { ...base, glossaryVersion: "g1-other" },
      { ...base, promptVersion: "p2" },
      { ...base, configuredModel: "opus" },
    ];
    const all = new Set([base, ...variants].map(cacheKeyString));
    expect(all.size).toBe(6);
  });

  it("cacheKeyString không nhập nhằng khi dấu phân cách nằm trong giá trị", () => {
    const a = { sourceHash: "h", direction: "ja-vi", glossaryVersion: "g", promptVersion: 'a","b', configuredModel: "c" };
    const b = { sourceHash: "h", direction: "ja-vi", glossaryVersion: "g", promptVersion: "a", configuredModel: 'b","c' };
    expect(cacheKeyString(a)).not.toBe(cacheKeyString(b));
  });

  it("AC-5 khác configuredModel (kể cả \"\") thì khoá khác", () => {
    const m = (configuredModel: string) => str("確認しました", [], { ...engine, configuredModel });
    expect(m("sonnet")).not.toBe(m("opus"));
    expect(m("")).not.toBe(m("sonnet"));
    expect(m("")).toBe(m(""));
  });

  it("AC-8 khoá không phụ thuộc hint (không có tham số hint)", () => {
    expect(translationCacheKey.length).toBe(4);
  });

  describe("AC-7 glossaryVersion theo thuật ngữ liên quan của từng đoạn", () => {
    const g1 = [{ ja: "課題", vi: "issue" }];
    it("thêm thuật ngữ không xuất hiện trong đoạn thì khoá không đổi", () => {
      const g2 = [...g1, { ja: "納品", vi: "bàn giao" }];
      expect(str("課題を確認", g1)).toBe(str("課題を確認", g2));
      expect(str("よろしく", g1)).toBe(str("よろしく", g2));
    });
    it("đổi vi của thuật ngữ có trong đoạn thì khoá đổi, đoạn khác không đổi", () => {
      const g3 = [{ ja: "課題", vi: "ticket" }];
      expect(str("課題を確認", g1)).not.toBe(str("課題を確認", g3));
      expect(str("よろしく", g1)).toBe(str("よろしく", g3));
    });
    it("thuật ngữ chỉ nằm trong code block / inline code thì đổi nó không đổi khoá", () => {
      const g3 = [{ ja: "課題", vi: "ticket" }];
      for (const text of ["```\n課題\n```", "確認 `課題` です"]) {
        expect(str(text, g1)).toBe(str(text, g3));
      }
    });
    it("khác dạng full/half-width hoặc thứ tự nhưng cùng nội dung chuẩn hoá thì cùng khoá", () => {
      const a = [{ ja: "API", vi: "giao diện" }, { ja: "課題", vi: "issue" }];
      const b = [{ ja: "課題", vi: "issue" }, { ja: "ＡＰＩ", vi: "giao diện" }];
      expect(str("API 課題", a)).toBe(str("API 課題", b));
    });
  });
});
