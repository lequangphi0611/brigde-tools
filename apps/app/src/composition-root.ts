import { CachingTranslator, FakeTranslator, type Translator } from "@app/core-translate";
import { systemClock, type Clock } from "./shared/ports/clock.port.ts";
import type { GitHubGateway } from "./shared/ports/github-gateway.port.ts";
import type { Notifier } from "./shared/ports/notifier.port.ts";
import { openAppStorage } from "./shared/infrastructure/sqlite/app-storage.ts";
import type { Database } from "./shared/infrastructure/sqlite/open-database.ts";
import { SqliteSettingStore } from "./shared/infrastructure/sqlite/sqlite-setting-store.ts";
import type { SettingStore } from "./shared/ports/setting-store.port.ts";
import { SqliteTranslationCache } from "./contexts/translation/infrastructure/sqlite-translation-cache.ts";
import { ControllableClock, FakeGitHub, RecordingNotifier } from "./test-harness/fakes.ts";

export interface Deps {
  translator: Translator;
  github: GitHubGateway;
  notifier: Notifier;
  clock: Clock;
  settings: SettingStore;
  /** Handle SQLite dùng chung; đóng khi tắt app. */
  storage: Database;
  /** Chỉ có khi chạy fake — để mount test-harness routes. */
  harness?: { storage: Database; github: FakeGitHub; notifier: RecordingNotifier; clock: ControllableClock };
}

/** Nơi DUY NHẤT quyết định adapter thật hay fake. */
export function buildDeps(mode: string | undefined): Deps {
  if (mode === "fake") {
    const github = new FakeGitHub();
    const notifier = new RecordingNotifier();
    const clock = new ControllableClock();
    // Fake dùng SQLite thật trong bộ nhớ (ADR-0008), không đụng tới dataDir.
    const storage = openAppStorage({ path: ":memory:" });
    return {
      translator: new CachingTranslator({
        inner: new FakeTranslator(),
        cache: new SqliteTranslationCache(storage, clock),
        engineVersion: () => ({ promptVersion: "fake/1", configuredModel: "" }),
      }),
      github,
      notifier,
      clock,
      settings: new SqliteSettingStore(storage),
      storage,
      harness: { storage, github, notifier, clock },
    };
  }
  // TODO(spike): adapter thật — ClaudeCliTranslator, GhCliGateway, WindowsToastNotifier.
  void systemClock;
  throw new Error("Real adapters chưa được implement. Chạy với APP_ADAPTERS=fake.");
}
