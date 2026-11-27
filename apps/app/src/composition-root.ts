import path from "node:path";
import {
  CachingTranslator,
  ClaudeCliTranslator,
  FakeTranslator,
  claudeCliEngineVersion,
  type CachingObserver,
  type Translator,
} from "@app/core-translate";
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

export interface RealTranslatorOptions {
  /** File cấu hình Claude CLI (ADR-0003). Đọc lại mỗi lần dịch. */
  configPath: string;
  storage: Database;
  clock: Clock;
  observer?: CachingObserver;
  /** Bọc `Translator` bên trong cache (vd. đếm số lần gọi engine); không đổi hành vi nếu bỏ qua. */
  wrapInner?: (inner: Translator) => Translator;
}

/**
 * Translator thật: `CachingTranslator(ClaudeCliTranslator)` với cache SQLite (003, 003b).
 * Cùng một đường lắp cho `translate-issue` và nhánh adapter thật của server (005).
 */
export function buildRealTranslator(options: RealTranslatorOptions): Translator {
  const { configPath, storage, clock, observer, wrapInner } = options;
  const engine = new ClaudeCliTranslator(configPath);
  return new CachingTranslator({
    inner: wrapInner ? wrapInner(engine) : engine,
    cache: new SqliteTranslationCache(storage, clock),
    engineVersion: () => claudeCliEngineVersion(configPath),
    ...(observer ? { observer } : {}),
  });
}

export interface RealTranslationRuntimeOptions {
  /** Thư mục dữ liệu app (đã resolve); DB nằm ở `<dataDir>/app.db`. */
  dataDir: string;
  configPath: string;
  observer?: CachingObserver;
  wrapInner?: (inner: Translator) => Translator;
}

export interface RealTranslationRuntime {
  translator: Translator;
  /** Người gọi đóng khi xong. */
  storage: Database;
}

/**
 * Storage thật + translator thật cho CLI (`translate-issue`), cùng đồng hồ hệ thống.
 * Lỗi mở DB ném `StorageError`; lỗi sau khi đã mở thì DB được đóng trước khi ném lại.
 */
export function openRealTranslationRuntime(options: RealTranslationRuntimeOptions): RealTranslationRuntime {
  const { dataDir, ...rest } = options;
  const storage = openAppStorage({ path: path.join(dataDir, "app.db") });
  try {
    return { storage, translator: buildRealTranslator({ ...rest, storage, clock: systemClock }) };
  } catch (e) {
    storage.close();
    throw e;
  }
}
