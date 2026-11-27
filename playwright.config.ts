import { defineConfig } from "@playwright/test";

/**
 * E2E khoá hành vi người dùng. App chạy với APP_ADAPTERS=fake:
 * GitHub, claude -p, toast Windows và đồng hồ đều là fake điều khiển qua /__test__/*.
 */
export default defineConfig({
  testDir: "./e2e/specs",
  fullyParallel: false, // app có state chung (1 process) → chạy tuần tự
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL: "http://127.0.0.1:4317", trace: "off" },
  webServer: {
    command: "pnpm --filter @app/app start:e2e",
    // Đặt env ở đây thay vì `VAR=x cmd` trong script: cú pháp đó không chạy trên Windows (cmd.exe).
    env: { APP_ADAPTERS: "fake", PORT: "4317" },
    url: "http://127.0.0.1:4317/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
