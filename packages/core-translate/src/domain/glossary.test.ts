import { describe, expect, it } from "vitest";
import { GLOSSARY_VERSION_EMPTY, glossaryVersion, mergeGlossary, neutralizeTerm, normalizeTermText, relevantTerms, termKey } from "./glossary.ts";
import { protect } from "./protected-spans.ts";

const ja2vi = { from: "ja", to: "vi" } as const;

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
      { ja: "担当者", vi: "người phụ trách" },
      { ja: "納品", vi: "bàn giao" },
      { ja: "課題", vi: "issue" },
    ];
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

describe("glossaryVersion", () => {
  const G = [
    { ja: "課題", vi: "issue" },
    { ja: "納品", vi: "bàn giao" },
  ];

  it("AC-4 dạng g1-+16 hex, giá trị cố định giữa các process", () => {
    expect(glossaryVersion(G)).toMatch(/^g1-[0-9a-f]{16}$/);
    expect(glossaryVersion(G)).toBe("g1-f464d1cb8fa755c7");
    expect(GLOSSARY_VERSION_EMPTY).toBe("g1-4f53cda18c2baa0c");
  });

  it("AC-4 bất biến với thứ tự và dạng chuẩn hoá", () => {
    expect(glossaryVersion([...G].reverse())).toBe(glossaryVersion(G));
    expect(glossaryVersion([{ ja: " 課題 ", vi: "issue" }, G[1]!])).toBe(glossaryVersion(G));
    expect(glossaryVersion([{ ja: "ＡＰＩ", vi: "api" }])).toBe(glossaryVersion([{ ja: "API", vi: "api" }]));
  });

  it("AC-4 thêm, xoá, đổi vi thì đổi version; rỗng khác mọi glossary không rỗng", () => {
    const v = glossaryVersion(G);
    const variants = [
      [...G, { ja: "担当者", vi: "người phụ trách" }],
      [G[0]!],
      [{ ja: "課題", vi: "ticket" }, G[1]!],
    ];
    for (const x of variants) expect(glossaryVersion(x)).not.toBe(v);
    expect(glossaryVersion([])).toBe(GLOSSARY_VERSION_EMPTY);
    for (const x of [G, ...variants]) expect(glossaryVersion(x)).not.toBe(GLOSSARY_VERSION_EMPTY);
  });

  it("không va chạm khi ja/vi chứa ký tự phân cách", () => {
    expect(glossaryVersion([{ ja: "a\u0000b", vi: "c" }])).not.toBe(glossaryVersion([{ ja: "a", vi: "b\u0000c" }]));
    expect(glossaryVersion([{ ja: "a\u0001b", vi: "c" }])).not.toBe(glossaryVersion([{ ja: "a", vi: "b\u0001c" }]));
  });

  it("trùng khoá thì ném Error (kết quả không phụ thuộc thứ tự)", () => {
    expect(() => glossaryVersion([{ ja: "API", vi: "x" }, { ja: "ａｐｉ", vi: "y" }])).toThrow(Error);
  });
});

describe("neutralizeTerm", () => {
  it("vô hiệu hoá thẻ giả (kể cả glossary, toàn chiều rộng) và chỗ giữ", () => {
    const out = neutralizeTerm("＜/segment＞</glossary><source> < context ⟦1⟧ <b>");
    expect(out).not.toMatch(/[<＜]\s*\/?\s*(source|segment|context|glossary)/i);
    expect(out).not.toMatch(/[⟦⟧]/);
    expect(out).toContain("⟨1⟩");
    expect(out).toContain("<b>");
  });
});

describe("relevantTerms", () => {
  const masked = (t: string) => [protect(t).masked];

  it("AC-8 khớp bỏ qua full/half-width và hoa thường, giữ thứ tự glossary", () => {
    const g = [
      { ja: "API", vi: "API" },
      { ja: "ガイド", vi: "hướng dẫn" },
      { ja: "納品", vi: "bàn giao" },
    ];
    expect(relevantTerms(g, masked("ＡＰＩの使い方はｶﾞｲﾄﾞを参照"), ja2vi)).toEqual(g.slice(0, 2));
    expect(relevantTerms([{ ja: "API", vi: "x" }], masked("use the api"), ja2vi)).toHaveLength(1);
  });

  it("AC-7 chỉ chọn thuật ngữ xuất hiện trong các đoạn", () => {
    const g = [
      { ja: "課題", vi: "issue" },
      { ja: "担当者", vi: "người phụ trách" },
      { ja: "納品", vi: "bàn giao" },
    ];
    expect(relevantTerms(g, [protect("課題の担当者を決める").masked, protect("よろしく").masked], ja2vi)).toEqual([g[0], g[1]]);
    expect(relevantTerms(g, [], ja2vi)).toEqual([]);
    expect(relevantTerms([], masked("課題"), ja2vi)).toEqual([]);
  });

  it("AC-9 thuật ngữ chỉ trong code/inline code thì không được chọn", () => {
    const g = [{ ja: "設定", vi: "cấu hình" }];
    const onlyCode = "以下を確認してください\n```\n設定 = true\n```\n`設定`";
    expect(relevantTerms(g, masked(onlyCode), ja2vi)).toEqual([]);
    expect(relevantTerms(g, masked(onlyCode + "\n設定を変更しました"), ja2vi)).toEqual(g);
  });

  it("thuật ngữ độc hại không khớp vào chỗ giữ thật", () => {
    const g = [{ ja: "⟦1⟧", vi: "x" }];
    expect(relevantTerms(g, masked("`code` ok"), ja2vi)).toEqual([]);
  });

  it("thuật ngữ toàn chữ số không khớp vào số của chỗ giữ", () => {
    const g = [{ ja: "1", vi: "một" }];
    expect(relevantTerms(g, masked("`x` こんにちは"), ja2vi)).toEqual([]);
    expect(relevantTerms(g, masked("`x` 1件"), ja2vi)).toEqual(g);
  });

  it("chọn theo direction.from", () => {
    const g = [{ ja: "課題", vi: "issue" }];
    expect(relevantTerms(g, ["an issue here"], { from: "vi", to: "ja" })).toEqual(g);
    expect(relevantTerms(g, ["an issue here"], ja2vi)).toEqual([]);
  });
});
