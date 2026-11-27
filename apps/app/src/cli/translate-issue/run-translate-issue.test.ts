import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { runTranslateIssue } from "./run-translate-issue.ts";

const FAKE = fileURLToPath(new URL("../../../../../packages/core-translate/src/infrastructure/claude-cli/testing/fake-claude-cli.mjs", import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), "ghit-run-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
let work: string; // cwd của người dùng, tên chứa ZZPATHZZ
let dataDir: string;
let record: string;

beforeEach(() => {
  work = path.join(root, `ZZPATHZZ-${++n}`);
  dataDir = path.join(work, "ZZDATAZZ");
  record = path.join(work, "rec.jsonl");
  mkdirSync(work, { recursive: true });
});

const calls = (): Array<{ stdin: string }> => {
  try {
    return readFileSync(record, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};
const writeConfig = (name = "ZZCFGZZ.json", extraArgs: string[] = [], extra: object = {}): string => {
  const p = path.join(work, name);
  writeFileSync(p, JSON.stringify({ command: process.execPath, args: [FAKE, "--fake-record", record, ...extraArgs], timeoutSeconds: 30, ...extra }));
  return p;
};
const writeIssue = (value: unknown, name = "issue.json"): string => {
  const p = path.join(work, name);
  writeFileSync(p, typeof value === "string" ? value : Buffer.isBuffer(value) ? value : JSON.stringify(value));
  return p;
};

async function run(argv: string[], env: Record<string, string> = { APP_DATA_DIR: dataDir }, tmp = path.join(work, "tmp")) {
  let out = "";
  let err = "";
  mkdirSync(tmp, { recursive: true });
  const code = await runTranslateIssue({
    argv,
    env,
    cwd: work,
    platform: process.platform,
    homedir: work,
    tmpdir: tmp,
    stdout: { write: (c) => void (out += c) },
    stderr: { write: (c) => void (err += c) },
  });
  const lines = out.split("\n").filter((l) => l !== "");
  return { code, out, err, last: lines[lines.length - 1] ?? "" };
}
const tableRows = (): number => {
  const db = new DatabaseSync(path.join(dataDir, "app.db"));
  try {
    return (db.prepare("SELECT count(*) n FROM translation").get() as { n: number }).n;
  } finally {
    db.close();
  }
};

describe("thành công", () => {
  it("AC-1 (trong process): lần hai từ cache; AC-14 đếm tmpLeft", async () => {
    const cfg = writeConfig();
    writeIssue({ title: "ログイン不具合", body: "再現手順があります", number: 12 });
    const tmp = path.join(work, "tmp");
    for (const d of ["ghit-ai-x1", "ghit-ai-x2", "ghit-ai-x3", "khac-1"]) mkdirSync(path.join(tmp, d), { recursive: true });
    const a = await run(["issue.json", "--config", cfg], undefined, tmp);
    expect(a.code).toBe(0);
    expect(calls()).toHaveLength(1);
    expect(a.out).toContain("=== title ===\n[vi] ログイン不具合\n=== body ===\n[vi] 再現手順があります\n");
    expect(a.last).toMatch(/^translate-issue OK enc=utf8 jaChars=\d+ srcChars=\d+ segments=2 hits=0 misses=2 engine=called ms=\d+ cache=ok data=APP_DATA_DIR tmpLeft=3$/);
    const b = await run(["--", "issue.json", "--config", cfg], undefined, tmp);
    expect(b.code).toBe(0);
    expect(calls()).toHaveLength(1);
    expect(b.out.split("\n").slice(0, -2).join("\n")).toBe(a.out.split("\n").slice(0, -2).join("\n"));
    expect(b.last).toContain("segments=2 hits=2 misses=0 engine=skipped");
    expect(tableRows()).toBe(2);
    expect(existsSync(path.join(tmp, "ghit-ai-x1"))).toBe(true);
  });

  it("AC-3: đoạn không có chữ cần dịch", async () => {
    const cfg = writeConfig();
    writeIssue({ title: "課題", body: "" });
    const a = await run(["issue.json", "--config", cfg]);
    expect(a.code).toBe(0);
    expect(a.out).toContain("=== body ===\n\n");
    expect(a.last).toContain("segments=1");
    writeIssue({ title: "", body: "```\nlog\n```" });
    const before = calls().length;
    const b = await run(["issue.json", "--config", cfg]);
    expect(b.code).toBe(0);
    expect(calls()).toHaveLength(before);
    expect(b.out).toContain("```\nlog\n```");
    expect(b.last).toContain("segments=0 engine=skipped");
  });
});

describe("đầu vào sai (AC-7)", () => {
  const cases: Array<[string[], number, string, (() => void)?]> = [
    [[], 2, "FAIL usage"],
    [["--foo"], 2, "FAIL usage"],
    [["issue.json", "--config"], 2, "FAIL usage"],
    [["issue.json", "--out"], 2, "FAIL usage"],
    [["khong-co.json"], 2, "FAIL input_not_found code=ENOENT"],
    [["a.json"], 2, "FAIL input_not_json", () => writeIssue('{"title":"秘密ABC', "a.json")],
    [["a.json"], 2, "FAIL input_bad_shape", () => writeIssue("[]", "a.json")],
    [["a.json"], 2, "FAIL input_bad_shape", () => writeIssue('{"title":"a"}', "a.json")],
    [["a.json"], 2, "FAIL input_bad_shape", () => writeIssue('{"title":1,"body":""}', "a.json")],
    [["a.json"], 2, "FAIL input_encoding", () => writeIssue(Buffer.from([0xfe, 0xff, 0, 0x7b]), "a.json")],
    [["a.json"], 2, "FAIL input_encoding", () => writeIssue(Buffer.from([0x7b, 0xff, 0x7d]), "a.json")],
  ];
  it.each(cases)("%j", async (argv, exit, expected, setup) => {
    setup?.();
    const r = await run(argv.length > 0 && argv[0]!.endsWith(".json") ? [...argv, "--config", writeConfig()] : argv);
    expect(r.code).toBe(exit);
    expect(r.last.startsWith(`translate-issue ${expected}`)).toBe(true);
    expect(r.last).not.toContain("秘密");
    expect(calls()).toHaveLength(0);
    expect(existsSync(path.join(dataDir, "app.db"))).toBe(false);
    expect(existsSync(dataDir)).toBe(false);
  });

  it("usage in cách dùng; --help exit 0, không mở DB", async () => {
    const u = await run([]);
    expect(u.err).toContain("pnpm translate-issue");
    const h = await run(["--help"]);
    expect(h.code).toBe(0);
    expect(h.out).toContain("pnpm translate-issue");
    expect(existsSync(dataDir)).toBe(false);
  });

  it("APP_DATA_DIR tương đối → data_dir_invalid", async () => {
    writeIssue({ title: "課題", body: "x" });
    const r = await run(["issue.json", "--config", writeConfig()], { APP_DATA_DIR: "rel" });
    expect(r.code).toBe(2);
    expect(r.last).toMatch(/^translate-issue FAIL data_dir_invalid /);
    expect(calls()).toHaveLength(0);
  });
});

describe("lỗi engine, cấu hình, lưu trữ", () => {
  const jaBody = { title: "ログイン", body: "再現手順があります" };

  it("AC-9: fail, không lộ stderr, không ghi cache; rồi mode ok thì called", async () => {
    writeIssue(jaBody);
    const r = await run(["issue.json", "--config", writeConfig("bad.json", ["--fake-mode", "fail"])]);
    expect(r.code).toBe(1);
    expect(r.last).toContain("translate-issue FAIL translate:process_failed");
    expect(r.last).toContain("hits=0 misses=2");
    expect(r.out).not.toContain("===");
    expect(r.out + r.err).not.toContain("not logged in");
    expect(tableRows()).toBe(0);
    const ok = await run(["issue.json", "--config", writeConfig("ok.json")]);
    expect(ok.last).toContain("engine=called");
  });

  it("AC-9: garbage và input_too_large", async () => {
    writeIssue(jaBody);
    const g = await run(["issue.json", "--config", writeConfig("g.json", ["--fake-mode", "garbage"])]);
    expect(g.last).toContain("FAIL translate:bad_output");
    const m = await run(["issue.json", "--config", writeConfig("m.json", ["--fake-mode", "batch-missing"])]);
    expect(m.last).toContain("FAIL translate:bad_output detail=missing_segment");
    writeIssue({ title: "", body: "あ".repeat(500) });
    const before = calls().length;
    const t = await run(["issue.json", "--config", writeConfig("t.json", [], { maxInputChars: 100 })]);
    expect(t.code).toBe(1);
    expect(t.last).toContain("FAIL translate:input_too_large");
    expect(calls()).toHaveLength(before);
  });

  it("AC-10: config thiếu hoặc có cờ cấm", async () => {
    writeIssue(jaBody);
    for (const cfg of [path.join(work, "ZZCFGZZ-none.json"), writeConfig("forbid.json", ["--tools", "Bash"])]) {
      const r = await run(["issue.json", "--config", cfg]);
      expect(r.code).toBe(1);
      expect(r.last).toContain("FAIL translate:not_configured");
      expect(r.last).toContain("cache=warn:engineVersion");
      expect(r.last).not.toContain("ZZ");
    }
  });

  it("AC-11: APP_DATA_DIR là file thường", async () => {
    writeIssue(jaBody);
    const f = path.join(work, "ZZDATAZZ-file");
    writeFileSync(f, "x");
    const r = await run(["issue.json", "--config", writeConfig()], { APP_DATA_DIR: f });
    expect(r.code).toBe(1);
    expect(r.last).toMatch(/^translate-issue FAIL storage:open_failed/);
    expect(calls()).toHaveLength(0);
  });
});

describe("--out (AC-12)", () => {
  it("ghi UTF-8 có BOM, stdout chỉ còn dòng trạng thái; thư mục thiếu → output_write, bản dịch đã vào cache", async () => {
    const cfg = writeConfig();
    writeIssue({ title: "ログイン", body: "再現手順があります" });
    mkdirSync(path.join(work, "out"));
    const ok = await run(["issue.json", "--config", cfg, "--out", "out/vi.txt"]);
    expect(ok.code).toBe(0);
    expect(ok.out.trim().split("\n")).toHaveLength(1);
    const bytes = readFileSync(path.join(work, "out", "vi.txt"));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString("utf8")).toBe("=== title ===\n[vi] ログイン\n=== body ===\n[vi] 再現手順があります\n");

    writeIssue({ title: "別の件", body: "内容です" });
    const bad = await run(["issue.json", "--config", cfg, "--out", "khong/co/vi.txt"]);
    expect(bad.code).toBe(1);
    expect(bad.last).toContain("FAIL output_write code=ENOENT");
    const again = await run(["issue.json", "--config", cfg]);
    expect(again.last).toContain("engine=skipped");
  });
});

describe("AC-13: dòng trạng thái không chứa dữ liệu", () => {
  it("mọi nhánh chỉ ASCII, không có ZZ, không có hostname", async () => {
    const cfg = writeConfig("ZZCFGZZ.json");
    const data = { title: "ZZTITLEZZ ログイン", body: "ZZBODYZZ 再現" };
    writeIssue(data);
    const f = path.join(work, "ZZDATAZZ-file");
    writeFileSync(f, "x");
    mkdirSync(path.join(work, "out"));
    const runs = [
      await run(["issue.json", "--config", cfg]),
      await run(["issue.json", "--config", cfg]),
      await run([]),
      await run(["ZZnone.json"]),
      await run(["issue.json", "--config", path.join(work, "ZZnone.json")]),
      await run(["issue.json", "--config", writeConfig("ZZCFGZZ-f.json", ["--fake-mode", "fail"])]),
      await run(["issue.json", "--config", cfg], { APP_DATA_DIR: f }),
      await run(["issue.json", "--config", cfg, "--out", "out/ZZ.txt"]),
      await run(["issue.json", "--config", cfg, "--out", "ZZno/ZZ.txt"]),
    ];
    for (const r of runs) {
      expect(r.last).toMatch(/^translate-issue (OK|FAIL)( [A-Za-z_:]+)?( [A-Za-z]+=[A-Za-z0-9_:./-]+)*$/);
      expect(r.last).not.toContain("ZZ");
      expect(r.last).not.toContain(hostname());
      expect(/^[\x20-\x7e]+$/.test(r.last)).toBe(true);
    }
  });
});
