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

  it("findConfigRangeProblem khớp checkCliConfig (khoảng, trường)", () => {
    const base = { command: "claude" };
    for (const [field, [min, max]] of Object.entries(c.CLAUDE_CONFIG_RANGES) as Array<[string, [number, number]]>) {
      for (const v of [min - 1, min, max, max + 1, 1.5, "x"]) {
        const diag = c.findConfigRangeProblem({ ...base, [field]: v });
        const app = checkCliConfig({ ...base, [field]: v }, "linux");
        expect(diag === undefined, `${field}=${String(v)}`).toBe(app.ok);
        if (diag) expect(app).toMatchObject({ field: diag.field });
      }
    }
    expect(c.findConfigRangeProblem({ timeoutSeconds: 3000 })).toEqual({ field: "timeoutSeconds", min: 10, max: 1800, value: 3000 });
    expect(c.findConfigRangeProblem({ timeoutSeconds: "3000" })).toMatchObject({ field: "timeoutSeconds", value: undefined });
    expect(c.findConfigRangeProblem({})).toBeUndefined();
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

  describe("005a: đo cho GhCliGateway", () => {
    it("chunk chia lô", () => {
      expect(c.chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
      expect(c.chunk([], 25)).toEqual([]);
    });

    it("summarizeItemScan đếm Issue/PR/draft/không quyền, mỗi id một lần", () => {
      const nodes = [
        { content: { __typename: "Issue", id: "I_1", updatedAt: "2026-01-01T00:00:00Z" } },
        { content: { __typename: "Issue", id: "I_1", updatedAt: "2026-01-01T00:00:00Z" } },
        { content: { __typename: "Issue", id: "I_2", updatedAt: "2026-01-02T00:00:00Z" } },
        { content: { __typename: "PullRequest" } },
        { content: { __typename: "DraftIssue" } },
        { content: null },
      ];
      expect(c.summarizeItemScan(nodes, 1)).toEqual({
        pages: 1, items: 6, issues: 2, pullRequest: 1, draftIssue: 1, inaccessible: 1, closed: 0, statusSet: 0, statusOptions: 0, ids: ["I_1", "I_2"],
      });
    });

    it("summarizeItemScan đếm closed, statusSet, statusOptions (không in giá trị)", () => {
      const I = (id: string, state: string) => ({ __typename: "Issue", id, updatedAt: "2026-01-01T00:00:00Z", state });
      const nodes = [
        { content: I("I_1", "CLOSED"), status: { __typename: "ProjectV2ItemFieldSingleSelectValue", optionId: "a" } },
        { content: I("I_2", "OPEN"), status: { __typename: "ProjectV2ItemFieldSingleSelectValue", optionId: "b" } },
        { content: I("I_3", "OPEN"), status: { __typename: "ProjectV2ItemFieldSingleSelectValue", optionId: "a" } },
        { content: I("I_4", "CLOSED"), status: null },
        { content: I("I_4", "CLOSED") },
        { content: { __typename: "PullRequest" }, status: { optionId: "c" } },
      ];
      expect(c.summarizeItemScan(nodes, 2)).toMatchObject({ issues: 4, closed: 2, statusSet: 4, statusOptions: 3 });
    });

    it("statusFieldState", () => {
      expect(c.statusFieldState({ field: { __typename: "ProjectV2SingleSelectField" } })).toBe("found");
      expect(c.statusFieldState({ field: null })).toBe("missing");
      expect(c.statusFieldState({ unsupported: true, field: { x: 1 } })).toBe("unsupported");
    });

    it("summarizeComments đếm withComments, maxComments, over100, newerComment, editedComment", () => {
      const T = "2026-03-10T00:00:00Z";
      const issues = [
        { updatedAt: T, comments: { totalCount: 0, nodes: [] } },
        { updatedAt: T, comments: { totalCount: 3, nodes: [{ createdAt: "2026-03-09T00:00:00Z", updatedAt: "2026-03-09T00:00:00Z" }] } },
        { updatedAt: T, comments: { totalCount: 150, nodes: [{ createdAt: "2026-03-11T00:00:00Z", updatedAt: "2026-03-11T00:00:00Z" }] } },
        { updatedAt: T, comments: { totalCount: 2, nodes: [{ createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-03-12T00:00:00Z" }] } },
        null,
        {},
      ];
      expect(c.summarizeComments(issues)).toEqual({
        issues: 4, withComments: 3, maxComments: 150, over100: 1, newerComment: 1, editedComment: 2,
      });
      expect(c.summarizeComments([])).toEqual({ issues: 0, withComments: 0, maxComments: 0, over100: 0, newerComment: 0, editedComment: 0 });
    });

    it("mutateNodeId giữ độ dài, khác id gốc", () => {
      for (const id of ["I_kwDOABC123", "MDU6SXNzdWUx", "I_zzz9", "I_a"]) {
        const m = c.mutateNodeId(id);
        expect(m).not.toBe(id);
        expect(m).toHaveLength(id.length);
        expect(m.slice(0, -1)).toBe(id.slice(0, -1));
      }
    });

    it("classifyPartial phân loại (exit 1 + JSON có data), (exit 1 + stdout rỗng), (exit 0)", () => {
      const partial = JSON.stringify({ data: { nodes: [{ id: "I_1" }, null] }, errors: [{ message: "x" }] });
      expect(c.classifyPartial({ code: 1, stdout: partial })).toEqual({ exit: 1, stdoutJson: true, data: 1, hasErrors: true });
      expect(c.classifyPartial({ code: 1, stdout: "" })).toEqual({ exit: 1, stdoutJson: false, data: 0, hasErrors: false });
      const ok = JSON.stringify({ data: { nodes: [{ id: "I_1" }, { id: "I_2" }] } });
      expect(c.classifyPartial({ code: 0, stdout: ok })).toEqual({ exit: 0, stdoutJson: true, data: 2, hasErrors: false });
      expect(c.classifyPartial({ code: 1, stdout: JSON.stringify({ errors: [{}] }) })).toMatchObject({ stdoutJson: false, hasErrors: true });
      expect(c.classifyPartial({ code: 1, stdout: "not json" }).stdoutJson).toBe(false);
    });
  });
});
