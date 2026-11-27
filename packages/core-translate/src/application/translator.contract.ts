import { describe, expect, it } from "vitest";
import type { TranslationRequest, Translator } from "./translator.port.ts";

/**
 * Bộ hợp đồng chung cho mọi `Translator` (ADR-0002): fake và adapter thật chạy cùng một bộ case.
 * Adapter thật được dựng với fake CLI trả "[vi] " + nội dung từng segment.
 */
export function runTranslatorContract(name: string, options: { create: () => Translator; model: string }): void {
  const ja2vi = { from: "ja", to: "vi" } as const;
  const req = (segments: Array<[string, string]>, glossary: Array<{ ja: string; vi: string }> = []): TranslationRequest => ({
    direction: ja2vi,
    segments: segments.map(([id, text]) => ({ id, text })),
    context: { glossary },
  });

  describe(`Translator contract: ${name}`, () => {
    it("AC-1 trả đủ segment, cùng id và thứ tự, [vi] + text gốc, kèm model", async () => {
      const r = await options.create().translate(
        req([
          ["title", "ログイン不具合"],
          ["body", "再現手順があります"],
          ["comment:A", "確認しました"],
          ["comment:B", "修正してください"],
        ]),
      );
      expect(r.segments.map((s) => s.id)).toEqual(["title", "body", "comment:A", "comment:B"]);
      expect(r.segments.map((s) => s.text)).toEqual([
        "[vi] ログイン不具合",
        "[vi] 再現手順があります",
        "[vi] 確認しました",
        "[vi] 修正してください",
      ]);
      expect(r.model).toBe(options.model);
    });

    it("AC-12 đoạn rỗng, chỉ khoảng trắng hoặc chỉ code block giữ nguyên, vẫn đủ id", async () => {
      const r = await options.create().translate(
        req([
          ["title", "ログイン不具合"],
          ["body", ""],
          ["comment:A", "```\nlog\n```"],
          ["comment:B", "  \n"],
        ]),
      );
      expect(r.segments).toEqual([
        { id: "title", text: "[vi] ログイン不具合" },
        { id: "body", text: "" },
        { id: "comment:A", text: "```\nlog\n```" },
        { id: "comment:B", text: "  \n" },
      ]);
    });

    it("AC-13 không có gì cần dịch thì trả text gốc và model = null", async () => {
      const t = options.create();
      await expect(t.translate(req([]))).resolves.toEqual({ segments: [], model: null });
      await expect(t.translate(req([["body", ""], ["c", "```\nx\n```"]]))).resolves.toEqual({
        segments: [
          { id: "body", text: "" },
          { id: "c", text: "```\nx\n```" },
        ],
        model: null,
      });
    });

    it("AC-14 id trùng hoặc rỗng là lỗi lập trình (không phải TranslationFailure)", async () => {
      const t = options.create();
      await expect(t.translate(req([["body", "a"], ["body", "b"]]))).rejects.toThrow(Error);
      await expect(t.translate(req([["", "a"]]))).rejects.toThrow(Error);
      for (const bad of [req([["body", "a"], ["body", "b"]]), req([["", "a"]])]) {
        await expect(t.translate(bad)).rejects.not.toMatchObject({ name: "TranslationFailure" });
      }
    });

    it("002 AC-5 glossary sai (trùng termKey, ja/vi rỗng) là lỗi lập trình (Error thường)", async () => {
      const t = options.create();
      const segs: Array<[string, string]> = [["body", "課題があります"]];
      const bads = [
        [{ ja: "API", vi: "a" }, { ja: "ａｐｉ", vi: "b" }],
        [{ ja: "課題", vi: "" }],
        [{ ja: "課題", vi: " \u3000\n" }],
        [{ ja: "  ", vi: "issue" }],
      ];
      for (const glossary of bads) {
        const p = t.translate(req(segs, glossary));
        await expect(p).rejects.toThrow(Error);
        await expect(t.translate(req(segs, glossary))).rejects.not.toMatchObject({ name: "TranslationFailure" });
      }
    });

    it("002 AC-14 nhận glossary hợp lệ nhưng giữ hợp đồng [vi] + text", async () => {
      const r = await options.create().translate(
        req(
          [
            ["title", "課題の担当者"],
            ["body", "```\ncode\n```"],
          ],
          [
            { ja: "課題", vi: "issue" },
            { ja: "担当者", vi: "người phụ trách" },
          ],
        ),
      );
      expect(r.segments).toEqual([
        { id: "title", text: "[vi] 課題の担当者" },
        { id: "body", text: "```\ncode\n```" },
      ]);
      expect(r.model).toBe(options.model);
    });
  });
}
