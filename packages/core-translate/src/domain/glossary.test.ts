import { describe, expect, it } from "vitest";
import { mergeGlossary, normalizeTermText, termKey } from "./glossary.ts";

describe("normalizeTermText / termKey", () => {
  it("NFKC, gộp khoảng trắng (gồm U+3000, xuống dòng, tab), trim", () => {
    expect(normalizeTermText("ＡＰＩ　キー")).toBe("API キー");
    expect(normalizeTermText("ｶﾞｲﾄﾞ")).toBe("ガイド");
    expect(normalizeTermText(" 課題\n管理 ")).toBe("課題 管理");
    expect(normalizeTermText(" quản lý\tissue ")).toBe("quản lý issue");
  });

  it("termKey không phân biệt hoa thường", () => {
    expect(termKey("API")).toBe(termKey("ａｐｉ"));
    expect(termKey("ＡＰＩ　キー")).toBe("api キー");
  });
});

describe("mergeGlossary", () => {
  it("AC-1 project thắng khi trùng, sắp theo termKey, không phụ thuộc thứ tự", () => {
    const common = [
      { ja: "課題", vi: "vấn đề" },
      { ja: "担当者", vi: "người phụ trách" },
    ];
    const project = [
      { ja: "課題", vi: "issue" },
      { ja: "納品", vi: "bàn giao" },
    ];
    const expected = [
      { ja: "課題", vi: "issue" },
      { ja: "担当者", vi: "người phụ trách" },
      { ja: "納品", vi: "bàn giao" },
    ].sort((a, b) => (termKey(a.ja) < termKey(b.ja) ? -1 : 1));
    expect(mergeGlossary(common, project)).toEqual(expected);
    expect(mergeGlossary([...common].reverse(), [...project].reverse())).toEqual(expected);
    expect(mergeGlossary(common, project)).toHaveLength(3);
  });

  it("AC-2 khoá trùng sau NFKC, khoảng trắng và hoa thường; chuẩn hoá ja/vi", () => {
    const merged = mergeGlossary(
      [
        { ja: "ＡＰＩ　キー", vi: "khoá API" },
        { ja: "ｶﾞｲﾄﾞ", vi: "tài liệu hướng dẫn" },
      ],
      [
        { ja: "api キー", vi: "API key" },
        { ja: "ガイド", vi: "guide" },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged).toContainEqual({ ja: "api キー", vi: "API key" });
    expect(merged).toContainEqual({ ja: "ガイド", vi: "guide" });
    expect(mergeGlossary([{ ja: " 課題\n管理 ", vi: " quản lý\tissue " }], [])).toEqual([
      { ja: "課題 管理", vi: "quản lý issue" },
    ]);
  });

  it("AC-3 note bị bỏ; glossary sai ném Error thường, message không lộ vi", () => {
    expect(mergeGlossary([{ ja: "a", vi: "b", note: "n" }], [])).toEqual([{ ja: "a", vi: "b" }]);

    const secret = "BÍ-MẬT-VI";
    const bad: Array<() => unknown> = [
      () => mergeGlossary([{ ja: "API", vi: secret }, { ja: "ａｐｉ", vi: secret }], []),
      () => mergeGlossary([], [{ ja: "API", vi: secret }, { ja: "ａｐｉ", vi: secret }]),
      () => mergeGlossary([{ ja: "   ", vi: secret }], []),
      () => mergeGlossary([], [{ ja: "課題", vi: " 　\n" }]),
    ];
    for (const f of bad) {
      expect(f).toThrow(Error);
      try {
        f();
      } catch (e) {
        expect((e as Error).name).not.toBe("TranslationFailure");
        expect((e as Error).message).not.toContain(secret);
      }
    }
  });

  it("trùng khoá giữa hai tầng không phải lỗi; hai danh sách rỗng → rỗng", () => {
    expect(mergeGlossary([], [])).toEqual([]);
  });
});
