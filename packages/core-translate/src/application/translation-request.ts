import type { TranslationRequest } from "./translator.port.ts";

/** Request sai là lỗi lập trình của bên gọi: ném Error thường (không phải TranslationFailure). */
export function assertValidTranslationRequest(request: TranslationRequest): void {
  const seen = new Set<string>();
  for (const s of request.segments) {
    if (typeof s.id !== "string" || s.id === "") throw new Error("TranslationSegment.id không được rỗng");
    if (seen.has(s.id)) throw new Error(`TranslationSegment.id bị trùng: ${s.id}`);
    seen.add(s.id);
  }
}
