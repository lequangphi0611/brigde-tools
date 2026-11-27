import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDeps } from "./composition-root.ts";
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
