import { describe, expect, it } from "vitest";
import { fixedArgs } from "../../packages/core-translate/src/infrastructure/claude-cli/claude-cli-runner.ts";
import { checkCliConfig, FORBIDDEN_CLI_FLAGS } from "../../packages/core-translate/src/infrastructure/claude-cli/cli-config.ts";
import { resolveDataDir } from "../../apps/app/src/shared/infrastructure/data-dir.ts";
// @ts-expect-error — module .mjs không có khai báo kiểu
import * as c from "./checks.mjs";

describe("diagnose checks", () => {
  it("dùng đúng cờ của runner thật (giữ đồng bộ với ADR-0003)", () => {
    expect(c.claudeFixedArgs(c.CLAUDE_SCHEMA, c.CLAUDE_SYSTEM_PROMPT)).toEqual(fixedArgs(c.CLAUDE_SCHEMA, c.CLAUDE_SYSTEM_PROMPT));
  });

  it("dùng đúng danh sách cờ cấm của app (giữ đồng bộ với cli-config.ts)", () => {
    expect([...c.CLAUDE_FORBIDDEN_FLAGS].sort()).toEqual([...FORBIDDEN_CLI_FLAGS].sort());
  });

  it("findForbiddenFlag khớp checkCliConfig", () => {
    const cases: string[][] = [["--model", "sonnet"], ["--Append-System-Prompt", "x"], ["--allowedTools=Bash"], ["-c"], ["--settings", "s.json"]];
    for (const args of cases) {
      expect(c.findForbiddenFlag(args) === undefined).toBe(checkCliConfig({ command: "claude", args }, "linux").ok);
    }
    expect(c.findForbiddenFlag(["--allowedTools=Bash"])).toBe("--allowedTools");
  });

  it("giải nghĩa LastTaskResult và tính hạn chờ scheduler", () => {
    expect(c.describeTaskResult("267009")).toBe("0x41301: vẫn đang chạy (quá hạn chờ)");
    expect(c.describeTaskResult(-2147024894)).toBe("0x80070002: không tìm thấy file chạy (node.exe/script)");
    expect(c.describeTaskResult("2147942402")).toBe("0x80070002: không tìm thấy file chạy (node.exe/script)");
    expect(c.describeTaskResult("")).toBe("không đọc được");
    expect(c.describeTaskResult("abc")).toBe("không đọc được");
    expect(c.schedulerDeadlineMs(300)).toBe(480_000);
    expect(c.schedulerDeadlineMs(undefined)).toBe(480_000);
  });

  it("đọc envelope: object, mảng event, dòng JSON sau log", () => {
    const env = { type: "result", is_error: false, structured_output: { translation: "xin chào" } };
    expect(c.parseClaudeEnvelope(JSON.stringify(env))).toEqual({ ok: true, translation: "xin chào" });
    expect(c.parseClaudeEnvelope(JSON.stringify([{ type: "system" }, env]))).toEqual({ ok: true, translation: "xin chào" });
    expect(c.parseClaudeEnvelope(`wrapper\n${JSON.stringify(env)}`)).toEqual({ ok: true, translation: "xin chào" });
    expect(c.parseClaudeEnvelope(JSON.stringify({ result: '{"translation":"a"}' }))).toEqual({ ok: true, translation: "a" });
    expect(c.parseClaudeEnvelope("nope").ok).toBe(false);
    expect(c.parseClaudeEnvelope(JSON.stringify({ is_error: true })).reason).toBe("IS_ERROR");
  });

  it("đánh giá bản dịch mẫu", () => {
    expect(c.evaluateTranslation("Chạy `npm test` rồi nhờ @tanaka xác nhận.")).toEqual({ vietnamese: true, keepsCode: true, keepsMention: true, japaneseLeft: false });
    expect(c.evaluateTranslation("[vi] 次の `npm test`").japaneseLeft).toBe(true);
  });

  it("phân loại lỗi gh", () => {
    expect(c.classifyGhError("Field 'items' doesn't accept argument 'query'")).toBe("ARG_QUERY_UNSUPPORTED");
    expect(c.classifyGhError("Field 'projectV2' doesn't exist on type 'Organization'")).toBe("PROJECTS_V2_UNSUPPORTED");
    expect(c.classifyGhError("INSUFFICIENT_SCOPES: requires read:project")).toBe("SCOPE_MISSING");
    expect(c.classifyGhError("Could not resolve to an Organization with the login of 'acme'")).toBe("NOT_FOUND");
    expect(c.classifyGhError("HTTP 401: Bad credentials")).toBe("AUTH");
    expect(c.classifyGhError("weird")).toBe("OTHER");
  });

  it("phân loại lỗi claude", () => {
    expect(c.classifyClaudeFailure({ spawnErrorCode: "EINVAL" })).toBe("CMD_NOT_ALLOWED");
    expect(c.classifyClaudeFailure({ stderr: "error: unknown option '--strict-mcp-config'" })).toBe("UNKNOWN_FLAG --strict-mcp-config");
    expect(c.classifyClaudeFailure({ stderr: "Invalid API key · Please run /login" })).toBe("AUTH");
    expect(c.classifyClaudeFailure({ timedOut: true })).toBe("TIMEOUT");
  });

  it("checklist totalCount của filter updated:", () => {
    expect(c.evaluateCounts({ base: 10, gt: 3, lt: 6, eq: 1, future: 0 })).toEqual({ partition: true, futureZero: true, ignored: false });
    expect(c.evaluateCounts({ base: 10, gt: 10, lt: 10, eq: 10, future: 10 }).ignored).toBe(true);
  });

  it("so mốc theo item.updatedAt và Issue.updatedAt", () => {
    const nodes = [
      { updatedAt: "2026-11-25T00:00:00Z", content: { __typename: "Issue", updatedAt: "2026-11-01T00:00:00Z" } },
      { updatedAt: "2026-11-25T00:00:00Z", content: { __typename: "DraftIssue" } },
    ];
    expect(c.compareNodes(nodes, "2026-11-20T00:00:00Z")).toEqual({ n: 2, itemAfter: 2, issues: 1, issueAfter: 0 });
  });

  it("đọc scope từ gh auth status", () => {
    expect(c.hasProjectScope("  - Token scopes: 'gist', 'read:org', 'read:project', 'repo'")).toBe(true);
    expect(c.hasProjectScope("  - Token scopes: 'gist', 'read:org', 'repo'")).toBe(false);
  });
});

describe("diagnose: chọn claude và phân tích filter", () => {
  it("ưu tiên .exe, rồi bản npm, bỏ shim không đuôi", () => {
    expect(c.chooseClaude(["C:\\npm\\claude", "C:\\npm\\claude.cmd", "C:\\bin\\claude.exe"])).toEqual({ kind: "exe", path: "C:\\bin\\claude.exe" });
    expect(c.chooseClaude(["C:\\npm\\claude", "C:\\npm\\claude.cmd"])).toEqual({ kind: "npm", path: "C:\\npm\\claude.cmd" });
    expect(c.chooseClaude([])).toBeUndefined();
  });

  it("đếm issue cập nhật sau mốc mà filter không trả", () => {
    const all = [
      { id: "a", updatedAt: "2026-11-25T00:00:00Z", content: { __typename: "Issue", updatedAt: "2026-11-25T00:00:00Z" } },
      { id: "b", updatedAt: "2026-10-01T00:00:00Z", content: { __typename: "Issue", updatedAt: "2026-11-25T00:00:00Z" } },
      { id: "c", updatedAt: "2026-10-01T00:00:00Z", content: { __typename: "Issue", updatedAt: "2026-10-01T00:00:00Z" } },
    ];
    expect(c.analyzeFilter(all, ["a"], "2026-11-21T00:00:00Z")).toEqual({ issuesAfter: 2, missed: 1, missedItemStale: 1 });
  });

  it("chọn mốc giờ từ dữ liệu và đếm phía client", () => {
    const nodes = ["2026-11-26T10:00:00Z", "2026-11-26T09:00:00Z", "2026-11-20T00:00:00Z"].map((updatedAt) => ({ updatedAt }));
    const probe = c.pickTimeProbe(nodes, 2);
    expect(probe).toBe("2026-11-26T08:59:59Z");
    expect(c.countAfter(nodes, probe)).toBe(2);
  });

  it("diagnoseDataDir giữ đồng bộ với resolveDataDir (004)", () => {
    const cases: Array<[Record<string, string>, string, string]> = [
      [{ APP_DATA_DIR: "/srv/d" }, "linux", "/home/u"],
      [{ APP_DATA_DIR: "D:\\gh" }, "win32", "C:\\Users\\u"],
      [{ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, "win32", "C:\\Users\\u"],
      [{}, "win32", "C:\\Users\\u"],
      [{ XDG_DATA_HOME: "/x" }, "linux", "/home/u"],
      [{}, "linux", "/home/u"],
    ];
    for (const [env, platform, home] of cases) {
      expect(c.diagnoseDataDir(env, platform, home).dir).toBe(resolveDataDir(env, platform, home));
    }
  });

  it("diagnoseDataDir và resolveDataDir cùng luật đường dẫn tuyệt đối", () => {
    const paths = ["/srv/d", "\\srv", "C:\\d", "C:/d", "C:d", "\\\\h\\s", "//h/s", "rel", "."];
    for (const platform of ["win32", "linux"]) {
      for (const p of paths) {
        const home = platform === "win32" ? "C:\\Users\\u" : "/home/u";
        let expected: string | "throws";
        try {
          expected = resolveDataDir({ APP_DATA_DIR: p }, platform, home);
        } catch {
          expected = "throws";
        }
        const got = c.diagnoseDataDir({ APP_DATA_DIR: p }, platform, home);
        expect(got.error ? "throws" : got.dir, `${platform} ${p}`).toBe(expected);
      }
    }
  });

  it("diagnoseDataDir ghi nguồn, không nhận đường dẫn tương đối", () => {
    expect(c.diagnoseDataDir({ LOCALAPPDATA: "C:\\x" }, "win32", "h").source).toBe("LOCALAPPDATA");
    expect(c.diagnoseDataDir({}, "win32", "h").source).toBe("fallback");
    expect(c.diagnoseDataDir({ APP_DATA_DIR: "rel" }, "linux", "h").error).toBeTypeOf("string");
  });

  it("fsErrorCode / describeStepFailure không lộ đường dẫn", () => {
    const e = Object.assign(new Error("EPERM: C:\\Users\\bob\\x"), { code: "EPERM" });
    expect(c.fsErrorCode(e)).toBe("EPERM");
    expect(c.fsErrorCode(Object.assign(new Error("m"), { code: "ERR_SQLITE_ERROR", errcode: 14, errstr: "unable to open database file" }))).toBe("SQLITE_CANTOPEN");
    const f = c.describeStepFailure("tạo thư mục", e);
    expect(f).toEqual({ level: "FAIL", detail: 'bước "tạo thư mục": EPERM' });
    expect(f.detail).not.toMatch(/bob/);
    expect(c.describeStepFailure("dọn file tạm", e).level).toBe("WARN");
  });

  it("N5: fsErrorCode đặt tên SQLite theo errcode & 0xff", () => {
    const named: Array<[number, string]> = [[5, "SQLITE_BUSY"], [6, "SQLITE_LOCKED"], [10, "SQLITE_IOERR"], [11, "SQLITE_CORRUPT"], [14, "SQLITE_CANTOPEN"], [26, "SQLITE_NOTADB"], [3338, "SQLITE_IOERR"], [2067, "SQLITE_CONSTRAINT"]];
    for (const [errcode, name] of named) {
      expect(c.fsErrorCode(Object.assign(new Error("m"), { code: "ERR_SQLITE_ERROR", errcode, errstr: "unable to open database file" }))).toBe(name);
    }
    expect(c.fsErrorCode(Object.assign(new Error("m"), { code: "ERR_SQLITE_ERROR", errcode: 999 & 0xff | 0x7f00 }))).toMatch(/^SQLITE_\d+$/);
  });

  it("localAppDataState", () => {
    expect(c.localAppDataState({ LOCALAPPDATA: "x" })).toBe("set");
    expect(c.localAppDataState({})).toBe("unset");
  });
});
