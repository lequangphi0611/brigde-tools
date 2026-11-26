import { describe, expect, it } from "vitest";
import { FakeTranslator } from "./fake-translator.ts";

describe("FakeTranslator", () => {
  it("trả về bản dịch xác định để e2e assert được", async () => {
    const t = new FakeTranslator();
    await expect(t.translate("こんにちは", { from: "ja", to: "vi" }, { glossary: [] })).resolves.toBe("[vi] こんにちは");
  });
});
