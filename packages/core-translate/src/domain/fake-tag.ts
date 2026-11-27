// Nhận diện thẻ giả của prompt (`source|segment|context|glossary`), mở hoặc đóng, trong text chưa chuẩn hoá.
// Model đọc chữ theo nghĩa, nên mọi ký tự có NFKC (rồi hạ chữ thường) trùng ký tự của thẻ đều được coi là ký tự đó:
// `＜`, `﹤`, `ｓ`, `𝐬`, `Ⓢ`... Ký tự định dạng vô hình (\p{Cf}) được bỏ qua quanh `/` và giữa các chữ; khoảng trắng chỉ quanh `/`.
// Chỉ xét tương đương một-ký-tự-ra-một-ký-tự; ký tự ghép NFKC ra nhiều chữ (vd. `ﬆ` → "st") không được tính.
// Logic thuần, không I/O. Bảng tương đương tính một lần khi nạp module theo Unicode của runtime, cùng NFKC mà
// `relevantTerms` dùng.

const TAG_NAMES = ["source", "segment", "context", "glossary"] as const;
const WORD_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789_";

function buildEquivalents(): Map<string, string[]> {
  const targets = new Set([..."<>/", ...WORD_CHARS]);
  const out = new Map<string, string[]>();
  for (let cp = 0; cp < 0x110000; cp++) {
    if (cp >= 0xd800 && cp < 0xe000) continue;
    const ch = String.fromCodePoint(cp);
    const n = ch.normalize("NFKC").toLowerCase();
    if (n.length === 1 && targets.has(n)) {
      const list = out.get(n);
      if (list) list.push(ch);
      else out.set(n, [ch]);
    }
  }
  return out;
}

const EQUIV = buildEquivalents();

function cls(chars: Iterable<string>): string {
  let body = "";
  for (const ch of chars) body += `\\u{${ch.codePointAt(0)!.toString(16)}}`;
  return `[${body}]`;
}

function equivClass(target: string): string {
  return cls(EQUIV.get(target) ?? [target]);
}

const IGN = "[\\s\\p{Cf}]*";
const OPEN = equivClass("<");
const CLOSE = equivClass(">");
const SLASH = equivClass("/");
const NOT_OPEN_CLOSE_NL = `[^${OPEN.slice(1, -1)}${CLOSE.slice(1, -1)}\\n]`;
// Thay cho `\b`: chữ/số/`_` kể cả dạng tương đương không được nối tiếp tên thẻ (`<sourcemap>` không phải thẻ).
const NO_WORD_AFTER = `(?!\\p{Cf}*${cls([...WORD_CHARS].flatMap((c) => EQUIV.get(c) ?? [c]))})`;
const NAME = `(?:${TAG_NAMES.map((name) => [...name].map(equivClass).join("\\p{Cf}*")).join("|")})${NO_WORD_AFTER}`;
const HEAD = `${IGN}${SLASH}?${IGN}${NAME}`;

const OPENER = new RegExp(`^${OPEN}$`, "u");

/** Ký tự có thể mở một thẻ giả (`<` hoặc dạng tương đương). */
export function isFakeTagOpener(ch: string): boolean {
  return OPENER.test(ch);
}

/**
 * Sticky: một thẻ giả bắt đầu đúng tại `lastIndex`, kéo tới dấu đóng `>` (hoặc tương đương) cùng dòng nếu có,
 * để model không thấy cả thuộc tính.
 */
export const FAKE_TAG = new RegExp(`${OPEN}${HEAD}${NOT_OPEN_CLOSE_NL}*${CLOSE}?`, "uy");

const FAKE_TAG_OPEN_GLOBAL = new RegExp(`${OPEN}(?=${HEAD})`, "gu");

/** Đổi dấu mở của mọi thẻ giả thành `‹` (không còn đọc được như thẻ), giữ nguyên phần còn lại. */
export function defuseFakeTags(s: string): string {
  return s.replace(FAKE_TAG_OPEN_GLOBAL, "‹");
}
