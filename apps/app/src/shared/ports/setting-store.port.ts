/**
 * Port: cài đặt dạng khoá-giá trị, bền qua khởi động lại (ADR-0008). Đồng bộ như node:sqlite.
 * Khoá theo dạng `<context>.<tên>`, vd `notification.pausedUntil`; khoá sai mẫu → Error thường.
 * Context tự mã hoá giá trị (ISO string, JSON).
 */
export interface SettingStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

const KEY_PATTERN = /^[a-z]+\.[A-Za-z0-9_.-]{1,100}$/;

export function assertValidSettingKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new Error("Khoá cài đặt sai mẫu <context>.<tên>");
  }
}
