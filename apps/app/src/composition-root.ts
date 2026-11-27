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
import { InProcessEventBus } from "./shared/infrastructure/events/in-process-event-bus.ts";
import { classifyStorageFailure } from "./shared/infrastructure/sqlite/storage-error.ts";
import { SqliteUnitOfWork } from "./shared/infrastructure/sqlite/sqlite-unit-of-work.ts";
import { PollCycle, type PollProjectConfig } from "./contexts/tracking/application/poll-cycle.ts";
import { SqliteTrackingRepository } from "./contexts/tracking/infrastructure/sqlite-tracking-repository.ts";
import { ControllableClock, FakeGitHub, RecordingNotifier } from "./test-harness/fakes.ts";
import { toPollProjectConfig, type AppConfig } from "./shared/infrastructure/app-config.ts";
import { GhCliGateway } from "./contexts/tracking/infrastructure/gh-cli/gh-cli-gateway.ts";
import type { GhCliConfig } from "./contexts/tracking/infrastructure/gh-cli/gh-cli-runner.ts";
import { PollScheduler } from "./contexts/tracking/application/poll-scheduler.ts";

export interface Deps {
  translator: Translator;
  github: GitHubGateway;
  notifier: Notifier;
  clock: Clock;
  settings: SettingStore;
  /** Handle SQLite dùng chung; đóng khi tắt app. */
  storage: Database;
  /** Chỉ có khi chạy fake — để mount test-harness routes. */
  /** Chỉ có ở nhánh thật: người gọi (main.ts) `start()` sau khi server lên và `stop()` khi tắt. */
  scheduler?: PollScheduler;
  /** Chỉ có ở nhánh thật; test chạy trực tiếp một chu kỳ mà không chờ hẹn giờ. */
  pollCycle?: PollCycle;
  harness?: { storage: Database; github: FakeGitHub; notifier: RecordingNotifier; clock: ControllableClock; pollCycle: PollCycle };
}

/** Project cố định của chế độ fake (005b); chu kỳ chỉ chạy khi test gọi `POST /__test__/poll`. */
export const FAKE_POLL_PROJECT: PollProjectConfig = { owner: "fake", ownerType: "org", number: 1, statusField: "Status", closedStatuses: [] };

/** Đầu vào nhánh thật: kết quả của `startup()` (storage đã mở, cấu hình đã kiểm) + chỗ tiêm cho test. */
export interface RealWiring {
  config: AppConfig;
  /** Đã mở bằng `openAppStorage(<dataDir>/app.db)`; `Deps.storage` giữ đúng handle này. */
  storage: Database;
  /** Mặc định `console.log`. */
  log?: (line: string) => void;
  /** Cấu hình `gh` (test trỏ tới fake-gh mức process). */
  gh?: Partial<GhCliConfig>;
  /** Hẹn giờ tiêm vào cho `PollScheduler` (test). */
  schedule?: (fn: () => void, delayMs: number) => () => void;
}

/** Notifier không làm gì tới khi có toast thật (007). */
class NoopNotifier implements Notifier {
  async notify(): Promise<void> {}
}

/** Nơi DUY NHẤT quyết định adapter thật hay fake. Nhánh thật cần `real` (từ `startup()`). */
export function buildDeps(mode: string | undefined, real?: RealWiring): Deps {
  if (mode === "fake") {
    const github = new FakeGitHub();
    const notifier = new RecordingNotifier();
    const clock = new ControllableClock();
    // Fake dùng SQLite thật trong bộ nhớ (ADR-0008), không đụng tới dataDir.
    const storage = openAppStorage({ path: ":memory:" });
    const pollCycle = new PollCycle({
      github,
      repository: new SqliteTrackingRepository(storage),
      unitOfWork: new SqliteUnitOfWork(storage),
      publisher: new InProcessEventBus(), // chưa có bên nghe (006/007 đăng ký ở đây)
      clock,
      project: FAKE_POLL_PROJECT,
      classifyStorageError: classifyStorageFailure,
    });
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
      harness: { storage, github, notifier, clock, pollCycle },
    };
  }
  if (!real) throw new Error("Nhánh adapter thật cần RealWiring (chạy startup() trước) hoặc APP_ADAPTERS=fake.");
  const { config, storage } = real;
  const clock = systemClock;
  const github = new GhCliGateway(real.gh ?? {});
  const pollCycle = new PollCycle({
    github,
    repository: new SqliteTrackingRepository(storage),
    unitOfWork: new SqliteUnitOfWork(storage),
    publisher: new InProcessEventBus(), // chưa có bên nghe (006/007 đăng ký ở đây)
    clock,
    project: toPollProjectConfig(config),
    classifyStorageError: classifyStorageFailure,
  });
  const scheduler = new PollScheduler({
    runCycle: () => pollCycle.run(),
    pollIntervalMin: config.pollIntervalMin,
    log: real.log ?? ((line) => console.log(line)),
    ...(real.schedule ? { schedule: real.schedule } : {}),
  });
  return {
    // Đã lắp nhưng chưa ai gọi tới 006.
    translator: buildRealTranslator({ configPath: config.claudeCliConfig, storage, clock }),
    github,
    notifier: new NoopNotifier(),
    clock,
    settings: new SqliteSettingStore(storage),
    storage,
    scheduler,
    pollCycle,
  };
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
