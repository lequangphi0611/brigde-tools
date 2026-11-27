import { describe, expect, it } from "vitest";
import { FakeTranslator } from "../infrastructure/fake-translator.ts";
import { InMemoryTranslationCache } from "../infrastructure/in-memory-translation-cache.ts";
import { cacheKeyString, translationCacheKey, type EngineVersion } from "../domain/translation-cache-key.ts";
import { CachingTranslator, type CacheStage } from "./caching-translator.ts";
import type { TranslationCache } from "./translation-cache.port.ts";
import { TranslationFailure } from "./translation-failure.ts";
import { runTranslatorContract } from "./translator.contract.ts";
import type { TranslationRequest, TranslationResult, Translator } from "./translator.port.ts";

const ja2vi = { from: "ja", to: "vi" } as const;
const ENGINE: EngineVersion = { promptVersion: "fake/1", configuredModel: "" };

function req(segments: Array<[string, string]>, opts: { glossary?: Array<{ ja: string; vi: string }>; hint?: string } = {}): TranslationRequest {
  return {
    direction: ja2vi,
    segments: segments.map(([id, text]) => ({ id, text })),
    context: { glossary: opts.glossary ?? [], ...(opts.hint !== undefined ? { hint: opts.hint } : {}) },
  };
}

/** Translator đếm lần gọi, bọc FakeTranslator. */
class CountingTranslator implements Translator {
  readonly calls: TranslationRequest[] = [];
  failWith: unknown = null;
  private readonly fake = new FakeTranslator();
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    this.calls.push(request);
    if (this.failWith) throw this.failWith;
    return this.fake.translate(request);
  }
}

function setup(over: { cache?: TranslationCache; engine?: () => EngineVersion | Promise<EngineVersion>; observer?: object } = {}) {
  const inner = new CountingTranslator();
  const cache = new InMemoryTranslationCache();
  const lookups: Array<{ hits: number; misses: number }> = [];
  const failures: Array<[CacheStage, unknown]> = [];
  let engine: EngineVersion = ENGINE;
  const engineCalls = { n: 0 };
  const translator = new CachingTranslator({
    inner,
    cache: over.cache ?? cache,
    engineVersion: over.engine ?? (() => { engineCalls.n++; return engine; }),
    observer: over.observer ?? { lookedUp: (s) => lookups.push(s), cacheFailed: (st, e) => failures.push([st, e]) },
  });
  return { inner, cache, translator, lookups, failures, engineCalls, setEngine: (e: EngineVersion) => { engine = e; } };
}

runTranslatorContract("CachingTranslator(FakeTranslator)", {
  create: () => new CachingTranslator({ inner: new FakeTranslator(), cache: new InMemoryTranslationCache(), engineVersion: () => ENGINE }),
  model: "fake",
});

describe("CachingTranslator", () => {
  it("AC-1 lần đầu trượt thì dịch và lưu; lần hai lấy từ cache, model = null", async () => {
    const { inner, translator, lookups } = setup();
    const r = req([["title", "ログイン不具合"], ["body", "再現手順があります"]]);
    const first = await translator.translate(r);
    expect(inner.calls).toHaveLength(1);
    expect(inner.calls[0]!.segments).toEqual(r.segments);
    expect(first).toEqual({
      segments: [{ id: "title", text: "[vi] ログイン不具合" }, { id: "body", text: "[vi] 再現手順があります" }],
      model: "fake",
    });
    const second = await translator.translate(req([["t2", "ログイン不具合"], ["b2", "再現手順があります"]]));
    expect(inner.calls).toHaveLength(1);
    expect(second.segments.map((s) => s.text)).toEqual(first.segments.map((s) => s.text));
    expect(second.segments.map((s) => s.id)).toEqual(["t2", "b2"]);
    expect(second.model).toBeNull();
    expect(lookups).toEqual([{ hits: 0, misses: 2 }, { hits: 2, misses: 0 }]);
  });

  it("AC-2 trúng một phần thì chỉ gửi phần trượt trong một lần gọi, rồi cache đủ 4 đoạn", async () => {
    const { inner, translator, cache } = setup();
    await translator.translate(req([["title", "ログイン不具合"], ["body", "再現手順があります"]]));
    const r = await translator.translate(
      req([["title", "ログイン不具合"], ["body", "再現手順があります"], ["comment:A", "確認しました"], ["comment:B", "修正してください"]]),
    );
    expect(inner.calls).toHaveLength(2);
    expect(inner.calls[1]!.segments.map((s) => s.id)).toEqual(["comment:A", "comment:B"]);
    expect(r.segments).toEqual([
      { id: "title", text: "[vi] ログイン不具合" },
      { id: "body", text: "[vi] 再現手順があります" },
      { id: "comment:A", text: "[vi] 確認しました" },
      { id: "comment:B", text: "[vi] 修正してください" },
    ]);
    expect(r.model).toBe("fake");
    expect(cache.size).toBe(4);
  });

  it("AC-3 đoạn không có chữ cần dịch không tra và không ghi; không còn gì thì không gọi engineVersion/inner", async () => {
    const looked: number[] = [];
    const stored: number[] = [];
    const spy: TranslationCache = {
      lookup: async (keys) => { looked.push(keys.length); return new Map(); },
      store: async (entries) => { stored.push(entries.length); },
    };
    const { inner, translator, engineCalls } = setup({ cache: spy });
    const r = await translator.translate(req([["body", ""], ["c1", "```\nlog\n```"], ["c2", "  \n"], ["title", "課題"]]));
    expect(looked).toEqual([1]);
    expect(stored).toEqual([1]);
    expect(inner.calls[0]!.segments.map((s) => s.id)).toEqual(["title"]);
    expect(r.segments).toEqual([
      { id: "body", text: "" },
      { id: "c1", text: "```\nlog\n```" },
      { id: "c2", text: "  \n" },
      { id: "title", text: "[vi] 課題" },
    ]);
    expect(engineCalls.n).toBe(1);

    const s2 = setup({ cache: spy });
    const r2 = await s2.translator.translate(req([["body", ""], ["c1", "```\nlog\n```"], ["c2", "  \n"]]));
    expect(r2.model).toBeNull();
    expect(r2.segments).toHaveLength(3);
    expect(s2.engineCalls.n).toBe(0);
    expect(s2.inner.calls).toHaveLength(0);
    expect(looked).toEqual([1]);
  });

  it("AC-4 text khác, \\r\\n, hoặc promptVersion khác thì trượt", async () => {
    const { inner, translator, setEngine } = setup();
    setEngine({ promptVersion: "claude-cli/p1", configuredModel: "sonnet" });
    await translator.translate(req([["a", "確認しました"], ["m", "一行目\n二行目"]]));
    expect(inner.calls).toHaveLength(1);
    await translator.translate(req([["a", "確認しました。"], ["m", "一行目\r\n二行目"]]));
    expect(inner.calls).toHaveLength(2);
    expect(inner.calls[1]!.segments).toHaveLength(2);
    setEngine({ promptVersion: "claude-cli/p2", configuredModel: "sonnet" });
    await translator.translate(req([["a", "確認しました"]]));
    expect(inner.calls).toHaveLength(3);
  });

  it("AC-5 configuredModel khác thì trượt, \"\" trúng \"\", engineVersion gọi mỗi lần dịch", async () => {
    const { inner, translator, setEngine, engineCalls } = setup();
    const r = req([["a", "確認しました"]]);
    setEngine({ promptVersion: "fake/1", configuredModel: "sonnet" });
    await translator.translate(r);
    await translator.translate(r);
    expect(inner.calls).toHaveLength(1);
    setEngine({ promptVersion: "fake/1", configuredModel: "opus" });
    await translator.translate(r);
    expect(inner.calls).toHaveLength(2);
    setEngine({ promptVersion: "fake/1", configuredModel: "" });
    await translator.translate(r);
    expect(inner.calls).toHaveLength(3);
    await translator.translate(r);
    expect(inner.calls).toHaveLength(3);
    expect(engineCalls.n).toBe(5);
  });

  it("AC-7 glossary theo thuật ngữ liên quan của từng đoạn", async () => {
    const { inner, translator } = setup();
    const segs: Array<[string, string]> = [["A", "課題を確認"], ["B", "よろしく"]];
    await translator.translate(req(segs, { glossary: [{ ja: "課題", vi: "issue" }] }));
    expect(inner.calls).toHaveLength(1);
    await translator.translate(req(segs, { glossary: [{ ja: "課題", vi: "issue" }, { ja: "納品", vi: "bàn giao" }] }));
    expect(inner.calls).toHaveLength(1);
    await translator.translate(req(segs, { glossary: [{ ja: "課題", vi: "ticket" }] }));
    expect(inner.calls).toHaveLength(2);
    expect(inner.calls[1]!.segments.map((s) => s.id)).toEqual(["A"]);
  });

  it("AC-7 thuật ngữ chỉ nằm trong code không làm đoạn trượt", async () => {
    const { inner, translator } = setup();
    const segs: Array<[string, string]> = [["A", "確認 `課題` です"]];
    await translator.translate(req(segs, { glossary: [{ ja: "課題", vi: "issue" }] }));
    await translator.translate(req(segs, { glossary: [{ ja: "課題", vi: "ticket" }] }));
    expect(inner.calls).toHaveLength(1);
  });

  it("AC-8 hint không ảnh hưởng tới khoá", async () => {
    const { inner, translator } = setup();
    await translator.translate(req([["a", "確認しました"]], { hint: "プロジェクトA" }));
    await translator.translate(req([["a", "確認しました"]], { hint: "プロジェクトB" }));
    await translator.translate(req([["a", "確認しました"]]));
    expect(inner.calls).toHaveLength(1);
  });

  it("AC-9 đoạn trùng text trong cùng request chỉ gửi một lần", async () => {
    const { inner, translator } = setup();
    const r = await translator.translate(req([["comment:A", "了解です"], ["comment:B", "了解です"], ["title", "課題"]]));
    expect(inner.calls).toHaveLength(1);
    expect(inner.calls[0]!.segments).toEqual([{ id: "comment:A", text: "了解です" }, { id: "title", text: "課題" }]);
    expect(r.segments).toEqual([
      { id: "comment:A", text: "[vi] 了解です" },
      { id: "comment:B", text: "[vi] 了解です" },
      { id: "title", text: "[vi] 課題" },
    ]);
  });

  it("AC-10 inner lỗi thì ném nguyên đối tượng, không ghi gì, lần sau gửi lại phần trượt", async () => {
    const { inner, translator, cache } = setup();
    await translator.translate(req([["title", "課題"]]));
    expect(cache.size).toBe(1);
    const failure = new TranslationFailure("timeout", undefined, "detail", "stderr");
    inner.failWith = failure;
    await expect(translator.translate(req([["title", "課題"], ["body", "本文です"]]))).rejects.toBe(failure);
    expect(cache.size).toBe(1);
    inner.failWith = null;
    const r = await translator.translate(req([["title", "課題"], ["body", "本文です"]]));
    expect(inner.calls.at(-1)!.segments.map((s) => s.id)).toEqual(["body"]);
    expect(r.segments.map((s) => s.text)).toEqual(["[vi] 課題", "[vi] 本文です"]);
    expect(cache.size).toBe(2);
  });

  describe("AC-11 lỗi cache/engineVersion không làm hỏng việc dịch", () => {
    it("lookup ném lỗi (đồng bộ hoặc reject)", async () => {
      for (const make of [(e: Error) => () => { throw e; }, (e: Error) => () => Promise.reject(e)]) {
        const error = new Error("lookup hỏng");
        const bad: TranslationCache = { lookup: make(error) as TranslationCache["lookup"], store: async () => {} };
        const { inner, translator, failures } = setup({ cache: bad });
        const r = await translator.translate(req([["a", "一つ目"], ["b", "二つ目"]]));
        expect(inner.calls[0]!.segments).toHaveLength(2);
        expect(r.segments.map((s) => s.text)).toEqual(["[vi] 一つ目", "[vi] 二つ目"]);
        expect(failures).toEqual([["lookup", error]]);
      }
    });

    it("store ném lỗi", async () => {
      const error = new Error("store hỏng");
      const bad: TranslationCache = { lookup: async () => new Map(), store: async () => { throw error; } };
      const { translator, failures } = setup({ cache: bad });
      const r = await translator.translate(req([["a", "一つ目"]]));
      expect(r.segments).toEqual([{ id: "a", text: "[vi] 一つ目" }]);
      expect(failures).toEqual([["store", error]]);
    });

    it("engineVersion ném lỗi: không tra/ghi cache, chuyển cả yêu cầu cho inner", async () => {
      const error = new TranslationFailure("not_configured");
      let touched = 0;
      const spy: TranslationCache = { lookup: async () => { touched++; return new Map(); }, store: async () => { touched++; } };
      const { inner, translator, failures } = setup({ cache: spy, engine: () => { throw error; } });
      const r = req([["a", "一つ目"], ["b", ""]]);
      const out = await translator.translate(r);
      expect(touched).toBe(0);
      expect(inner.calls).toEqual([r]);
      expect(out.segments.map((s) => s.text)).toEqual(["[vi] 一つ目", ""]);
      expect(failures).toEqual([["engineVersion", error]]);
      inner.failWith = error;
      await expect(translator.translate(r)).rejects.toBe(error);
    });

    it("engineVersion reject (async) cũng được xử lý như vậy", async () => {
      const { translator, failures } = setup({ engine: () => Promise.reject(new Error("x")) });
      await expect(translator.translate(req([["a", "一つ目"]]))).resolves.toBeDefined();
      expect(failures[0]![0]).toBe("engineVersion");
    });

    it("observer tự ném lỗi cũng không làm hỏng kết quả", async () => {
      const boom = () => { throw new Error("observer"); };
      const bad: TranslationCache = { lookup: async () => { throw new Error("l"); }, store: async () => { throw new Error("s"); } };
      const { translator } = setup({ cache: bad, observer: { lookedUp: boom, cacheFailed: boom } });
      await expect(translator.translate(req([["a", "一つ目"]]))).resolves.toMatchObject({ segments: [{ id: "a", text: "[vi] 一つ目" }] });
    });
  });

  it("AC-12 request sai bị từ chối trước khi chạm cache (kể cả khi mọi đoạn đã có trong cache)", async () => {
    const { inner, translator, cache, engineCalls } = setup();
    await translator.translate(req([["a", "一つ目"]]));
    const callsBefore = inner.calls.length;
    const engineBefore = engineCalls.n;
    const looked: number[] = [];
    const origLookup = cache.lookup.bind(cache);
    cache.lookup = async (k) => { looked.push(k.length); return origLookup(k); };
    const bads = [
      req([["a", "一つ目"], ["a", "一つ目"]]),
      req([["", "一つ目"]]),
      req([["a", "一つ目"]], { glossary: [{ ja: "API", vi: "a" }, { ja: "ａｐｉ", vi: "b" }] }),
      req([["a", "一つ目"]], { glossary: [{ ja: "課題", vi: "" }] }),
    ];
    for (const bad of bads) {
      const p = translator.translate(bad);
      await expect(p).rejects.toThrow(Error);
      await expect(translator.translate(bad)).rejects.not.toBeInstanceOf(TranslationFailure);
    }
    expect(looked).toEqual([]);
    expect(inner.calls).toHaveLength(callsBefore);
    expect(engineCalls.n).toBe(engineBefore);
  });

  it("khoá lưu đúng theo translationCacheKey (không lưu text nguồn)", async () => {
    const { translator, cache } = setup();
    await translator.translate(req([["a", "一つ目"]]));
    const key = translationCacheKey("一つ目", ja2vi, [], ENGINE);
    const found = await cache.lookup([key]);
    expect(found.get(cacheKeyString(key))).toEqual({ text: "[vi] 一つ目", model: "fake" });
  });
});
