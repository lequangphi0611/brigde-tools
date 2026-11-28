import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import type { Translator } from "@app/core-translate";
import { buildDeps, buildRealTranslator, openRealTranslationRuntime, type Deps } from "./composition-root.ts";
import { startup } from "./startup.ts";
import { GhCliGateway } from "./contexts/tracking/infrastructure/gh-cli/gh-cli-gateway.ts";
import { setupFakeGh } from "./contexts/tracking/infrastructure/gh-cli/testing/fake-gh-setup.ts";
import type { GitHubFixture } from "./test-harness/github-fixture.ts";
import { systemClock } from "./shared/ports/clock.port.ts";
import { openAppStorage } from "./shared/infrastructure/sqlite/app-storage.ts";
import { createApp } from "./server/app.ts";

let dir: string;
const prev = process.env["APP_DATA_DIR"];
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ghit-root-"));
  process.env["APP_DATA_DIR"] = dir;
});
afterEach(() => {
  if (prev === undefined) delete process.env["APP_DATA_DIR"];
  else process.env["APP_DATA_DIR"] = prev;
  rmSync(dir, { recursive: true, force: true });
});

describe("composition root fake (AC-12)", () => {
  it("settings dùng được ngay, không tạo file trong dataDir", () => {
    const deps = buildDeps("fake");
    expect(deps.settings.get("notification.pausedUntil")).toBeNull();
    deps.settings.set("notification.pausedUntil", "X");
    expect(deps.settings.get("notification.pausedUntil")).toBe("X");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("/__test__/reset xoá dữ liệu, giữ schema và schemaVersion", async () => {
    const deps = buildDeps("fake");
    const app = createApp(deps);
    const version = deps.storage.schemaVersion();
    deps.settings.set("notification.pausedUntil", "X");
    const res = await app.request("/__test__/reset", { method: "POST" });
    expect(res.status).toBe(200);
    expect(deps.settings.get("notification.pausedUntil")).toBeNull();
    expect(deps.storage.schemaVersion()).toBe(version);
    deps.settings.set("tracking.after", "ok");
    expect(deps.settings.get("tracking.after")).toBe("ok");
  });

  it("hai lần buildDeps cho hai DB độc lập", () => {
    const a = buildDeps("fake");
    const b = buildDeps("fake");
    a.settings.set("notification.pausedUntil", "A");
    expect(b.settings.get("notification.pausedUntil")).toBeNull();
  });
});

describe("composition root fake: cache bản dịch (003 AC-16)", () => {
  it("translator có cache SQLite: dịch hai lần cùng kết quả, bảng translation có 1 hàng", async () => {
    const deps = buildDeps("fake");
    const request = { direction: { from: "ja", to: "vi" }, segments: [{ id: "a", text: "ログイン" }], context: { glossary: [] } } as const;
    const first = await deps.translator.translate(request);
    expect(first.segments).toEqual([{ id: "a", text: "[vi] ログイン" }]);
    expect(first.model).toBe("fake");
    const second = await deps.translator.translate(request);
    expect(second.segments).toEqual(first.segments);
    expect(second.model).toBeNull();
    expect((deps.storage.raw.prepare("SELECT count(*) n FROM translation").get() as { n: number }).n).toBe(1);
  });
});

describe("buildRealTranslator (003b)", () => {
  const FAKE = fileURLToPath(new URL("../../../packages/core-translate/src/infrastructure/claude-cli/testing/fake-claude-cli.mjs", import.meta.url));
  const request = {
    direction: { from: "ja", to: "vi" },
    segments: [{ id: "title", text: "ログイン不具合" }, { id: "body", text: "再現手順があります" }],
    context: { glossary: [] },
  } as const;

  function setup() {
    const record = path.join(dir, "rec.jsonl");
    const configPath = path.join(dir, "cli.json");
    writeFileSync(configPath, JSON.stringify({ command: process.execPath, args: [FAKE, "--fake-record", record], timeoutSeconds: 30 }));
    const calls = () => {
      try {
        return readFileSync(record, "utf8").trim().split("\n").filter(Boolean).length;
      } catch {
        return 0;
      }
    };
    return { configPath, calls };
  }

  it("dịch hai lần với SQLite :memory:, lần hai không gọi CLI; observer và wrapInner hoạt động", async () => {
    const { configPath, calls } = setup();
    const storage = openAppStorage({ path: ":memory:" });
    try {
      const lookups: Array<{ hits: number; misses: number }> = [];
      let innerCalls = 0;
      const translator = buildRealTranslator({
        configPath,
        storage,
        clock: systemClock,
        observer: { lookedUp: (s) => lookups.push(s) },
        wrapInner: (inner): Translator => ({
          translate: (r) => {
            innerCalls++;
            return inner.translate(r);
          },
        }),
      });
      const first = await translator.translate(request);
      expect(first.segments).toEqual([
        { id: "title", text: "[vi] ログイン不具合" },
        { id: "body", text: "[vi] 再現手順があります" },
      ]);
      expect(calls()).toBe(1);
      const second = await translator.translate(request);
      expect(second.segments).toEqual(first.segments);
      expect(calls()).toBe(1);
      expect(innerCalls).toBe(1);
      expect(lookups).toEqual([{ hits: 0, misses: 2 }, { hits: 2, misses: 0 }]);
      expect((storage.raw.prepare("SELECT count(*) n FROM translation").get() as { n: number }).n).toBe(2);
    } finally {
      storage.close();
    }
  });

  it("openRealTranslationRuntime mở <dataDir>/app.db thật và cache vào đó", async () => {
    const { configPath, calls } = setup();
    const runtime = openRealTranslationRuntime({ dataDir: dir, configPath });
    try {
      await runtime.translator.translate(request);
      await runtime.translator.translate(request);
      expect(calls()).toBe(1);
    } finally {
      runtime.storage.close();
    }
    const reopened = openAppStorage({ path: path.join(dir, "app.db") });
    try {
      expect((reopened.raw.prepare("SELECT count(*) n FROM translation").get() as { n: number }).n).toBe(2);
    } finally {
      reopened.close();
    }
  });

  it("openRealTranslationRuntime: dataDir không mở được → StorageError", () => {
    const file = path.join(dir, "la-file");
    writeFileSync(file, "x");
    expect(() => openRealTranslationRuntime({ dataDir: file, configPath: "x.json" })).toThrow(expect.objectContaining({ name: "StorageError" }));
  });

  it("cấu hình thiếu → not_configured, báo qua observer.cacheFailed(engineVersion)", async () => {
    const storage = openAppStorage({ path: ":memory:" });
    try {
      const stages: string[] = [];
      const translator = buildRealTranslator({
        configPath: path.join(dir, "khong-co.json"),
        storage,
        clock: systemClock,
        observer: { cacheFailed: (stage) => stages.push(stage) },
      });
      await expect(translator.translate(request)).rejects.toMatchObject({ name: "TranslationFailure", reason: "not_configured" });
      expect(stages).toEqual(["engineVersion"]);
    } finally {
      storage.close();
    }
  });
});

describe("composition root nhánh thật (005c AC-3, AC-5)", () => {
  const project = { owner: "fake", ownerType: "org", number: 1 } as const;
  const iss = (nodeId: string, n: number) => ({
    nodeId, repo: "o/r", number: n, url: `https://x/${nodeId}`, title: `t${n}`, body: `b${n}`, assignees: [], updatedAt: "2026-11-03T00:00:00Z", comments: [],
  });
  const fixture: GitHubFixture = {
    project,
    statusField: { name: "Status", kind: "single_select", options: [{ name: "Done", optionId: "o1" }] },
    items: [1, 2, 3].map((n) => ({ kind: "issue" as const, issue: iss(`I_${n}`, n) })),
  };
  const GH_ENV = { GH_HOST: "ghes.example.test" };

  function boot(mode: string, env?: Record<string, string>) {
    writeFileSync(path.join(dir, "config.json"), JSON.stringify({ project: { owner: "fake", number: 1 }, pollIntervalMin: 7, claudeCliConfig: path.join(dir, "no-such.json") }));
    const started = startup({ env: { ...GH_ENV, APP_DATA_DIR: dir }, platform: process.platform, homedir: "/unused" });
    if (!started.ok) throw new Error(started.lines.join("\n"));
    const fake = setupFakeGh(fixture, mode, {}, { ...GH_ENV, ...env });
    const lines: string[] = [];
    const delays: number[] = [];
    const deps = buildDeps("real", {
      config: started.config,
      storage: started.storage,
      log: (l) => lines.push(l),
      gh: fake.config,
      schedule: (_fn, ms) => (delays.push(ms), () => {}),
    });
    return { deps, lines, delays, fake };
  }
  const cycle = async (deps: Deps, lines: string[]) => {
    const { formatPollLine } = await import("./contexts/tracking/application/poll-line.ts");
    const line = formatPollLine(await deps.pollCycle!.run());
    lines.push(line);
    return line;
  };

  it("AC-3: DB ở <dataDir>/app.db, schema 3, GhCliGateway, BASELINE rồi OK new=0 sau khi dựng lại", async () => {
    const a = boot("ok");
    expect(a.deps.storage.schemaVersion()).toBe(3);
    expect(readdirSync(dir)).toContain("app.db");
    expect(a.deps.github).toBeInstanceOf(GhCliGateway);
    expect(a.deps.harness).toBeUndefined();
    expect(await cycle(a.deps, a.lines)).toMatch(/^\[poll\] BASELINE issues=3 /);
    a.deps.storage.close();

    const b = boot("ok");
    const line = await cycle(b.deps, b.lines);
    expect(line).toMatch(/^\[poll\] OK /);
    expect(line).toContain("new=0");
    b.deps.storage.close();
  });

  it("AC-3: scheduler dùng pollIntervalMin của cấu hình và chạy chu kỳ đầu qua log", async () => {
    const a = boot("ok");
    a.deps.scheduler!.start();
    await vi.waitFor(() => expect(a.delays).toEqual([7 * 60_000]));
    expect(a.lines[0]).toMatch(/^\[poll\] BASELINE issues=3 /);
    a.deps.scheduler!.stop();
    a.deps.storage.close();
  });

  it("AC-5: gh chưa đăng nhập không chặn khởi động; chuyển sang ok thì BASELINE", async () => {
    const a = boot("auth");
    const first = await cycle(a.deps, a.lines);
    expect(first).toMatch(/^\[poll\] FAIL github:not_authenticated ms=\d+/);
    expect(a.deps.storage.raw.prepare("SELECT count(*) n FROM tracked_project").get()).toEqual({ n: 0 });
    (a.fake.config.env as Record<string, string>)["FAKE_GH_MODE"] = "ok";
    expect(await cycle(a.deps, a.lines)).toMatch(/^\[poll\] BASELINE /);
    a.deps.storage.close();
  });

  it("claudeCliConfig của config được truyền vào translator: file không tồn tại thì dịch lỗi not_configured", async () => {
    const a = boot("ok");
    const req = { direction: { from: "ja", to: "vi" }, segments: [{ id: "a", text: "ログイン" }], context: { glossary: [] } } as const;
    await expect(a.deps.translator.translate(req)).rejects.toMatchObject({ reason: "not_configured" });
    // Tạo file đúng tại đường dẫn của config (đọc lại mỗi lần dịch): dịch thành công chứng tỏ đường dẫn đó được dùng.
    const fakeCli = fileURLToPath(new URL("../../../packages/core-translate/src/infrastructure/claude-cli/testing/fake-claude-cli.mjs", import.meta.url));
    writeFileSync(path.join(dir, "no-such.json"), JSON.stringify({ command: process.execPath, args: [fakeCli], timeoutSeconds: 30 }));
    expect((await a.deps.translator.translate(req)).segments).toEqual([{ id: "a", text: "[vi] ログイン" }]);
    a.deps.storage.close();
  });

  it("thiếu RealWiring thì ném", () => {
    expect(() => buildDeps(undefined)).toThrow();
  });
});
