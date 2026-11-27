import { describe, expect, it } from "vitest";
import { batchTerms, planBatches } from "./chunking.ts";
import { buildTranslationStdin } from "./translation-prompt.ts";

const d = { from: "ja", to: "vi" } as const;
const ja = (n: number, ch = "あ") => ch.repeat(n);
const seg = (id: string, n: number) => ({ id, masked: ja(n) });

describe("planBatches", () => {
  it("AC-22 vừa giới hạn → đúng 1 lô, key s1..s3", () => {
    const plan = planBatches([seg("a", 250), seg("b", 250), seg("c", 250)], undefined, [], d, 1000);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0]!.map((i) => i.key)).toEqual(["s1", "s2", "s3"]);
    expect(buildTranslationStdin(undefined, [], plan.batches[0]!, d).length).toBeLessThanOrEqual(1000);
  });

  it("AC-23 vượt giới hạn → chia tham lam giữ thứ tự, key duy nhất toàn request, mỗi stdin ≤ giới hạn", () => {
    const hint = "決済基盤";
    const plan = planBatches([seg("title", 400), seg("body", 400), seg("comment:A", 400), seg("comment:B", 400)], hint, [], d, 1000);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.batches.map((b) => b.map((i) => i.id))).toEqual([["title", "body"], ["comment:A", "comment:B"]]);
    expect(plan.batches.flat().map((i) => i.key)).toEqual(["s1", "s2", "s3", "s4"]);
    for (const b of plan.batches) {
      const stdin = buildTranslationStdin(hint, [], b, d);
      expect(stdin.length).toBeLessThanOrEqual(1000);
      expect(stdin).toContain("<context>");
      for (const i of b) expect(stdin).toContain(i.masked);
    }
  });

  it("AC-24 nền: 5 segment 400 ký tự → 3 lô", () => {
    const plan = planBatches([1, 2, 3, 4, 5].map((n) => seg(`c${n}`, 400)), undefined, [], d, 1000);
    expect(plan.ok && plan.batches.map((b) => b.length)).toEqual([2, 2, 1]);
  });

  it("AC-15 một segment riêng đã vượt → input_too_large, kể cả khi segment khác nhỏ", () => {
    expect(planBatches([seg("title", 100), seg("body", 1200)], undefined, [], d, 1000)).toEqual({ ok: false, reason: "input_too_large" });
  });

  it("AC-15 code block đã che không tính vào độ dài", () => {
    const masked = `⟦1⟧${ja(50)}`; // code 5000 ký tự đã thành ⟦1⟧
    const plan = planBatches([{ id: "x", masked }], undefined, [], d, 1000);
    expect(plan.ok && plan.batches).toHaveLength(1);
  });

  it("hint lớn làm segment đơn lẻ vượt giới hạn", () => {
    expect(planBatches([seg("a", 200)], ja(900), [], d, 1000)).toEqual({ ok: false, reason: "input_too_large" });
  });

  it("không có segment → không có lô", () => {
    expect(planBatches([], undefined, [], d, 1000)).toEqual({ ok: true, batches: [] });
  });

  it("AC-13 mỗi lô chỉ mang thuật ngữ của đoạn trong lô; khối glossary tính vào giới hạn", () => {
    const G = [
      { ja: "課題", vi: "issue" },
      { ja: "担当者", vi: "người phụ trách" },
      { ja: "納品", vi: "bàn giao" },
    ];
    const segs = [{ id: "a", masked: "課題" + ja(300) }, { id: "b", masked: "納品" + ja(300) }, { id: "c", masked: "担当者" + ja(300) }];
    const plan = planBatches(segs, undefined, G, d, 480);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.batches.map((b) => b.map((i) => i.id))).toEqual([["a"], ["b"], ["c"]]);
    expect(plan.batches.map((b) => batchTerms(G, b, d).map((t) => t.ja))).toEqual([["課題"], ["納品"], ["担当者"]]);
    for (const b of plan.batches) expect(buildTranslationStdin(undefined, batchTerms(G, b, d), b, d).length).toBeLessThanOrEqual(480);
  });

  it("AC-13 đoạn vừa khi không có glossary nhưng vượt khi kèm thuật ngữ của nó → input_too_large", () => {
    const G = [{ ja: "課題", vi: "một bản dịch khá dài của thuật ngữ" }];
    const segs = [{ id: "a", masked: "課題" + ja(300) }];
    const bare = planBatches(segs, undefined, [], d, 400);
    expect(bare.ok).toBe(true);
    expect(planBatches(segs, undefined, G, d, 400)).toEqual({ ok: false, reason: "input_too_large" });
  });
});
