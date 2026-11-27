import { describe, expect, it } from "vitest";
import type { TranslationRequest, Translator } from "./translator.port.ts";

/**
 * Bộ hợp đồng chung cho mọi `Translator` (ADR-0002): fake và adapter thật chạy cùng một bộ case.
 * Adapter thật được dựng với fake CLI trả "[vi] " + nội dung từng segment.
 */
export function runTranslatorContract(name: string, options: { create: () => Translator; model: string }): void {
  const ja2vi = { from: "ja", to: "vi" } as const;
  const req = (segments: Array<[string, string]>): TranslationRequest => ({
    direction: ja2vi,
    segments: segments.map(([id, text]) => ({ id, text })),
    context: { glossary: [] },
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
  });
}
