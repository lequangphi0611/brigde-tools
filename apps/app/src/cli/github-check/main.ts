import { GhCliGateway } from "../../contexts/tracking/infrastructure/gh-cli/gh-cli-gateway.ts";
import { runGithubCheckSafely } from "./run-github-check.ts";

const code = await runGithubCheckSafely({
  argv: process.argv.slice(2),
  env: process.env,
  stdout: { write: (c) => void process.stdout.write(c) },
  stderr: { write: (c) => void process.stderr.write(c) },
  createGateway: ({ onStderr }) => new GhCliGateway(onStderr ? { onStderr } : {}),
});
process.exitCode = code;
