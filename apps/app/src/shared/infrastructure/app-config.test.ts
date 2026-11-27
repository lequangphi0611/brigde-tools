import { describe, expect, it } from "vitest";
import { DEFAULT_CLAUDE_CLI_CONFIG, loadAppConfig, toPollProjectConfig } from "./app-config.ts";

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

  it("ánh xạ sang PollProjectConfig", () => {
    const r = load(JSON.stringify({ project: { ...base.project, closedStatuses: ["Done"] }, pollIntervalMin: 1 }));
    if (!r.ok) throw new Error("unexpected");
    expect(toPollProjectConfig(r.config)).toEqual({ owner: "acme-secret", ownerType: "org", number: 12, statusField: "Status", closedStatuses: ["Done"] });
    expect(r.config.pollIntervalMin).toBe(1);
  });

  it("claudeCliConfig tương đối tính từ dataDir", () => {
    const r = load(JSON.stringify({ ...base, claudeCliConfig: "c.json" }), "/data");
    expect(r.ok && r.config.claudeCliConfig).toBe("/data/c.json");
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
    [{ project: { ...base.project, closedStatuses: [""] } }, "closedStatuses.0"],
    [{ project: { number: 3 } }, "project.owner"],
  ])("sai field %#", (v, field) => {
    const err = failField(v);
    expect(err).toContain(`"field":"${field.startsWith("closed") ? "project." + field : field}"`);
    expect(err).not.toContain("secret");
  });
});
