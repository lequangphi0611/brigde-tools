import { Hono } from "hono";
import type { Database } from "../shared/infrastructure/sqlite/open-database.ts";
import { clearAllTables } from "./clear-storage.ts";
import type { FakeGitHub, RecordingNotifier, ControllableClock } from "./fakes.ts";

/**
 * API điều khiển CHỈ dành cho e2e. Chỉ được mount khi APP_ADAPTERS=fake (xem main.ts).
 * E2E dùng nó để: nạp dữ liệu GitHub giả, chỉnh đồng hồ, đọc toast đã bắn, reset state.
 */
export function testHarnessRoutes(deps: { storage: Database; github: FakeGitHub; notifier: RecordingNotifier; clock: ControllableClock }) {
  const r = new Hono();
  r.post("/reset", (c) => {
    deps.github.reset();
    deps.notifier.sent.length = 0;
    deps.clock.reset();
    clearAllTables(deps.storage);
    return c.json({ ok: true });
  });
  r.post("/github/issues", async (c) => {
    deps.github.seedIssues(await c.req.json());
    return c.json({ ok: true });
  });
  r.post("/clock", async (c) => {
    const { now } = await c.req.json<{ now: string }>();
    deps.clock.set(now);
    return c.json({ ok: true });
  });
  r.get("/toasts", (c) => c.json(deps.notifier.sent));
  return r;
}
