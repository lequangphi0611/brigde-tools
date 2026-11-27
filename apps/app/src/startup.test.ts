import { describe, expect, it } from "vitest";
import { formatStartupError, formatStorageError, startup } from "./startup.ts";
import { StorageError, type StorageErrorReason } from "./shared/infrastructure/sqlite/storage-error.ts";
import type { Database } from "./shared/infrastructure/sqlite/open-database.ts";

const validConfig = JSON.stringify({ project: { owner: "acme-secret", number: 77 } });
const base = { platform: "linux", homedir: "/home/u" };
const enoent = () => {
  throw Object.assign(new Error("x"), { code: "ENOENT" });
};
const fakeDb = {} as Database;

describe("startup nhánh thật (AC-2)", () => {
  it("GH_HOST chưa đặt hoặc rỗng: gh_host_unset, exit 2, không mở DB", () => {
    for (const GH_HOST of [undefined, ""]) {
      let opened = false;
      const r = startup({ ...base, env: { GH_HOST, APP_DATA_DIR: "/d" }, readFile: () => validConfig, openStorage: () => ((opened = true), fakeDb) });
      expect(r).toEqual({ ok: false, lines: ["[startup] FAIL gh_host_unset"], exitCode: 2 });
      expect(opened).toBe(false);
    }
  });

  it("APP_DATA_DIR tương đối: data_dir_invalid data=APP_DATA_DIR", () => {
    const r = startup({ ...base, env: { GH_HOST: "ghes.corp.test", APP_DATA_DIR: "rel/dir" }, readFile: enoent });
    expect(r).toEqual({ ok: false, lines: ["[startup] FAIL data_dir_invalid data=APP_DATA_DIR"], exitCode: 2 });
  });

  it("thiếu config.json: config_missing + dòng config= riêng, không mở DB", () => {
    let opened = false;
    const r = startup({ ...base, env: { GH_HOST: "ghes.corp.test", APP_DATA_DIR: "/d" }, readFile: enoent, openStorage: () => ((opened = true), fakeDb) });
    expect(r).toEqual({ ok: false, lines: ["[startup] FAIL config_missing", "[startup] config=/d/config.json"], exitCode: 2 });
    expect(opened).toBe(false);
  });

  it("config sai field: config_invalid field=..., không lộ giá trị", () => {
    const r = startup({ ...base, env: { GH_HOST: "ghes.corp.test", APP_DATA_DIR: "/d" }, readFile: () => JSON.stringify({ project: { owner: "acme-secret", number: "77" } }) });
    expect(r).toEqual({ ok: false, lines: ["[startup] FAIL config_invalid field=project.number"], exitCode: 2 });
  });

  it("dòng FAIL không chứa GH_HOST, owner, số project", () => {
    const cases = [
      startup({ ...base, env: {}, readFile: enoent }),
      startup({ ...base, env: { GH_HOST: "ghes.corp.test", APP_DATA_DIR: "rel" }, readFile: enoent }),
      startup({ ...base, env: { GH_HOST: "ghes.corp.test", APP_DATA_DIR: "/d" }, readFile: () => "{" }),
    ];
    for (const r of cases) {
      if (r.ok) throw new Error("unexpected");
      const fails = r.lines.filter((l) => l.includes("FAIL")).join("\n");
      expect(fails).not.toMatch(/ghes|acme|77|\/d/);
    }
  });

  it("hợp lệ: trả dataDir, config, storage mở tại <dataDir>/app.db", () => {
    let seen = "";
    const r = startup({ ...base, env: { GH_HOST: "ghes.corp.test", APP_DATA_DIR: "/d" }, readFile: () => validConfig, openStorage: (o) => ((seen = o.path), fakeDb) });
    expect(r.ok && r.dataDir).toBe("/d");
    expect(r.ok && r.config.project.owner).toBe("acme-secret");
    expect(seen).toBe("/d/app.db");
  });
});

describe("formatStorageError (AC-4)", () => {
  const db = "C:\\Users\\x\\AppData\\Local\\gh-issue-translator\\app.db";
  const reasons: StorageErrorReason[] = ["open_failed", "corrupt", "invalid_migrations", "migration_failed", "schema_too_new"];

  it.each(reasons)("reason %s với/không migration, sqliteCode", (reason) => {
    for (const details of [{}, { migration: 3 }, { sqliteCode: 1 }, { migration: 3, sqliteCode: 1 }]) {
      const e = new StorageError(reason, "thông báo", details);
      const [l1, l2] = formatStorageError(e, db);
      const mig = "migration" in details ? ` migration=${details.migration}` : "";
      const sq = "sqliteCode" in details ? ` sqlite=${details.sqliteCode}` : "";
      expect(l1).toBe(`[storage] FAIL ${reason}${mig}${sq}: thông báo`);
      expect(l1).not.toContain(db);
      expect(l2).toBe(`[storage] db=${db}`);
    }
  });

  it("openStorage ném StorageError: hai dòng, exit 1", () => {
    const e = new StorageError("migration_failed", "boom", { migration: 3, sqliteCode: 1 });
    const r = startup({
      ...base,
      env: { GH_HOST: "h", APP_DATA_DIR: "/d" },
      readFile: () => validConfig,
      openStorage: () => {
        throw e;
      },
    });
    expect(r).toEqual({ ok: false, lines: ["[storage] FAIL migration_failed migration=3 sqlite=1: boom", "[storage] db=/d/app.db"], exitCode: 1 });
  });

  it("lỗi không phải StorageError được ném tiếp", () => {
    expect(() =>
      startup({ ...base, env: { GH_HOST: "h", APP_DATA_DIR: "/d" }, readFile: () => validConfig, openStorage: () => { throw new TypeError("bug"); } }),
    ).toThrow("bug");
  });
});

describe("formatStartupError", () => {
  it("config_invalid một dòng", () => {
    expect(formatStartupError({ code: "config_invalid", field: "(root)" })).toEqual(["[startup] FAIL config_invalid field=(root)"]);
  });
});
