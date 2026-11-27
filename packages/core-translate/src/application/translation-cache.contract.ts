import { describe, expect, it } from "vitest";
import { cacheKeyString, type TranslationCacheKey } from "../domain/translation-cache-key.ts";
import type { TranslationCache } from "./translation-cache.port.ts";

/** Bộ hợp đồng chung cho mọi `TranslationCache` (spec 003 AC-14): bản in-memory và SQLite chạy cùng một bộ case. */
export function runTranslationCacheContract(name: string, options: { create: () => TranslationCache | Promise<TranslationCache> }): void {
  const key = (over: Partial<TranslationCacheKey> = {}): TranslationCacheKey => ({
    sourceHash: "a".repeat(64),
    direction: "ja-vi",
    glossaryVersion: "g1-0123456789abcdef",
    promptVersion: "fake/1",
    configuredModel: "",
    ...over,
  });

  describe(`TranslationCache contract: ${name}`, () => {
    it("AC-14 lookup khoá chưa có trả map rỗng", async () => {
      const cache = await options.create();
      expect((await cache.lookup([key()])).size).toBe(0);
      expect((await cache.lookup([])).size).toBe(0);
    });

    it("AC-14 store rồi lookup trả đúng text và model, giữ nguyên từng byte", async () => {
      const cache = await options.create();
      const texts = [
        "[vi] ログイン不具合",
        "Lỗi đăng nhập: không thể đăng nhập được",
        "emoji 🎉👨‍👩‍👧 xong",
        "dòng một\r\ndòng hai\n",
        "giữ chỗ ⟦1⟧ và ⟦2⟧",
        "あ".repeat(100_000),
      ];
      const entries = texts.map((text, i) => ({ key: key({ sourceHash: String(i).padStart(64, "0") }), value: { text, model: "m" } }));
      await cache.store(entries);
      const found = await cache.lookup(entries.map((e) => e.key));
      expect(found.size).toBe(texts.length);
      for (const e of entries) expect(found.get(cacheKeyString(e.key))).toEqual({ text: e.value.text, model: "m" });
    });

    it("AC-14 store lại cùng khoá thì ghi đè", async () => {
      const cache = await options.create();
      await cache.store([{ key: key(), value: { text: "cũ", model: "a" } }]);
      await cache.store([{ key: key(), value: { text: "mới", model: "b" } }]);
      expect((await cache.lookup([key()])).get(cacheKeyString(key()))).toEqual({ text: "mới", model: "b" });
    });

    it("AC-14 model null được lưu và đọc lại là null", async () => {
      const cache = await options.create();
      await cache.store([{ key: key(), value: { text: "x", model: null } }]);
      expect((await cache.lookup([key()])).get(cacheKeyString(key()))).toEqual({ text: "x", model: null });
    });

    it("AC-14 configuredModel \"\" và \"sonnet\" là hai khoá khác nhau", async () => {
      const cache = await options.create();
      await cache.store([{ key: key({ configuredModel: "" }), value: { text: "rỗng", model: null } }]);
      expect((await cache.lookup([key({ configuredModel: "sonnet" })])).size).toBe(0);
      await cache.store([{ key: key({ configuredModel: "sonnet" }), value: { text: "sonnet", model: null } }]);
      const found = await cache.lookup([key({ configuredModel: "" }), key({ configuredModel: "sonnet" })]);
      expect(found.get(cacheKeyString(key({ configuredModel: "" })))?.text).toBe("rỗng");
      expect(found.get(cacheKeyString(key({ configuredModel: "sonnet" })))?.text).toBe("sonnet");
    });

    it("AC-14 lookup nhiều khoá một lần chỉ trả các khoá có", async () => {
      const cache = await options.create();
      const k1 = key({ sourceHash: "1".repeat(64) });
      const k2 = key({ sourceHash: "2".repeat(64) });
      const k3 = key({ sourceHash: "3".repeat(64) });
      await cache.store([{ key: k1, value: { text: "một", model: null } }, { key: k3, value: { text: "ba", model: null } }]);
      const found = await cache.lookup([k1, k2, k3]);
      expect([...found.keys()].sort()).toEqual([cacheKeyString(k1), cacheKeyString(k3)].sort());
    });
  });
}
