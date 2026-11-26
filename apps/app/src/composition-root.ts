import { FakeTranslator, type Translator } from "@app/core-translate";
import { systemClock, type Clock } from "./shared/ports/clock.port.ts";
import type { GitHubGateway } from "./shared/ports/github-gateway.port.ts";
import type { Notifier } from "./shared/ports/notifier.port.ts";
import { ControllableClock, FakeGitHub, RecordingNotifier } from "./test-harness/fakes.ts";

export interface Deps {
  translator: Translator;
  github: GitHubGateway;
  notifier: Notifier;
  clock: Clock;
  /** Chỉ có khi chạy fake — để mount test-harness routes. */
  harness?: { github: FakeGitHub; notifier: RecordingNotifier; clock: ControllableClock };
}

/** Nơi DUY NHẤT quyết định adapter thật hay fake. */
export function buildDeps(mode: string | undefined): Deps {
  if (mode === "fake") {
    const github = new FakeGitHub();
    const notifier = new RecordingNotifier();
    const clock = new ControllableClock();
    return { translator: new FakeTranslator(), github, notifier, clock, harness: { github, notifier, clock } };
  }
  // TODO(spike): adapter thật — ClaudeCliTranslator, GhCliGateway, WindowsToastNotifier.
  void systemClock;
  throw new Error("Real adapters chưa được implement. Chạy với APP_ADAPTERS=fake.");
}
