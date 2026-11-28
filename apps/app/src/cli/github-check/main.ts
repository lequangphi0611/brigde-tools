import { buildRealGitHubGateway } from "../../composition-root.ts";
import { runGithubCheckSafely } from "./run-github-check.ts";

const code = await runGithubCheckSafely({
  argv: process.argv.slice(2),
  env: process.env,
  stdout: { write: (c) => void process.stdout.write(c) },
  stderr: { write: (c) => void process.stderr.write(c) },
  createGateway: ({ onStderr }) => buildRealGitHubGateway(onStderr ? { onStderr } : {}),
});
process.exitCode = code;
