import { describe, expect, it } from "vitest";
import { runGitHubGatewayContract } from "../shared/ports/testing/github-gateway.contract.ts";
import { FakeGitHub, SCAN_PAGE_SIZE } from "./fakes.ts";
import { issue } from "../shared/ports/testing/github-gateway.contract.ts";

runGitHubGatewayContract("FakeGitHub", {
  create: (fixture) => {
    const fake = new FakeGitHub();
    fake.load(fixture);
    return fake;
  },
});

describe("FakeGitHub (harness)", () => {
  it("seedIssues: comment mặc định [], board không có Status", async () => {
    const fake = new FakeGitHub();
    const { comments: _c, ...bare } = issue("I_x");
    fake.seedIssues([bare]);
    const details = await fake.fetchIssueDetails(["I_x"]);
    expect(details.issues[0]?.comments).toEqual([]);
    const scan = await fake.scanProject({ owner: "o", ownerType: "org", number: 1 }, { statusField: "Status" });
    expect(scan.issues.map((i) => i.nodeId)).toEqual(["I_x"]);
    expect(scan.statusField).toBe("missing");
  });

  it("pages theo cỡ trang 100", async () => {
    const fake = new FakeGitHub();
    fake.seedIssues(Array.from({ length: 250 }, (_, i) => issue(`I_${i}`)));
    const scan = await fake.scanProject({ owner: "o", ownerType: "org", number: 1 }, { statusField: null });
    expect(SCAN_PAGE_SIZE).toBe(100);
    expect(scan.issues).toHaveLength(250);
    expect(scan.pages).toBe(3);
  });

  it("reset xoá board", async () => {
    const fake = new FakeGitHub();
    fake.seedIssues([issue("I_x")]);
    fake.reset();
    expect((await fake.scanProject({ owner: "o", ownerType: "org", number: 1 }, { statusField: null })).issues).toEqual([]);
  });
});
