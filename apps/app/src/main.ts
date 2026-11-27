import { serve } from "@hono/node-server";
import { buildDeps } from "./composition-root.ts";
import { createApp } from "./server/app.ts";
import { StorageError } from "./shared/infrastructure/sqlite/storage-error.ts";

const port = Number(process.env.PORT ?? 4317);

let deps;
try {
  deps = buildDeps(process.env.APP_ADAPTERS);
} catch (e) {
  if (e instanceof StorageError) {
    const code = e.sqliteCode !== undefined ? ` sqlite=${e.sqliteCode}` : "";
    const mig = e.migration !== undefined ? ` migration=${e.migration}` : "";
    console.error(`[storage] ${e.reason}${mig}${code}: ${e.message}`);
    process.exit(1);
  }
  throw e;
}

const app = createApp(deps);
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => {
  console.log(`listening on http://127.0.0.1:${port} (adapters=${process.env.APP_ADAPTERS ?? "real"})`);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close();
    deps.storage.close();
    process.exit(0);
  });
}
