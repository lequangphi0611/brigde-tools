import { describe, expect, it } from "vitest";
import { hasTranslatableText, protect, restore } from "./protected-spans.ts";

function roundTrip(text: string): string {
  const p = protect(text);
  const r = restore(p.masked, p.spans);
  if (!r.ok) throw new Error("mismatch");
  return r.text;
}

describe("protect / restore", () => {
  it("không có gì để giữ thì masked = text", () => {
    expect(protect("こんにちは")).toEqual({ masked: "こんにちは", spans: [] });
  });

  it("AC-3 fenced code block", () => {
    const code = "```ts\n// 日本語コメント\nconst a = 1;\n```";
    const text = `手順:\n${code}\n以上`;
    const p = protect(text);
    expect(p.masked).toBe("手順:\n⟦1⟧\n以上");
    expect(p.spans).toEqual([code]);
    expect(roundTrip(text)).toBe(text);
  });

  it("AC-3 fence không đóng chạy tới hết segment; fence dài hơn 3 ký tự", () => {
    const text = "後半\n~~~~\n未完のコード\nまだ続く";
    const p = protect(text);
    expect(p.masked).not.toContain("未完のコード");
    expect(p.spans[0]).toBe("~~~~\n未完のコード\nまだ続く");
    expect(roundTrip(text)).toBe(text);
  });

  it("fence 4 backtick không bị đóng bởi fence 3 backtick", () => {
    const code = "````md\n```\nx\n```\n````";
    const p = protect(`前\n${code}\n後`);
    expect(p.spans).toEqual([code]);
  });

  it("``` trên một dòng có backtick trong info string không phải fence", () => {
    const p = protect("```a``` です");
    expect(p.spans).toEqual(["```a```"]);
  });

  it("AC-4 inline code, kể cả nhiều backtick", () => {
    const text = "`npm test` を実行し ``a ` b`` を確認";
    const p = protect(text);
    expect(p.masked).toBe("⟦1⟧ を実行し ⟦2⟧ を確認");
    expect(p.spans).toEqual(["`npm test`", "``a ` b``"]);
  });

  it("backtick lẻ không đóng thì là chữ thường", () => {
    expect(protect("it`s 変").spans).toEqual([]);
  });

  it("AC-5 giữ URL của link/ảnh, vẫn dịch chữ", () => {
    const text =
      '[設計書](https://ghe.example.co.jp/org/repo/wiki/設計 "仕様") と ![図](./img/図1.png) と <https://example.jp/a> と https://example.jp/b?x=1&y=2\n\n[ref]: https://example.jp/ref';
    const p = protect(text);
    expect(p.masked).toContain("[設計書]");
    expect(p.masked).toContain("![図]");
    expect(p.masked).not.toMatch(/example|img/);
    expect(p.spans).toEqual([
      '(https://ghe.example.co.jp/org/repo/wiki/設計 "仕様")',
      "(./img/図1.png)",
      "<https://example.jp/a>",
      "https://example.jp/b?x=1&y=2",
      "[ref]: https://example.jp/ref",
    ]);
    expect(roundTrip(text)).toBe(text);
  });

  it("URL trần bỏ dấu câu cuối và dừng ở dấu câu Nhật", () => {
    expect(protect("見て https://example.jp/a。次").spans).toEqual(["https://example.jp/a"]);
    expect(protect("(see https://example.jp/a).").spans).toEqual(["https://example.jp/a"]);
    expect(protect("https://en.wikipedia.org/wiki/A_(b) です").spans).toEqual(["https://en.wikipedia.org/wiki/A_(b)"]);
  });

  it("link có ngoặc cân bằng trong url", () => {
    expect(protect("[x](https://e.jp/a_(b)) 終").spans).toEqual(["(https://e.jp/a_(b))"]);
  });

  it("ảnh lồng trong link", () => {
    const p = protect("[![バッジ](a.png)](https://e.jp/b)");
    expect(p.masked).toBe("[![バッジ]⟦1⟧]⟦2⟧");
  });

  it("[x] (không có url) và footnote không bị che", () => {
    expect(protect("[x] 完了 [1] 参照").spans).toEqual([]);
    expect(protect("[^1]: 脚注").spans).toEqual([]);
  });

  it("AC-6 @mention, @org/team và email", () => {
    const text = "@tanaka と @my-org/dev-team に確認。連絡先 sato@example.co.jp";
    const p = protect(text);
    expect(p.masked).not.toMatch(/tanaka|dev-team|sato/);
    expect(p.spans).toEqual(["@tanaka", "@my-org/dev-team", "sato@example.co.jp"]);
    expect(roundTrip(text)).toBe(text);
  });

  it("AC-7 comment HTML", () => {
    const text = "<!-- ここに再現手順を書いてください -->\n再現手順: ログインする";
    const p = protect(text);
    expect(p.masked).toBe("⟦1⟧\n再現手順: ログインする");
    expect(roundTrip(text).startsWith("<!-- ここに再現手順を書いてください -->")).toBe(true);
  });

  it("comment HTML nhiều dòng; không đóng thì không che", () => {
    expect(protect("<!--\n日本語\n-->x").spans).toEqual(["<!--\n日本語\n-->"]);
    expect(protect("<!-- 未完").spans).toEqual([]);
  });

  it("AC-9 chỗ giữ giả trong nội dung được che và khôi phục đúng", () => {
    const text = "記号 ⟦1⟧ と `code`";
    const p = protect(text);
    expect(p.masked).toBe("記号 ⟦1⟧ と ⟦2⟧");
    expect(p.spans).toEqual(["⟦1⟧", "`code`"]);
    expect(roundTrip(text)).toBe(text);
  });

  it("ký tự ⟦ ⟧ lẻ cũng được che", () => {
    expect(protect("a⟦b⟧c").spans).toEqual(["⟦", "⟧"]);
    expect(roundTrip("a⟦b⟧c")).toBe("a⟦b⟧c");
  });
});

describe("restore", () => {
  it("thiếu, trùng hoặc lạ chỗ giữ → mismatch", () => {
    expect(restore("x", ["a"])).toEqual({ ok: false, detail: "placeholder_mismatch" });
    expect(restore("⟦1⟧⟦1⟧", ["a"])).toEqual({ ok: false, detail: "placeholder_mismatch" });
    expect(restore("⟦1⟧⟦2⟧", ["a"])).toEqual({ ok: false, detail: "placeholder_mismatch" });
  });

  it("cho phép đổi thứ tự chỗ giữ", () => {
    expect(restore("⟦2⟧ と ⟦1⟧", ["a", "b"])).toEqual({ ok: true, text: "b と a" });
  });

  it("không thay lần hai trong nguyên văn", () => {
    expect(restore("⟦1⟧ ⟦2⟧", ["⟦2⟧", "z"])).toEqual({ ok: true, text: "⟦2⟧ z" });
  });
});

describe("hasTranslatableText", () => {
  it("chỉ chỗ giữ + khoảng trắng thì không cần dịch", () => {
    expect(hasTranslatableText("⟦1⟧ \n ⟦2⟧")).toBe(false);
    expect(hasTranslatableText("  ")).toBe(false);
    expect(hasTranslatableText("⟦1⟧ ログ")).toBe(true);
  });
});
