import { describe, expect, it } from "vitest";
import { runTranslatorContract } from "../application/translator.contract.ts";
import { FakeTranslator } from "./fake-translator.ts";

runTranslatorContract("FakeTranslator", { create: () => new FakeTranslator(), model: "fake" });

describe("FakeTranslator", () => {
  it("AC-21 trả bản dịch xác định để e2e assert được", async () => {
    const r = await new FakeTranslator().translate({
      direction: { from: "ja", to: "vi" },
      segments: [
        { id: "a", text: "こんにちは" },
        { id: "b", text: "" },
      ],
      context: { glossary: [] },
    });
    expect(r).toEqual({
      segments: [
        { id: "a", text: "[vi] こんにちは" },
        { id: "b", text: "" },
      ],
      model: "fake",
    });
  });
});
