import { describe, expect, it } from "vitest";
import { PollScheduler } from "./poll-scheduler.ts";
import type { PollReport } from "./poll-report.ts";

const ok: PollReport = {
  status: "OK", ms: 1,
  stats: { issues: 0, closed: 0, skipped: { pullRequest: 0, draftIssue: 0, inaccessible: 0 }, pages: 1, details: 0, missing: 0, newIssues: 0, newComments: 0, edited: 0, closedChanged: 0, failed: 0 },
};

function setup(runs: Array<() => Promise<PollReport>>) {
  const lines: string[] = [];
  const timers: Array<{ fn: () => void; delayMs: number; cancelled: boolean }> = [];
  let started = 0;
  const sched = new PollScheduler({
    pollIntervalMin: 5,
    log: (l) => lines.push(l),
    runCycle: () => {
      const run = runs[started++];
      if (!run) throw new Error("hết kịch bản");
      return run();
    },
    schedule: (fn, delayMs) => {
      const timer = { fn, delayMs, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  return { sched, lines, timers, started: () => started };
}
const flush = () => new Promise((r) => setImmediate(r));

describe("AC-26 PollScheduler", () => {
  it("chạy ngay, hẹn chu kỳ sau chỉ khi chu kỳ trước xong, cách 5 phút", async () => {
    let finish!: (r: PollReport) => void;
    const { sched, timers, started, lines } = setup([() => new Promise((r) => (finish = r)), async () => ok]);
    sched.start();
    sched.start(); // gọi lại không chạy chồng
    expect(started()).toBe(1);
    await flush();
    expect(timers).toHaveLength(0);
    finish(ok);
    await flush();
    expect(timers).toHaveLength(1);
    expect(timers[0]?.delayMs).toBe(5 * 60_000);
    expect(lines[0]).toMatch(/^\[poll\] OK /);
    timers[0]?.fn();
    await flush();
    expect(started()).toBe(2);
    expect(timers).toHaveLength(2);
  });
  it("lỗi không phải GitHubFailure: in FAIL internal và vẫn hẹn tiếp", async () => {
    const { sched, timers, lines } = setup([async () => {
      throw new Error("boom");
    }]);
    sched.start();
    await flush();
    expect(lines).toEqual(["[poll] FAIL internal"]);
    expect(timers).toHaveLength(1);
  });
  it("stop huỷ hẹn giờ và không hẹn thêm, kể cả khi chu kỳ đang chạy", async () => {
    const { sched, timers } = setup([async () => ok]);
    sched.start();
    await flush();
    sched.stop();
    expect(timers[0]?.cancelled).toBe(true);
    const running = setup([() => new Promise((r) => setTimeout(() => r(ok), 5))]);
    running.sched.start();
    running.sched.stop();
    await new Promise((r) => setTimeout(r, 20));
    expect(running.timers).toHaveLength(0);
  });
  it("log ném lỗi không làm dừng vòng lặp hay gây unhandled rejection", async () => {
    const timers: Array<() => void> = [];
    const sched = new PollScheduler({
      pollIntervalMin: 1,
      log: () => {
        throw new Error("log hỏng");
      },
      runCycle: async () => ok,
      schedule: (fn) => {
        timers.push(fn);
        return () => {};
      },
    });
    sched.start();
    await flush();
    expect(timers).toHaveLength(1);
  });
});
