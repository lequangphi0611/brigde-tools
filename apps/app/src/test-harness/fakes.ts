import type { Clock } from "../shared/ports/clock.port.ts";
import type {
  GitHubGateway,
  GitHubIssueSnapshot,
  IssueDetails,
  ProjectIssueStamp,
  ProjectRef,
  ProjectScan,
  ScanOptions,
} from "../shared/ports/github-gateway.port.ts";
import type { GitHubFixture } from "./github-fixture.ts";
import type { Notifier, Toast } from "../shared/ports/notifier.port.ts";

/** Số item mỗi trang quét, khớp `items(first: 100)` của adapter thật. */
export const SCAN_PAGE_SIZE = 100;

export class FakeGitHub implements GitHubGateway {
  fixture: GitHubFixture = emptyFixture();

  load(fixture: GitHubFixture): void {
    this.fixture = fixture;
  }

  /** Harness e2e: nạp issue (comment tuỳ chọn, mặc định []) thành board chỉ có Issue OPEN, không Status. */
  seedIssues(issues: ReadonlyArray<Omit<GitHubIssueSnapshot, "comments"> & { comments?: GitHubIssueSnapshot["comments"] }>): void {
    this.fixture = { ...emptyFixture(), items: issues.map((i) => ({ kind: "issue" as const, issue: { ...i, comments: i.comments ?? [] } })) };
  }

  reset(): void {
    this.fixture = emptyFixture();
  }

  async scanProject(_project: ProjectRef, options: ScanOptions): Promise<ProjectScan> {
    const { items, statusField } = this.fixture;
    let mode: ProjectScan["statusField"] = "not_requested";
    if (options.statusField !== null) {
      if (!statusField || statusField.name !== options.statusField) mode = "missing";
      else mode = statusField.kind === "single_select" ? "found" : "not_single_select";
    }
    const skipped = { pullRequest: 0, draftIssue: 0, inaccessible: 0 };
    const seen = new Set<string>();
    const issues: ProjectIssueStamp[] = [];
    for (const item of items) {
      if (item.kind === "pullRequest") skipped.pullRequest++;
      else if (item.kind === "draftIssue") skipped.draftIssue++;
      else if (item.kind === "inaccessible") skipped.inaccessible++;
      else if (!seen.has(item.issue.nodeId)) {
        seen.add(item.issue.nodeId);
        const option = mode === "found" && item.status !== undefined ? statusField?.options.find((o) => o.name === item.status) : undefined;
        issues.push({
          nodeId: item.issue.nodeId,
          updatedAt: item.issue.updatedAt,
          state: item.state ?? "OPEN",
          status: option ? { name: option.name, optionId: option.optionId } : null,
        });
      }
    }
    return { issues, skipped, statusField: mode, pages: Math.max(1, Math.ceil(items.length / SCAN_PAGE_SIZE)) };
  }

  async fetchIssueDetails(nodeIds: readonly string[]): Promise<IssueDetails> {
    const known = new Map<string, GitHubIssueSnapshot>();
    for (const i of this.fixture.extraIssues ?? []) known.set(i.nodeId, i);
    for (const item of this.fixture.items) if (item.kind === "issue") known.set(item.issue.nodeId, item.issue);
    const issues: GitHubIssueSnapshot[] = [];
    const missing: string[] = [];
    for (const id of new Set(nodeIds)) {
      const found = known.get(id);
      if (!found) missing.push(id);
      else issues.push({ ...found, comments: [...found.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
    }
    return { issues, missing };
  }
}

function emptyFixture(): GitHubFixture {
  return { project: { owner: "fake", ownerType: "org", number: 1 }, statusField: null, items: [] };
}

export class RecordingNotifier implements Notifier {
  readonly sent: Toast[] = [];
  async notify(toast: Toast) {
    this.sent.push(toast);
  }
}

export class ControllableClock implements Clock {
  static readonly INITIAL = "2026-01-01T00:00:00Z";
  private current = new Date(ControllableClock.INITIAL);
  now() {
    return new Date(this.current);
  }
  set(iso: string) {
    this.current = new Date(iso);
  }
  reset() {
    this.current = new Date(ControllableClock.INITIAL);
  }
}
