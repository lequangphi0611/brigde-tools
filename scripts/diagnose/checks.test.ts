import { describe, expect, it } from "vitest";
import { fixedArgs } from "../../packages/core-translate/src/infrastructure/claude-cli/claude-cli-runner.ts";
import { checkCliConfig, FORBIDDEN_CLI_FLAGS } from "../../packages/core-translate/src/infrastructure/claude-cli/cli-config.ts";
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
});
