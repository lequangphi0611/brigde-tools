import type { Database } from "../../../shared/infrastructure/sqlite/open-database.ts";
import type { TrackingRepository } from "../application/tracking-repository.port.ts";
import type { Content, ContentKind } from "../domain/content.ts";
import type { StoredIssue, TrackedProject } from "../domain/issue.ts";

interface ProjectRow {
  id: string;
  owner: string;
  owner_type: "org" | "user";
  number: number;
  baselined_at: string | null;
  last_polled_at: string | null;
}

interface IssueRow {
  id: string;
  project_id: string;
  gh_updated_at: string;
  closed: number;
  contents_loaded: number;
  repo: string | null;
  number: number | null;
  url: string | null;
  assignees: string | null;
}

interface ContentRow {
  id: string;
  issue_id: string;
  kind: ContentKind;
  gh_id: string | null;
  author: string | null;
  text: string;
  hash: string;
  gh_created_at: string | null;
  gh_updated_at: string;
}

const toProject = (r: ProjectRow): TrackedProject => ({
  id: r.id,
  owner: r.owner,
  ownerType: r.owner_type,
  number: r.number,
  baselinedAt: r.baselined_at,
  lastPolledAt: r.last_polled_at,
});

const toIssue = (r: IssueRow): StoredIssue => ({
  id: r.id,
  projectId: r.project_id,
  ghUpdatedAt: r.gh_updated_at,
  closed: r.closed === 1,
  contentsLoaded: r.contents_loaded === 1,
  repo: r.repo,
  number: r.number,
  url: r.url,
  assignees: r.assignees === null ? null : (JSON.parse(r.assignees) as string[]),
});

/** `TrackingRepository` trên SQLite (bảng `tracked_project`, `issue`, `content`; migration 0003). Thời gian ghi do caller (từ `Clock`) đưa vào. */
export class SqliteTrackingRepository implements TrackingRepository {
  constructor(private readonly db: Database) {}

  ensureProject(ref: { id: string; owner: string; ownerType: "org" | "user"; number: number }): TrackedProject {
    this.db.raw
      .prepare("INSERT INTO tracked_project (id, owner, owner_type, number) VALUES (?, ?, ?, ?) ON CONFLICT (id) DO NOTHING")
      .run(ref.id, ref.owner, ref.ownerType, ref.number);
    const project = this.getProject(ref.id);
    if (!project) throw new Error("tracked_project không tồn tại sau khi chèn");
    return project;
  }

  getProject(id: string): TrackedProject | undefined {
    const row = this.db.raw.prepare("SELECT * FROM tracked_project WHERE id = ?").get(id) as ProjectRow | undefined;
    return row && toProject(row);
  }

  markBaselined(projectId: string, at: string): void {
    this.db.raw.prepare("UPDATE tracked_project SET baselined_at = ? WHERE id = ?").run(at, projectId);
  }

  markPolled(projectId: string, at: string): void {
    this.db.raw.prepare("UPDATE tracked_project SET last_polled_at = ? WHERE id = ?").run(at, projectId);
  }

  listIssues(projectId: string): StoredIssue[] {
    const rows = this.db.raw.prepare("SELECT * FROM issue WHERE project_id = ? ORDER BY id").all(projectId) as unknown as IssueRow[];
    return rows.map(toIssue);
  }

  getIssue(id: string): StoredIssue | undefined {
    const row = this.db.raw.prepare("SELECT * FROM issue WHERE id = ?").get(id) as IssueRow | undefined;
    return row && toIssue(row);
  }

  saveIssue(issue: StoredIssue): void {
    this.db.raw
      .prepare(
        `INSERT INTO issue (id, project_id, gh_updated_at, closed, contents_loaded, repo, number, url, assignees)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET project_id = excluded.project_id, gh_updated_at = excluded.gh_updated_at,
           closed = excluded.closed, contents_loaded = excluded.contents_loaded, repo = excluded.repo,
           number = excluded.number, url = excluded.url, assignees = excluded.assignees`,
      )
      .run(
        issue.id,
        issue.projectId,
        issue.ghUpdatedAt,
        issue.closed ? 1 : 0,
        issue.contentsLoaded ? 1 : 0,
        issue.repo,
        issue.number,
        issue.url,
        issue.assignees === null ? null : JSON.stringify(issue.assignees),
      );
  }

  listContents(issueId: string): Array<Content & { issueId: string }> {
    const rows = this.db.raw.prepare("SELECT * FROM content WHERE issue_id = ? ORDER BY rowid").all(issueId) as unknown as ContentRow[];
    return rows.map((r) => ({
      id: r.id,
      issueId: r.issue_id,
      kind: r.kind,
      ghId: r.gh_id,
      author: r.author,
      text: r.text,
      hash: r.hash,
      ghCreatedAt: r.gh_created_at,
      ghUpdatedAt: r.gh_updated_at,
    }));
  }

  upsertContents(issueId: string, contents: readonly Content[]): void {
    const stmt = this.db.raw.prepare(
      `INSERT INTO content (id, issue_id, kind, gh_id, author, text, hash, gh_created_at, gh_updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET issue_id = excluded.issue_id, kind = excluded.kind, gh_id = excluded.gh_id,
         author = excluded.author, text = excluded.text, hash = excluded.hash,
         gh_created_at = excluded.gh_created_at, gh_updated_at = excluded.gh_updated_at`,
    );
    for (const c of contents) stmt.run(c.id, issueId, c.kind, c.ghId, c.author, c.text, c.hash, c.ghCreatedAt, c.ghUpdatedAt);
  }

  lastSeen(projectId: string): string | null {
    const rows = this.db.raw.prepare("SELECT gh_updated_at FROM issue WHERE project_id = ?").all(projectId) as Array<{ gh_updated_at: string }>;
    let best: string | null = null;
    for (const { gh_updated_at } of rows) {
      if (best === null || Date.parse(gh_updated_at) > Date.parse(best)) best = gh_updated_at;
    }
    return best;
  }
}
