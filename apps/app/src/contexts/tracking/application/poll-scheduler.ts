import type { PollReport } from "./poll-report.ts";
import { formatPollLine } from "./poll-line.ts";

export interface PollSchedulerDeps {
  /** Chạy một chu kỳ (thường `() => pollCycle.run()`); ném lỗi cũng được. */
  readonly runCycle: () => Promise<PollReport>;
  readonly pollIntervalMin: number;
  readonly log: (line: string) => void;
  /** Hẹn giờ tiêm vào; trả hàm huỷ. Mặc định `setTimeout` (unref). */
  readonly schedule?: (fn: () => void, delayMs: number) => () => void;
}

const defaultSchedule: NonNullable<PollSchedulerDeps["schedule"]> = (fn, delayMs) => {
  const handle = setTimeout(fn, delayMs);
  handle.unref();
  return () => clearTimeout(handle);
};

/**
 * Vòng lặp poll: chạy ngay khi `start()`, rồi hẹn chu kỳ sau `pollIntervalMin` phút kể từ lúc chu kỳ trước xong.
 * Không bao giờ hai chu kỳ cùng lúc; mọi lỗi được bắt và in `[poll] FAIL internal`.
 */
export class PollScheduler {
  private cancelTimer: (() => void) | null = null;
  private running = false;
  private stopped = true;

  constructor(private readonly deps: PollSchedulerDeps) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    this.cancelTimer = null;
    try {
      this.deps.log(formatPollLine(await this.deps.runCycle()));
    } catch {
      this.deps.log(formatPollLine({ status: "FAIL", cause: { type: "internal" } }));
    } finally {
      this.running = false;
    }
    if (this.stopped) return;
    const schedule = this.deps.schedule ?? defaultSchedule;
    this.cancelTimer = schedule(() => void this.tick(), this.deps.pollIntervalMin * 60_000);
  }
}
