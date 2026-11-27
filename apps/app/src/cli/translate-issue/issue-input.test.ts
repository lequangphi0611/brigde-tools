import { describe, expect, it } from "vitest";
import { countJapaneseChars, decodeInputBytes, parseIssueJson } from "./issue-input.ts";

const json = '{"title":"ログイン不具合","body":"再現手順があります"}';
const utf8 = (s: string) => new TextEncoder().encode(s);
const utf16le = (s: string) => {
  const b = Buffer.alloc(s.length * 2);
  b.write(s, "utf16le");
  return b;
};

describe("decodeInputBytes (AC-5)", () => {
  it("nhận UTF-8, UTF-8 có BOM, UTF-16LE có BOM cho cùng text", () => {
    const a = decodeInputBytes(utf8(json));
    const b = decodeInputBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), utf8(json)]));
    const c = decodeInputBytes(Buffer.concat([Buffer.from([0xff, 0xfe]), utf16le(json)]));
    expect(a).toEqual({ enc: "utf8", text: json });
    expect(b).toEqual({ enc: "utf8-bom", text: json });
    expect(c).toEqual({ enc: "utf16le-bom", text: json });
  });

  it("từ chối UTF-16BE, UTF-8 sai byte, UTF-16LE cụt", () => {
    expect(decodeInputBytes(Buffer.from([0xfe, 0xff, 0x00, 0x7b]))).toEqual({ error: "input_encoding" });
    expect(decodeInputBytes(Buffer.from([0x7b, 0xff, 0xfe, 0x7d]))).toEqual({ error: "input_encoding" });
    expect(decodeInputBytes(Buffer.from([0xff, 0xfe, 0x7b]))).toEqual({ error: "input_encoding" });
  });

  it("không chuẩn hoá \\r\\n", () => {
    expect(decodeInputBytes(utf8("a\r\nb"))).toEqual({ enc: "utf8", text: "a\r\nb" });
  });
});

describe("parseIssueJson (AC-7)", () => {
  it("nhận title/body, bỏ qua trường khác, chuỗi rỗng hợp lệ", () => {
    expect(parseIssueJson('{"title":"","body":"","number":12}')).toEqual({ title: "", body: "" });
    expect(parseIssueJson(json)).toEqual({ title: "ログイン不具合", body: "再現手順があります" });
  });

  it("JSON cụt → input_not_json và không lộ nội dung", () => {
    const r = parseIssueJson('{"title":"秘密ABC');
    expect(r).toEqual({ error: "input_not_json" });
    expect(JSON.stringify(r)).not.toContain("秘密");
  });

  it("sai hình dạng → input_bad_shape", () => {
    for (const t of ["[]", '{"title":"a"}', '{"title":1,"body":""}', "null", '"x"', '{"title":"a","body":null}']) {
      expect(parseIssueJson(t)).toEqual({ error: "input_bad_shape" });
    }
  });
});

describe("countJapaneseChars (AC-6)", () => {
  it("đếm kana và kanji", () => {
    expect(countJapaneseChars("ログイン不具合")).toBe(7);
    expect(countJapaneseChars("ひらがなカタカナ漢字")).toBe(10);
    expect(countJapaneseChars("𠮷")).toBe(1);
  });

  it("file hỏng thành ? cho 0", () => {
    expect(countJapaneseChars("???????" + "??? ??")).toBe(0);
    expect(countJapaneseChars("plain English 123")).toBe(0);
  });
});
