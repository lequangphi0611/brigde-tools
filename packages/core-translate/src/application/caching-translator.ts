import { hasTranslatableText, protect } from "../domain/protected-spans.ts";
import { cacheKeyString, translationCacheKey, type EngineVersion, type TranslationCacheKey } from "../domain/translation-cache-key.ts";
import type { CachedTranslation, TranslationCache } from "./translation-cache.port.ts";
import { assertValidTranslationRequest } from "./translation-request.ts";
import type { TranslationRequest, TranslationResult, TranslationSegment, Translator } from "./translator.port.ts";

export type CacheStage = "engineVersion" | "lookup" | "store";

/** Quan sát cache cho log/số liệu (003b in ra, 009 ghi log). Không bao giờ nhận nội dung; lỗi của observer bị nuốt. */
export interface CachingObserver {
  lookedUp?(stats: { hits: number; misses: number }): void;
  cacheFailed?(stage: CacheStage, error: unknown): void;
}

export interface CachingTranslatorOptions {
  readonly inner: Translator;
  readonly cache: TranslationCache;
  /** Gọi mỗi lần dịch để khoá theo cấu hình hiện tại (ADR-0003: sửa cấu hình không cần restart). */
  readonly engineVersion: () => EngineVersion | Promise<EngineVersion>;
  readonly observer?: CachingObserver;
}

/**
 * Decorator `Translator` có cache theo đoạn (spec 003, ADR-0009): lọc đoạn đã có bản dịch trước khi gọi `inner`.
 * Lỗi của cache hoặc của `engineVersion` không làm hỏng lần dịch; lỗi của `inner` được ném lại nguyên đối tượng.
 */
export class CachingTranslator implements Translator {
  constructor(private readonly options: CachingTranslatorOptions) {}

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const { inner, cache, engineVersion } = this.options;
    // 1. Request sai bị từ chối trước mọi thao tác cache.
    assertValidTranslationRequest(request);

    // 2. Đoạn không có chữ cần dịch: trả nguyên văn, không tra, không ghi.
    const candidates = request.segments.filter((s) => hasTranslatableText(protect(s.text).masked));
    if (candidates.length === 0) return { segments: request.segments.map((s) => ({ id: s.id, text: s.text })), model: null };

    // 3. Phiên bản engine; lỗi → bỏ qua cache hoàn toàn.
    let version: EngineVersion;
    try {
      version = await engineVersion();
    } catch (error) {
      this.notifyFailed("engineVersion", error);
      return inner.translate(request);
    }

    // 4. Khoá từng đoạn, tra một lần; lỗi tra → mọi đoạn trượt.
    const keyOf = new Map<string, { key: TranslationCacheKey; keyString: string }>();
    for (const s of candidates) {
      const key = translationCacheKey(s.text, request.direction, request.context.glossary, version);
      keyOf.set(s.id, { key, keyString: cacheKeyString(key) });
    }
    let found: ReadonlyMap<string, CachedTranslation> = new Map();
    try {
      const unique = new Map([...keyOf.values()].map((k) => [k.keyString, k.key] as const));
      found = await cache.lookup([...unique.values()]);
    } catch (error) {
      this.notifyFailed("lookup", error);
    }

    // 5. Đoạn trượt, gộp trùng khoá (giữ id đoạn đầu tiên).
    let hits = 0;
    const misses: TranslationSegment[] = [];
    const representative = new Map<string, string>(); // keyString → id đại diện
    for (const s of candidates) {
      const { keyString } = keyOf.get(s.id)!;
      if (found.has(keyString)) {
        hits++;
      } else if (!representative.has(keyString)) {
        representative.set(keyString, s.id);
        misses.push({ id: s.id, text: s.text });
      }
    }
    this.notifyLookedUp({ hits, misses: candidates.length - hits });

    let translated = new Map<string, string>(); // id đại diện → bản dịch
    let model: string | null = null;
    if (misses.length > 0) {
      // 6–7. Một lần gọi cho phần trượt; lỗi ném nguyên đối tượng, không ghi gì.
      const result = await inner.translate({ direction: request.direction, segments: misses, context: request.context });
      model = result.model;
      translated = new Map(result.segments.map((s) => [s.id, s.text]));
      // Inner bỏ sót id là vi phạm hợp đồng Translator: lỗi lập trình, không ghi cache.
      const missing = misses.find((m) => !translated.has(m.id));
      if (missing) throw new Error(`Translator bên trong không trả đoạn có id: ${missing.id}`);
      // 8. Ghi cache; lỗi ghi không làm hỏng kết quả.
      try {
        await cache.store(
          misses.map((m) => ({ key: keyOf.get(m.id)!.key, value: { text: translated.get(m.id)!, model } })),
        );
      } catch (error) {
        this.notifyFailed("store", error);
      }
    }

    // 9. Đúng tập id, đúng thứ tự request.
    const segments = request.segments.map((s) => {
      const entry = keyOf.get(s.id);
      if (!entry) return { id: s.id, text: s.text };
      const cached = found.get(entry.keyString);
      if (cached) return { id: s.id, text: cached.text };
      return { id: s.id, text: translated.get(representative.get(entry.keyString)!)! };
    });
    return { segments, model };
  }

  private notifyFailed(stage: CacheStage, error: unknown): void {
    try {
      this.options.observer?.cacheFailed?.(stage, error);
    } catch {
      // observer hỏng không được làm hỏng lần dịch
    }
  }

  private notifyLookedUp(stats: { hits: number; misses: number }): void {
    try {
      this.options.observer?.lookedUp?.(stats);
    } catch {
      // như trên
    }
  }
}
