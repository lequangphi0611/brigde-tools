/** Mốc GitHub so bằng thời điểm (`Date.parse`), không so chuỗi. */
export function isAfter(a: string, b: string): boolean {
  return Date.parse(a) > Date.parse(b);
}

/** Trả mốc lớn hơn (giữ nguyên chuỗi gốc); bằng nhau thì giữ `a`. */
export function laterTimestamp(a: string, b: string): string {
  return isAfter(b, a) ? b : a;
}
