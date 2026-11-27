import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import type { Translator } from "@app/core-translate";
import { buildDeps, buildRealTranslator } from "./composition-root.ts";
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
