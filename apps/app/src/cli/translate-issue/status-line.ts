/**
 * Dòng trạng thái của `translate-issue` (003b): hợp đồng chống lộ dữ liệu.
 * Mọi giá trị là mã từ danh sách cố định, số, hoặc `code` của lỗi Node/SQLite; giá trị lạ làm hàm ném Error.
 * Thông báo lỗi chỉ nêu tên key, không bao giờ chứa giá trị bị từ chối.
 */

export type Outcome = "OK" | "FAIL";

const FIXED_CODES = new Set([
  "usage",
  "input_not_found",
  "input_unreadable",
  "input_encoding",
  "input_not_json",
  "input_bad_shape",
  "data_dir_invalid",
  "output_write",
  "internal",
]);
const REASON_CODE = /^(storage|translate):[a-z_]+$/;
const SAFE_TOKEN = /^[A-Za-z0-9_:./-]+$/;
const SAFE_DETAIL = /^[a-z_]+$/;
const CACHE_VALUE = /^(ok|warn:(engineVersion|lookup|store)(\/sqlite=[A-Za-z0-9_]+)?)$/;

export interface StatusFields {
  /** Chi tiết của lỗi (chỉ ở nhánh FAIL). */
  code?: string | number;
  migration?: string | number;
  sqlite?: string | number;
  detail?: string;
  enc?: "utf8" | "utf8-bom" | "utf16le-bom";
  jaChars?: number;
  srcChars?: number;
  segments?: number;
  hits?: number;
  misses?: number;
  engine?: "called" | "skipped";
  ms?: number;
  cache?: string;
  data?: "APP_DATA_DIR" | "LOCALAPPDATA" | "XDG_DATA_HOME" | "fallback";
  tmpLeft?: number;
}

type Validator = (v: unknown) => boolean;
const oneOf = (...xs: string[]): Validator => (v) => typeof v === "string" && xs.includes(v);
const count: Validator = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const token: Validator = (v) => count(v) || (typeof v === "string" && SAFE_TOKEN.test(v));

/** Thứ tự cố định của key. */
const SCHEMA: ReadonlyArray<readonly [keyof StatusFields, Validator]> = [
  ["code", token],
  ["migration", token],
  ["sqlite", token],
  ["detail", (v) => typeof v === "string" && SAFE_DETAIL.test(v)],
  ["enc", oneOf("utf8", "utf8-bom", "utf16le-bom")],
  ["jaChars", count],
  ["srcChars", count],
  ["segments", count],
  ["hits", count],
  ["misses", count],
  ["engine", oneOf("called", "skipped")],
  ["ms", count],
  ["cache", (v) => typeof v === "string" && CACHE_VALUE.test(v)],
  ["data", oneOf("APP_DATA_DIR", "LOCALAPPDATA", "XDG_DATA_HOME", "fallback")],
  ["tmpLeft", count],
];

export function formatStatusLine(input: { outcome: Outcome; code?: string; fields: StatusFields }): string {
  const { outcome, code, fields } = input;
  if (outcome !== "OK" && outcome !== "FAIL") throw new Error("status line: outcome không hợp lệ");
  if (outcome === "OK" && code !== undefined) throw new Error("status line: OK không có mã");
  if (outcome === "FAIL" && (code === undefined || !(FIXED_CODES.has(code) || REASON_CODE.test(code)))) {
    throw new Error("status line: mã lỗi không hợp lệ");
  }
  const known = new Set<string>(SCHEMA.map(([k]) => k));
  for (const key of Object.keys(fields)) {
    if (!known.has(key)) throw new Error("status line: key lạ");
  }
  const parts = ["translate-issue", outcome];
  if (code !== undefined) parts.push(code);
  for (const [key, valid] of SCHEMA) {
    const value = fields[key];
    if (value === undefined) continue;
    if (!valid(value)) throw new Error(`status line: giá trị không hợp lệ cho ${key}`);
    parts.push(`${key}=${value}`);
  }
  return parts.join(" ");
}
