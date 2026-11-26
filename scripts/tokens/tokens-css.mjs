#!/usr/bin/env node
// tokens.json (bản sao từ design system artifact) → tokens.css. Không sửa tokens.css bằng tay: sửa tokens.json rồi `pnpm tokens`.
// Theme đầu tiên trên :root, theme tối theo Windows (prefers-color-scheme). tokens-css.test.ts giữ file CSS đồng bộ.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const STYLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../apps/app/web/src/styles");

const themed = (t, theme, first) => (typeof t.value === "string" ? t.value : (t.value[theme] ?? t.value[first]));
const ref = (v) => v.replace(/^\{(.+)\}$/, "var(--$1)");

export function tokensToCss(tokens) {
  const themes = tokens.color.themes.map((t) => t.id);
  const [first, ...rest] = themes;
  const perTheme = [...tokens.color.tokens, ...(tokens.shadow?.tokens ?? [])];
  const block = (theme) => perTheme.map((t) => `  --${t.name}: ${ref(themed(t, theme, first))};`).join("\n");
  const flat = Object.entries(tokens)
    .filter(([k, v]) => !["name", "version", "color", "type", "shadow"].includes(k) && Array.isArray(v?.tokens))
    .flatMap(([, v]) => v.tokens.map((t) => `  --${t.name}: ${t.value};`));
  const fonts = Object.entries(tokens.type.families).map(([k, v]) => `  --font-${k}: ${v};`);
  const styles = tokens.type.groups.flatMap((g) =>
    g.styles.map((s) => {
      const decl = [
        `font-family: var(--font-${s.family ?? g.family})`,
        `font-size: ${s.fontSize}`,
        s.lineHeight && `line-height: ${s.lineHeight}`,
        s.fontWeight && `font-weight: ${s.fontWeight}`,
        s.letterSpacing && `letter-spacing: ${s.letterSpacing}`,
      ].filter(Boolean);
      return `.t-${s.name} {\n${decl.map((d) => `  ${d};`).join("\n")}\n}`;
    }),
  );
  const dark = rest.map((id) => `@media (prefers-color-scheme: ${id}) {\n  :root {\n${block(id).replace(/^/gm, "  ")}\n  }\n}`);
  return [
    `/* ${tokens.name}: sinh từ tokens.json bằng \`pnpm tokens\`. Không sửa tay. */`,
    `:root {\n  color-scheme: ${themes.join(" ")};\n${block(first)}\n}`,
    ...dark,
    `:root {\n${[...flat, ...fonts].join("\n")}\n}`,
    ...styles,
    "",
  ].join("\n\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const json = JSON.parse(readFileSync(join(STYLES_DIR, "tokens.json"), "utf8"));
  writeFileSync(join(STYLES_DIR, "tokens.css"), tokensToCss(json));
  console.log("đã ghi apps/app/web/src/styles/tokens.css");
}
