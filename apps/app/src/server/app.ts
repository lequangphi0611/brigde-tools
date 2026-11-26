import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Deps } from "../composition-root.ts";
import { testHarnessRoutes } from "../test-harness/routes.ts";

export function createApp(deps: Deps) {
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ ok: true }));
  if (deps.harness) app.route("/__test__", testHarnessRoutes(deps.harness));
  app.use("/*", serveStatic({ root: "./web/dist" }));
  app.get("*", serveStatic({ path: "./web/dist/index.html" }));
  return app;
}
