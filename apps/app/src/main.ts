import { homedir } from "node:os";
import { serve } from "@hono/node-server";
import { buildDeps, type Deps } from "./composition-root.ts";
import { createApp } from "./server/app.ts";
import { startup } from "./startup.ts";

const port = Number(process.env.PORT ?? 4317);
const mode = process.env.APP_ADAPTERS;

let deps: Deps;
if (mode === "fake") {
  deps = buildDeps(mode);
} else {
  const started = startup({ env: process.env, platform: process.platform, homedir: homedir() });
  if (!started.ok) {
    for (const line of started.lines) console.error(line);
    process.exit(started.exitCode);
  }
  deps = buildDeps(mode, { config: started.config, storage: started.storage });
}

const app = createApp(deps);
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => {
  console.log(`listening on http://127.0.0.1:${port} (adapters=${mode ?? "real"})`);
  deps.scheduler?.start();
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    deps.scheduler?.stop();
    server.close();
    deps.storage.close();
    process.exit(0);
  });
}
