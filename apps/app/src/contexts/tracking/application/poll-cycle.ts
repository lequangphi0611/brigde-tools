import type { DomainEvent } from "../../../shared/events/domain-event.ts";
import { sqliteErrorInfo } from "../../../shared/infrastructure/sqlite/storage-error.ts";
import type { Clock } from "../../../shared/ports/clock.port.ts";
import type { DomainEventPublisher } from "../../../shared/ports/domain-event-publisher.port.ts";
import {
  GitHubFailure,
  type GitHubGateway,
  type GitHubIssueSnapshot,
  type ProjectRef,
  type ProjectScan,
} from "../../../shared/ports/github-gateway.port.ts";
import type { UnitOfWork } from "../../../shared/ports/unit-of-work.port.ts";
import { scanStatusField, type CloseRule } from "../domain/close-rule.ts";
import { contentsOf, diffContents } from "../domain/diff-contents.ts";
import { trackedProjectId, type StoredIssue } from "../domain/issue.ts";
import { isAfter, laterTimestamp } from "../domain/timestamps.ts";
import { needsDetails, trackingDecision, type TrackingDecision } from "../domain/tracking-decision.ts";
import type { PollFailureCause, PollReport, PollStats, PollWarning } from "./poll-report.ts";
import type { TrackingRepository } from "./tracking-repository.port.ts";

/** Cấu hình một project (tham số thuần; 005c đọc từ config.json). */
export interface PollProjectConfig extends ProjectRef, CloseRule {}

export interface PollCycleDeps {
  readonly github: GitHubGateway;
  readonly repository: TrackingRepository;
  readonly unitOfWork: UnitOfWork;
  readonly publisher: DomainEventPublisher;
  readonly clock: Clock;
  readonly project: PollProjectConfig;
  /** Đồng hồ đo thời gian chạy (ms); mặc định `performance.now`. */
  readonly elapsedClock?: () => number;
}

/** Một chu kỳ poll của một project (ADR-0010, ADR-0011). Mọi `await` xong trước khi mở transaction đầu tiên. */
export class PollCycle {
  constructor(private readonly deps: PollCycleDeps) {}

  async run(): Promise<PollReport> {
    const timer = this.deps.elapsedClock ?? (() => performance.now());
    const started = timer();
    const ms = () => Math.round(timer() - started);
    try {
      return await this.runCycle(ms);
    } catch (e) {
      return { status: "FAIL", cause: failureCause(e), ms: ms() };
    }
  }

  private async runCycle(ms: () => number): Promise<PollReport> {
    const { github, repository, unitOfWork, publisher, clock, project } = this.deps;
    const projectId = trackedProjectId(project);
    const baselined = repository.getProject(projectId)?.baselinedAt != null;

    // Pha bất đồng bộ (không ghi gì): quét rồi lấy chi tiết.
    const scan = await github.scanProject(project, { statusField: scanStatusField(project) });
    const stored = new Map(repository.listIssues(projectId).map((i) => [i.id, i]));
    const planned = scan.issues
      .map((stamp) => ({ stamp, decision: trackingDecision({ stamp, stored: stored.get(stamp.nodeId), closeRule: project, baselined }) }))
      .sort((a, b) => Date.parse(a.stamp.updatedAt) - Date.parse(b.stamp.updatedAt) || a.stamp.nodeId.localeCompare(b.stamp.nodeId));
    const ids = planned.filter((p) => needsDetails(p.decision.kind)).map((p) => p.stamp.nodeId);
    const details = ids.length > 0 ? await github.fetchIssueDetails(ids) : { issues: [], missing: [] };
    const snapshots = new Map(details.issues.map((s) => [s.nodeId, s]));

    const counts = { newIssues: 0, newComments: 0, edited: 0, closedChanged: 0, failed: 0, missing: 0 };
    const baseStats = {
      issues: scan.issues.length,
      closed: planned.filter((p) => p.decision.closed).length,
      skipped: scan.skipped,
      pages: scan.pages,
      details: ids.length,
    };
    const warn = warning(scan, project);
    const now = () => clock.now().toISOString();

    // Pha ghi (đồng bộ).
    repository.ensureProject({ id: projectId, owner: project.owner, ownerType: project.ownerType, number: project.number });
    if (!baselined) {
      unitOfWork.run(() => {
        for (const { stamp, decision } of planned) {
          repository.saveIssue(markOnly(projectId, stamp.nodeId, stamp.updatedAt, decision.closed));
        }
        repository.markBaselined(projectId, now());
      });
      repository.markPolled(projectId, now());
      return { status: "BASELINE", stats: { ...baseStats, ...counts }, ...(warn ? { warn } : {}), ms: ms() };
    }

    for (const { stamp, decision } of planned) {
      const previous = stored.get(stamp.nodeId);
      const snapshot = snapshots.get(stamp.nodeId);
      if (needsDetails(decision.kind) && !snapshot) {
        counts.missing++;
        continue;
      }
      try {
        const result = unitOfWork.run(() => {
          const events: DomainEvent[] = [];
          const delta = { newIssues: 0, newComments: 0, edited: 0, closedChanged: 0 };
          apply({ repository, decision, projectId, stamp, previous, snapshot, events, delta, occurredAt: now() });
          if (events.length > 0) publisher.publish(events);
          return delta;
        });
        counts.newIssues += result.newIssues;
        counts.newComments += result.newComments;
        counts.edited += result.edited;
        counts.closedChanged += result.closedChanged;
      } catch {
        counts.failed++;
      }
    }
    repository.markPolled(projectId, now());
    return {
      status: counts.failed > 0 ? "PARTIAL" : "OK",
      stats: { ...baseStats, ...counts },
      ...(warn ? { warn } : {}),
      ms: ms(),
    };
  }
}

function markOnly(projectId: string, id: string, ghUpdatedAt: string, closed: boolean): StoredIssue {
  return { id, projectId, ghUpdatedAt, closed, contentsLoaded: false, repo: null, number: null, url: null, assignees: null };
}

function warning(scan: ProjectScan, rule: CloseRule): PollWarning | undefined {
  if (rule.closedStatuses.length === 0) return undefined;
  if (scan.statusField === "missing") return "status_field_missing";
  if (scan.statusField === "not_single_select") return "status_field_not_single_select";
  return undefined;
}

function failureCause(e: unknown): PollFailureCause {
  if (e instanceof GitHubFailure) return { type: "github", reason: e.reason };
  const { sqliteCode } = sqliteErrorInfo(e);
  if (sqliteCode !== undefined) return { type: "storage", sqliteCode };
  if (e instanceof Error && e.name === "StorageError") return { type: "storage" };
  return { type: "internal" };
}

interface ApplyInput {
  repository: TrackingRepository;
  decision: TrackingDecision;
  projectId: string;
  stamp: ProjectScan["issues"][number];
  previous: StoredIssue | undefined;
  snapshot: GitHubIssueSnapshot | undefined;
  events: DomainEvent[];
  delta: { newIssues: number; newComments: number; edited: number; closedChanged: number };
  occurredAt: string;
}

function detailed(projectId: string, s: GitHubIssueSnapshot, ghUpdatedAt: string): StoredIssue {
  return { id: s.nodeId, projectId, ghUpdatedAt, closed: false, contentsLoaded: true, repo: s.repo, number: s.number, url: s.url, assignees: [...s.assignees] };
}

/** Ghi trạng thái và gom event của một issue; chạy trong transaction của issue đó. */
function apply(i: ApplyInput): void {
  const { repository, decision, projectId, stamp, previous, snapshot, events, delta, occurredAt } = i;
  switch (decision.kind) {
    case "store_closed":
      repository.saveIssue(markOnly(projectId, stamp.nodeId, stamp.updatedAt, true));
      delta.closedChanged++;
      return;
    case "skip_closed": {
      if (!previous) return;
      const newer = isAfter(stamp.updatedAt, previous.ghUpdatedAt);
      if (newer || !previous.closed) {
        repository.saveIssue({ ...previous, ghUpdatedAt: laterTimestamp(previous.ghUpdatedAt, stamp.updatedAt), closed: true });
      }
      if (newer) delta.closedChanged++;
      return;
    }
    case "unchanged":
      if (previous?.closed) repository.saveIssue({ ...previous, closed: false });
      return;
    case "discover": {
      if (!snapshot) return;
      const contents = contentsOf(snapshot);
      repository.saveIssue(detailed(projectId, snapshot, laterTimestamp(stamp.updatedAt, snapshot.updatedAt)));
      repository.upsertContents(snapshot.nodeId, contents);
      events.push(
        { type: "IssueDiscovered", projectId, issueId: snapshot.nodeId, occurredAt },
        { type: "ContentChanged", projectId, issueId: snapshot.nodeId, contentIds: contents.map((c) => c.id), reason: "new_issue", occurredAt },
      );
      delta.newIssues++;
      return;
    }
    case "refresh": {
      if (!snapshot || !previous) return;
      const storedHashes = new Map(repository.listContents(snapshot.nodeId).map((c) => [c.id, c.hash]));
      const diff = diffContents({ snapshot, storedHashes, contentsLoaded: previous.contentsLoaded, previousUpdatedAt: previous.ghUpdatedAt });
      repository.saveIssue(detailed(projectId, snapshot, laterTimestamp(previous.ghUpdatedAt, laterTimestamp(stamp.updatedAt, snapshot.updatedAt))));
      repository.upsertContents(snapshot.nodeId, diff.upserts);
      if (diff.newComments.length > 0) {
        events.push({ type: "ContentChanged", projectId, issueId: snapshot.nodeId, contentIds: diff.newComments, reason: "new_comment", occurredAt });
        delta.newComments += diff.newComments.length;
      }
      if (diff.edited.length > 0) {
        events.push({ type: "ContentChanged", projectId, issueId: snapshot.nodeId, contentIds: diff.edited, reason: "edited", occurredAt });
        delta.edited += diff.edited.length;
      }
      return;
    }
    case "baseline":
      return;
  }
}
