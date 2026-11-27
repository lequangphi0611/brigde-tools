// Phần giữ nguyên (ProtectedSpan): logic thuần, không I/O. Thay mỗi phần phải giữ nguyên bằng chỗ giữ `⟦N⟧`
// trước khi gửi đi dịch, rồi thay ngược lại đúng nguyên văn. Scanner tự viết cho đúng các loại trong spec 001.

export const PLACEHOLDER_OPEN = "⟦";
export const PLACEHOLDER_CLOSE = "⟧";

export interface ProtectedText {
  /** Văn bản đã che, chứa `⟦1⟧ … ⟦n⟧` tăng dần theo thứ tự xuất hiện. */
  readonly masked: string;
  /** `spans[i]` là nguyên văn của chỗ giữ `⟦i+1⟧`. */
  readonly spans: ReadonlyArray<string>;
}

export type RestoreResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly detail: "placeholder_mismatch" };

export function placeholder(n: number): string {
  return `${PLACEHOLDER_OPEN}${n}${PLACEHOLDER_CLOSE}`;
}

const PLACEHOLDER_RE = /⟦(\d+)⟧/g;

/** Còn chữ cần dịch không (ngoài chỗ giữ và khoảng trắng)? */
export function hasTranslatableText(masked: string): boolean {
  return masked.replace(PLACEHOLDER_RE, "").trim() !== "";
}

interface Range {
  readonly start: number;
  readonly end: number;
}

/** Che các phần giữ nguyên. Thuần và xác định. */
export function protect(text: string): ProtectedText {
  const spans: string[] = [];
  let masked = "";
  let cursor = 0;
  const emit = (start: number, end: number): void => {
    masked += text.slice(cursor, start);
    spans.push(text.slice(start, end));
    masked += placeholder(spans.length);
    cursor = end;
  };

  // Pass 1: fenced code block (theo dòng). Pass 2: quét inline, nhảy qua các fence (comment HTML được phép bao fence).
  const found = scanInline(text, findFences(text));
  for (const r of found) emit(r.start, r.end);
  masked += text.slice(cursor);
  return { masked, spans };
}

/**
 * Thay chỗ giữ bằng nguyên văn trong một lượt (nguyên văn có chứa `⟦1⟧` không bị thay lần hai).
 * Mỗi chỗ giữ phải xuất hiện đúng một lần và không có chỗ giữ lạ, nếu không → mismatch.
 */
export function restore(translated: string, spans: ReadonlyArray<string>): RestoreResult {
  const seen = new Array<number>(spans.length).fill(0);
  let bad = false;
  const text = translated.replace(PLACEHOLDER_RE, (whole, digits: string) => {
    const idx = Number(digits) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= spans.length) {
      bad = true;
      return whole;
    }
    seen[idx]!++;
    return spans[idx]!;
  });
  if (bad || seen.some((n) => n !== 1)) return { ok: false, detail: "placeholder_mismatch" };
  return { ok: true, text };
}

// ---------- fenced code ----------

const FENCE_OPEN = /^[ \t>]*(`{3,}|~{3,})([^\n]*)$/;

function findFences(text: string): Range[] {
  const out: Range[] = [];
  let pos = 0;
  let open: { markerStart: number; ch: string; len: number } | null = null;
  while (pos <= text.length) {
    let eol = text.indexOf("\n", pos);
    if (eol === -1) eol = text.length;
    const lineEnd = eol > pos && text[eol - 1] === "\r" ? eol - 1 : eol; // CRLF: \r không thuộc nội dung dòng
    const line = text.slice(pos, lineEnd);
    if (open === null) {
      const m = FENCE_OPEN.exec(line);
      if (m && !(m[1]![0] === "`" && m[2]!.includes("`"))) {
        open = { markerStart: pos + line.indexOf(m[1]!), ch: m[1]![0]!, len: m[1]!.length };
      }
    } else {
      const m = /^[ \t>]*(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (m && m[1]![0] === open.ch && m[1]!.length >= open.len) {
        out.push({ start: open.markerStart, end: lineEnd });
        open = null;
      }
    }
    if (eol >= text.length) break;
    pos = eol + 1;
  }
  if (open) out.push({ start: open.markerStart, end: text.length });
  return out;
}

// ---------- inline ----------

const REF_DEF = /[ \t]{0,3}(\[(?!\^)[^\]\n]+\]:[ \t]*\S+(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?)[ \t]*(?=\r?\n|$)/y;
const AUTOLINK = /<[a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*>/y;
const BARE_URL = /https?:\/\/[^\s<>`\u0080-￿]+/y; // dừng ở ký tự ngoài ASCII (chữ Nhật liền URL vẫn được dịch)
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/y;
const MENTION = /@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\/[A-Za-z0-9._-]+)?/y;
// Thẻ phân cách của prompt (source|segment|context|glossary), mở hoặc đóng, ASCII hoặc toàn chiều rộng, cho phép khoảng trắng bên trong.
// Che từ dấu mở tới dấu đóng `>`/`＞` cùng dòng (nếu có) để model không thấy cả thuộc tính.
const FAKE_TAG = /[<＜][\s\p{Cf}]*[\/／]?[\s\p{Cf}]*(?:source|segment|context|glossary)\b[^<>＜＞\n]*[>＞]?/iuy;
const FAKE_PLACEHOLDER = /⟦\d*⟧/y;
const EMAIL_LOCAL = /[A-Za-z0-9._%+-]/;
const WORD = /[A-Za-z0-9_]/;

function sticky(re: RegExp, text: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(text);
}

function scanInline(text: string, fences: ReadonlyArray<Range>): Range[] {
  const out: Range[] = [];
  let i = 0;
  let fi = 0; // fence kế tiếp chưa qua
  let regionStart = 0;
  let end = fences.length > 0 ? fences[0]!.start : text.length; // các phần inline không vượt qua fence
  let openBrackets = 0;
  const skipFencesBefore = (pos: number): void => {
    while (fi < fences.length && fences[fi]!.start < pos) fi++;
    end = fi < fences.length ? fences[fi]!.start : text.length;
  };
  const push = (start: number, stop: number): void => {
    out.push({ start, end: stop });
    i = stop;
  };

  while (i < text.length) {
    if (i >= end) {
      // Tới fence: che nguyên khối rồi quét tiếp sau nó.
      const f = fences[fi]!;
      push(f.start, f.end);
      skipFencesBefore(i);
      regionStart = i;
      openBrackets = 0;
      continue;
    }
    const c = text[i]!;
    const atLineStart = i === 0 || text[i - 1] === "\n";
    if (atLineStart && isBlankLineAfter(text, i, text.length)) openBrackets = 0; // `[` không nối qua đoạn văn

    if (atLineStart && (c === "[" || c === " " || c === "\t")) {
      const m = sticky(REF_DEF, text, i);
      if (m && i + m[0].length <= end) {
        const start = i + m[0].indexOf(m[1]!);
        push(start, start + m[1]!.length);
        continue;
      }
    }

    if (c === "\\" && i + 1 < end && "`[]()!\\".includes(text[i + 1]!)) {
      i += 2;
      continue;
    }

    if (c === "`") {
      let n = 1;
      while (i + n < end && text[i + n] === "`") n++;
      const close = findBacktickRun(text, i + n, end, n);
      if (close !== -1) push(i, close + n);
      else i += n;
      continue;
    }

    if (c === "<" || c === "＜") {
      const tag = sticky(FAKE_TAG, text, i);
      if (tag && i + tag[0].length <= end) {
        push(i, i + tag[0].length);
        continue;
      }
    }

    if (c === "<") {
      if (text.startsWith("<!--", i)) {
        const close = text.indexOf("-->", i + 4);
        if (close !== -1) {
          // Comment có thể bao cả fence: che một khối, bỏ qua các fence nằm trong nó.
          let stop = close + 3;
          for (const f of fences) if (f.start < stop && stop < f.end) stop = f.end; // `-->` nằm trong fence → che hết fence
          push(i, stop);
          skipFencesBefore(i);
          continue;
        }
      }
      const al = sticky(AUTOLINK, text, i);
      if (al && i + al[0].length <= end) {
        push(i, i + al[0].length);
        continue;
      }
    }

    if (c === PLACEHOLDER_OPEN || c === PLACEHOLDER_CLOSE) {
      const m = c === PLACEHOLDER_OPEN ? sticky(FAKE_PLACEHOLDER, text, i) : null;
      push(i, i + (m && i + m[0].length <= end ? m[0].length : 1));
      continue;
    }

    if (c === "h") {
      const m = sticky(BARE_URL, text, i);
      if (m && i + m[0].length <= end) {
        push(i, i + trimUrl(m[0]).length);
        continue;
      }
    }

    if (EMAIL_LOCAL.test(c) && (i === regionStart || !EMAIL_LOCAL.test(text[i - 1]!))) {
      const m = sticky(EMAIL, text, i);
      if (m && i + m[0].length <= end) {
        push(i, i + m[0].length);
        continue;
      }
    }

    if (c === "@" && (i === regionStart || !WORD.test(text[i - 1]!))) {
      const m = sticky(MENTION, text, i);
      if (m && i + m[0].length <= end) {
        push(i, i + m[0].length);
        continue;
      }
    }

    if (c === "[") {
      openBrackets++;
    } else if (c === "]" && openBrackets > 0) {
      openBrackets--;
      if (text[i + 1] === "(") {
        const close = findLinkDestEnd(text, i + 1, end);
        if (close !== -1) {
          push(i + 1, close + 1);
          continue;
        }
      }
    }
    i++;
  }
  return out;
}

function isBlankLineAfter(text: string, from: number, end: number): boolean {
  let k = from;
  while (k < end && (text[k] === " " || text[k] === "\t" || text[k] === "\r")) k++;
  return k < end && text[k] === "\n";
}

function findBacktickRun(text: string, from: number, end: number, n: number): number {
  let j = from;
  while (j < end) {
    if (text[j] === "\n" && isBlankLineAfter(text, j + 1, end)) return -1; // code span không vượt dòng trống
    if (text[j] !== "`") {
      j++;
      continue;
    }
    let k = j;
    while (k < end && text[k] === "`") k++;
    if (k - j === n) return j;
    j = k;
  }
  return -1;
}

/** Tìm `)` đóng của `(url "title")` bắt đầu ở `open`. Không vượt qua xuống dòng. -1 nếu không có hoặc rỗng. */
function findLinkDestEnd(text: string, open: number, end: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let j = open; j < end; j++) {
    const ch = text[j]!;
    if (ch === "\n") return -1;
    if (ch === "\\") {
      j++;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if ((ch === '"' || ch === "'") && /\s/.test(text[j - 1]!)) {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return text.slice(open + 1, j).trim() === "" ? -1 : j;
    }
  }
  return -1;
}

/** Bỏ dấu câu thừa ở cuối URL trần. */
function trimUrl(url: string): string {
  let u = url;
  for (;;) {
    const last = u[u.length - 1]!;
    if (/[.,;:!?'"*_~]/.test(last)) u = u.slice(0, -1);
    else if (last === ")" && count(u, ")") > count(u, "(")) u = u.slice(0, -1);
    else if (last === "]" && count(u, "]") > count(u, "[")) u = u.slice(0, -1);
    else return u;
  }
}

function count(s: string, ch: string): number {
  return s.split(ch).length - 1;
}
