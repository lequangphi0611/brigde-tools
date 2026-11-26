import { serve } from "@hono/node-server";
import { buildDeps } from "./composition-root.ts";
import { createApp } from "./server/app.ts";

const port = Number(process.env.PORT ?? 4317);
const app = createApp(buildDeps(process.env.APP_ADAPTERS));
serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => {
  console.log(`listening on http://127.0.0.1:${port} (adapters=${process.env.APP_ADAPTERS ?? "real"})`);
});
