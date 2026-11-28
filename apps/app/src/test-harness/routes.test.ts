import { describe, expect, it } from "vitest";
import { buildDeps } from "../composition-root.ts";
import { createApp } from "../server/app.ts";

const snap = (nodeId: string, updatedAt: string) => ({ nodeId, repo: "o/r", number: 1, url: "u", title: "t", body: "b", assignees: [], updatedAt });

describe("AC-28 POST /__test__/poll", () => {
  it("BASELINE, rồi new=1, reset lại BASELINE; không chu kỳ nào tự chạy", async () => {
    const app = createApp(buildDeps("fake"));
    const post = async (path: string, body?: unknown) =>
      app.request(`/__test__${path}`, { method: "POST", ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}) });
    await post("/github/issues", [snap("A", "2026-11-20T10:00:00Z")]);
    const first = await (await post("/poll")).json();
    expect(first).toMatchObject({ status: "BASELINE", stats: { issues: 1 } });
    await post("/github/issues", [snap("A", "2026-11-20T10:00:00Z"), snap("B", "2026-11-20T10:30:00Z")]);
    expect(await (await post("/poll")).json()).toMatchObject({ status: "OK", stats: { newIssues: 1 } });
    await post("/reset");
    await post("/github/issues", [snap("A", "2026-11-20T10:00:00Z")]);
    expect(await (await post("/poll")).json()).toMatchObject({ status: "BASELINE" });
  });
});
