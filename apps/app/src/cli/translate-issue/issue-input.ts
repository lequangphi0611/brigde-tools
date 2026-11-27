/** Hàm thuần đầu vào của `translate-issue` (003b). Không I/O, không giữ message của lỗi parse (có thể trích nội dung). */

export type InputEncoding = "utf8" | "utf8-bom" | "utf16le-bom";
export type InputErrorCode = "input_encoding" | "input_not_json" | "input_bad_shape";

export type DecodeResult = { readonly enc: InputEncoding; readonly text: string } | { readonly error: "input_encoding" };
export type ParseResult = { readonly title: string; readonly body: string } | { readonly error: "input_not_json" | "input_bad_shape" };

/** Giải mã theo BOM: UTF-8 (có/không BOM), UTF-16LE có BOM. UTF-16BE hoặc byte UTF-8 sai → `input_encoding`. */
export function decodeInputBytes(bytes: Uint8Array): DecodeResult {
  try {
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      const text = new TextDecoder("utf-16le", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(2));
      return { enc: "utf16le-bom", text };
    }
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { error: "input_encoding" };
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(3));
      return { enc: "utf8-bom", text };
    }
    return { enc: "utf8", text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
  } catch {
    return { error: "input_encoding" };
  }
}

/** JSON phải là object có `title: string` và `body: string`; trường khác bỏ qua. */
export function parseIssueJson(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: "input_not_json" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { error: "input_bad_shape" };
  const { title, body } = value as Record<string, unknown>;
  if (typeof title !== "string" || typeof body !== "string") return { error: "input_bad_shape" };
  return { title, body };
}

const JAPANESE = /[぀-ゟ゠-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]|[\u{20000}-\u{2fa1f}]/gu;

/** Số ký tự kana/kanji (kể cả katakana nửa chiều rộng, CJK mở rộng). 0 với issue tiếng Nhật → file đã hỏng encoding. */
export function countJapaneseChars(text: string): number {
  return text.match(JAPANESE)?.length ?? 0;
}
