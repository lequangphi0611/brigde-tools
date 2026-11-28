import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { contractFixture } from "../../shared/ports/testing/github-gateway.contract.ts";

// Spawn đúng lệnh người dùng gõ (`pnpm -s github-check`) với một `gh` giả đứng đầu PATH.
// Windows: bỏ qua có chủ đích. Shim `gh` phải là .cmd mà spawn không shell của adapter không chạy được; muốn chạy cần thêm
// cấu hình lệnh gh vào code production chỉ cho test. Cùng đường code đã được run-github-check.test.ts phủ trên mọi OS
// (dùng fake gh qua process.execPath + argsPrefix); trên máy Windows thật kiểm bằng chạy `github-check`.
const REPO = fileURLToPath(new URL("../../../../../", import.meta.url));
const FAKE = path.join(REPO, "apps/app/src/contexts/tracking/infrastructure/gh-cli/testing/fake-gh.mjs");
const base = path.join(REPO, "node_modules", ".cache");
mkdirSync(base, { recursive: true });
const root = mkdtempSync(path.join(base, "ghcheck-process-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe.skipIf(process.platform === "win32")("github-check ở mức process", () => {
  it("AC-13: stdout/stderr không chứa dữ liệu, dòng cuối đúng, exit code", { timeout: 60_000 }, () => {
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    const shim = path.join(bin, "gh");
    writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" "$@"\n`);
    chmodSync(shim, 0o755);
    const fixture = path.join(root, "fixture.json");
    writeFileSync(fixture, JSON.stringify(contractFixture()));
    const run = (mode: string) =>
      spawnSync("pnpm", ["-s", "github-check", "--owner", "ZZOWNER", "--number", "3"], {
        cwd: REPO,
        env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env["PATH"]}`, GH_HOST: "ZZhost.example.test", FAKE_GH_FIXTURE: fixture, FAKE_GH_MODE: mode },
        encoding: "utf8",
      });
    const ok = run("ok");
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout.trim().split("\n")).toHaveLength(1);
    expect(ok.stdout).toMatch(/^github-check OK host=GH_HOST items=8 issues=4 skipped=pr:2,draft:1,noaccess:1 closed=1 statusField=found /);
    const auth = run("auth");
    expect(auth.status).toBe(1);
    expect(auth.stdout).toBe("github-check FAIL github:not_authenticated\n");
    for (const r of [ok, auth]) expect(r.stdout + r.stderr).not.toMatch(/ZZ|acme/);
  });
});
