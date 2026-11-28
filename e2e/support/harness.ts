import { test as base, type APIRequestContext } from "@playwright/test";

/** Client cho test-harness API. Spec dùng `harness` thay vì gọi /__test__ trực tiếp. */
export class Harness {
  constructor(private readonly api: APIRequestContext) {}
  async reset() {
    await this.api.post("/__test__/reset");
  }
  async seedIssues(issues: unknown[]) {
    await this.api.post("/__test__/github/issues", { data: issues });
  }
  async setClock(nowIso: string) {
    await this.api.post("/__test__/clock", { data: { now: nowIso } });
  }
  /** Chạy một chu kỳ poll (005b); trả `PollReport`. Chu kỳ đầu sau reset là BASELINE. */
  async runPoll(): Promise<{ status: string; stats?: Record<string, unknown>; cause?: unknown }> {
    return (await this.api.post("/__test__/poll")).json();
  }
  async toasts(): Promise<Array<{ title: string; body: string; openUrl: string }>> {
    return (await this.api.get("/__test__/toasts")).json();
  }
}

export const test = base.extend<{ harness: Harness }>({
  harness: async ({ request }, use) => {
    const h = new Harness(request);
    await h.reset();
    await use(h);
  },
});
export { expect } from "@playwright/test";
