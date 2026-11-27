import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// Spawn đúng lệnh người dùng gõ (`pnpm translate-issue -- <file>`) từ một thư mục con của repo, không phải apps/app.
const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));
const FAKE = path.join(REPO, "packages/core-translate/src/infrastructure/claude-cli/testing/fake-claude-cli.mjs");
const base = path.join(REPO, "node_modules", ".cache");
mkdirSync(base, { recursive: true });
const root = mkdtempSync(path.join(base, "ghit-process-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
function setup() {
  const dir = path.join(root, `d${++n}`);
  mkdirSync(path.join(dir, "sub"), { recursive: true });
  const record = path.join(dir, "rec.jsonl");
  const config = path.join(dir, "cli.json");
  writeFileSync(config, JSON.stringify({ command: process.execPath, args: [FAKE, "--fake-record", record], timeoutSeconds: 30 }));
  const dataDir = path.join(dir, "data");
  const issue = (value: object) => writeFileSync(path.join(dir, "sub", "issue.json"), JSON.stringify(value));
  const run = () => {
    const r = spawnSync("pnpm", ["translate-issue", "--", "sub/issue.json", "--config", "cli.json"], {
      cwd: dir,
      env: { ...process.env, APP_DATA_DIR: dataDir },
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    return { code: r.status, out: r.stdout, err: r.stderr, lines: r.stdout.split("\n").filter(Boolean) };
  };
  const calls = (): Array<{ stdin: string }> => {
    try {
      return readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };
  return { dir, issue, run, calls, dataDir };
}
const block = (out: string) => out.split("translate-issue ")[0]!;

describe("translate-issue ở mức process", () => {
  it("AC-1 + AC-8: đường dẫn tương đối theo thư mục gõ lệnh; process thứ hai lấy từ cache; AC-2: đổi body chỉ dịch lại body", { timeout: 60_000 }, () => {
    const t = setup();
    t.issue({ title: "ログイン不具合", body: "再現手順があります", number: 12 });
    const a = t.run();
    expect(a.code, a.err).toBe(0);
    expect(t.calls()).toHaveLength(1);
    expect(a.out).toContain("=== title ===\n[vi] ログイン不具合\n=== body ===\n[vi] 再現手順があります\n");
    expect(a.lines.at(-1)).toMatch(/^translate-issue OK enc=utf8 jaChars=\d+ srcChars=\d+ segments=2 hits=0 misses=2 engine=called ms=\d+ cache=ok data=APP_DATA_DIR tmpLeft=\d+$/);

    const b = t.run();
    expect(b.code, b.err).toBe(0);
    expect(t.calls()).toHaveLength(1);
    expect(block(b.out)).toBe(block(a.out));
    expect(b.lines.at(-1)).toContain("segments=2 hits=2 misses=0 engine=skipped");

    t.issue({ title: "ログイン不具合", body: "再現手順を更新しました" });
    const c = t.run();
    expect(c.code, c.err).toBe(0);
    const calls = t.calls();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.stdin).toContain("再現手順を更新しました");
    expect(calls[1]!.stdin).not.toContain("ログイン不具合");
    expect(c.lines.at(-1)).toContain("hits=1 misses=1 engine=called");
  });

  it("AC-4: giữ nguyên code block, inline code, link, @mention và \\r\\n", { timeout: 60_000 }, () => {
    const t = setup();
    const body = "手順:\n```ts\nconst a = 1;\n```\n`npm ci` を実行。詳細は [資料](https://example.com/a) を参照 @tanaka\r\n以上";
    t.issue({ title: "課題", body });
    const r = t.run();
    expect(r.code, r.err).toBe(0);
    for (const piece of ["```ts\nconst a = 1;\n```", "`npm ci`", "(https://example.com/a)", "@tanaka", "\r\n"]) {
      expect(r.out).toContain(piece);
    }
  });
});
