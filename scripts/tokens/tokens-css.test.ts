import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — module .mjs không có khai báo kiểu
import { STYLES_DIR, tokensToCss } from "./tokens-css.mjs";

describe("tokens.css", () => {
  it("khớp với tokens.json (chạy `pnpm tokens` sau khi sửa tokens.json)", () => {
    const json = JSON.parse(readFileSync(join(STYLES_DIR, "tokens.json"), "utf8"));
    expect(readFileSync(join(STYLES_DIR, "tokens.css"), "utf8")).toBe(tokensToCss(json));
  });

  it("theme tối theo Windows, alias thành var()", () => {
    const css = tokensToCss({
      name: "X",
      color: { themes: [{ id: "light" }, { id: "dark" }], tokens: [{ name: "bg", value: { light: "#fff", dark: "#000" } }, { name: "fg", value: "{bg}" }] },
      type: { families: { sans: "system-ui" }, groups: [{ name: "g", family: "sans", styles: [{ name: "body", fontSize: "15px" }] }] },
      spacing: { tokens: [{ name: "space-1", value: "4px" }] },
    });
    expect(css).toContain("--bg: #fff;");
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\n  :root \{\n    --bg: #000;\n    --fg: var\(--bg\);/);
    expect(css).toContain("--space-1: 4px;");
    expect(css).toContain(".t-body {\n  font-family: var(--font-sans);\n  font-size: 15px;\n}");
  });
});
