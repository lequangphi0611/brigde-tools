import { runTranslateIssueSafely } from "./run-translate-issue.ts";

// Nối runTranslateIssue với process. pnpm chạy script trong apps/app nhưng INIT_CWD giữ thư mục người dùng gõ lệnh.
const code = await runTranslateIssueSafely({
  argv: process.argv.slice(2),
  env: process.env,
  cwd: process.env["INIT_CWD"] || process.cwd(),
  stdout: { write: (c) => void process.stdout.write(c) },
  stderr: { write: (c) => void process.stderr.write(c) },
});
process.exitCode = code;
