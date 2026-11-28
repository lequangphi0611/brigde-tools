import { describe, expect, it } from "vitest";
import { DEFAULT_CLAUDE_CLI_CONFIG, loadAppConfig } from "./app-config.ts";

const load = (content: string | null, dataDir = "/data") =>
  loadAppConfig({
    dataDir,
    readFile: () => {
      if (content === null) throw Object.assign(new Error("x"), { code: "ENOENT" });
      return content;
    },
  });

const base = { project: { owner: "acme-secret", number: 12 } };
const failField = (v: unknown) => {
  const r = load(JSON.stringify(v));
  expect(r.ok).toBe(false);
  return r.ok ? "" : JSON.stringify(r.error);
};

describe("AppConfig (AC-1)", () => {
  it("mặc định khi chỉ khai owner và number", () => {
    const r = load(JSON.stringify(base));
    expect(r).toEqual({
      ok: true,
      config: {
        project: { owner: "acme-secret", ownerType: "org", number: 12, statusField: "Status", closedStatuses: [] },
        pollIntervalMin: 5,
        claudeCliConfig: DEFAULT_CLAUDE_CLI_CONFIG,
      },
    });
  });

  it("ownerType user, khoá lạ bị bỏ qua, BOM được chấp nhận", () => {
    const r = load("﻿" + JSON.stringify({ ...base, project: { ...base.project, ownerType: "user" }, extra: 1 }));
    expect(r.ok && r.config.project.ownerType).toBe("user");
  });

  it("claudeCliConfig tương đối tính từ dataDir", () => {
    const r = load(JSON.stringify({ ...base, claudeCliConfig: "c.json" }), "/data");
    expect(r.ok && r.config.claudeCliConfig).toBe("/data/c.json");
  });

  it("claudeCliConfig win32: tuyệt đối giữ nguyên, \\x.json (không ổ đĩa) coi là tương đối", () => {
    const at = (v: string) => loadAppConfig({ dataDir: "C:\\data", platform: "win32", readFile: () => JSON.stringify({ ...base, claudeCliConfig: v }) });
    const abs = at("D:\\cfg\\c.json");
    expect(abs.ok && abs.config.claudeCliConfig).toBe("D:\\cfg\\c.json");
    const rel = at("\\x.json");
    expect(rel.ok && rel.config.claudeCliConfig).toBe("C:\\x.json");
    const rel2 = at("sub\\c.json");
    expect(rel2.ok && rel2.config.claudeCliConfig).toBe("C:\\data\\sub\\c.json");
  });

  it("không có file: config_missing kèm đường dẫn", () => {
    expect(load(null)).toEqual({ ok: false, error: { code: "config_missing", path: "/data/config.json" } });
  });

  it("không phải JSON hoặc là mảng: field (root)", () => {
    expect(load("{nope")).toEqual({ ok: false, error: { code: "config_invalid", field: "(root)" } });
    expect(load("[]")).toEqual({ ok: false, error: { code: "config_invalid", field: "(root)" } });
  });

  it.each([
    [{ project: { owner: "secret-o", number: "12" } }, "project.number"],
    [{ ...base, pollIntervalMin: 0 }, "pollIntervalMin"],
    [{ ...base, pollIntervalMin: 61 }, "pollIntervalMin"],
    [{ ...base, pollIntervalMin: 2.5 }, "pollIntervalMin"],
    [{ project: { ...base.project, closedStatuses: [""] } }, "project.closedStatuses.0"],
    [{ project: { number: 3 } }, "project.owner"],
  ])("sai field %#", (v, field) => {
    const err = failField(v);
    expect(err).toContain(`"field":"${field}"`);
    expect(err).not.toContain("secret");
  });
});
