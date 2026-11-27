import { z } from "zod";
import {
  GitHubFailure,
  type GitHubCommentSnapshot,
  type GitHubGateway,
  type GitHubIssueSnapshot,
  type IssueDetails,
  type ProjectIssueStamp,
  type ProjectRef,
  type ProjectScan,
  type ScanOptions,
} from "../../../../shared/ports/github-gateway.port.ts";
import { DEFAULT_GH_CLI_CONFIG, runGhCli, type GhCliConfig } from "./gh-cli-runner.ts";

// Adapter `GitHubGateway` qua `gh api graphql` (ADR-0010). Hai pha: quét board (chỉ nodeId + Issue.updatedAt + state
// + Status), rồi chi tiết theo lô. Owner, số project, cursor, id, tên field luôn là biến GraphQL, không ghép vào query.

/** Số id mỗi lần gọi `nodes(ids:)` (số đo máy thật: lô 25 ≈ 0,5 s). */
export const DETAIL_BATCH = 25;
const PAGE_SIZE = 100;

const COMMENT_FIELDS = "id author { login } body createdAt updatedAt";

function scanQuery(ownerField: "organization" | "user"): string {
  return `query ScanProject($owner: String!, $number: Int!, $cursor: String, $statusField: String!, $withStatus: Boolean!) {
  ${ownerField}(login: $owner) {
    projectV2(number: $number) {
      field(name: $statusField) @include(if: $withStatus) { __typename }
      items(first: ${PAGE_SIZE}, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          content { __typename ... on Issue { id updatedAt state } }
          fieldValueByName(name: $statusField) @include(if: $withStatus) {
            __typename
            ... on ProjectV2ItemFieldSingleSelectValue { name optionId }
          }
        }
      }
    }
  }
}`;
}

const DETAILS_QUERY = `query IssueDetails($ids: [ID!]!) {
  nodes(ids: $ids) {
    __typename
    ... on Issue {
      id number url title body updatedAt
      repository { nameWithOwner }
      assignees(first: 20) { nodes { login } }
      comments(first: ${PAGE_SIZE}) { pageInfo { hasNextPage endCursor } totalCount nodes { ${COMMENT_FIELDS} } }
    }
  }
}`;

const COMMENTS_QUERY = `query IssueComments($id: ID!, $cursor: String) {
  node(id: $id) {
    ... on Issue { comments(first: ${PAGE_SIZE}, after: $cursor) { pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} } } }
  }
}`;

const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const iso = z.string().min(1);

const scanItem = z.object({
  content: z.object({ __typename: z.string() }).loose().nullable(),
  fieldValueByName: z.object({ __typename: z.string() }).loose().nullable().optional(),
});
const scanProjectSchema = z.object({
  field: z.object({ __typename: z.string() }).nullable().optional(),
  items: z.object({ pageInfo, nodes: z.array(scanItem) }),
});
const issueContent = z.object({ id: z.string().min(1), updatedAt: iso, state: z.enum(["OPEN", "CLOSED"]) });
const singleSelect = z.object({ name: z.string(), optionId: z.string() });

const commentNode = z.object({
  id: z.string().min(1),
  author: z.object({ login: z.string() }).nullable(),
  body: z.string(),
  createdAt: iso,
  updatedAt: iso,
});
const issueNode = z.object({
  id: z.string().min(1),
  number: z.number().int(),
  url: z.string(),
  title: z.string(),
  body: z.string(),
  updatedAt: iso,
  repository: z.object({ nameWithOwner: z.string() }),
  assignees: z.object({ nodes: z.array(z.object({ login: z.string() })) }),
  comments: z.object({ pageInfo, nodes: z.array(commentNode) }),
});
const detailsData = z.object({ nodes: z.array(z.record(z.string(), z.unknown()).nullable()) });
const commentsData = z.object({ node: z.object({ comments: z.object({ pageInfo, nodes: z.array(commentNode) }) }).nullable() });

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw new GitHubFailure("bad_output", "shape");
  return r.data;
}

export interface DetailStats {
  /** Số lần gọi `nodes(ids:)` trong lần `fetchIssueDetails` này. */
  readonly detailCalls: number;
  /** Số lần gọi thêm để phân trang comment trong lần này. */
  readonly commentPages: number;
}

export class GhCliGateway implements GitHubGateway {
  private readonly config: GhCliConfig;

  constructor(
    config: Partial<GhCliConfig> = {},
    private readonly detailBatch: number = DETAIL_BATCH,
  ) {
    this.config = { ...DEFAULT_GH_CLI_CONFIG, ...config };
  }

  async scanProject(project: ProjectRef, options: ScanOptions): Promise<ProjectScan> {
    const ownerField = project.ownerType === "org" ? "organization" : "user";
    const query = scanQuery(ownerField);
    const withStatus = options.statusField !== null;
    const issues: ProjectIssueStamp[] = [];
    const seen = new Set<string>();
    const skipped = { pullRequest: 0, draftIssue: 0, inaccessible: 0 };
    let statusField: ProjectScan["statusField"] = "not_requested";
    let cursor: string | null = null;
    let pages = 0;

    for (;;) {
      const { data, failureHint } = await runGhCli(this.config, {
        operationName: "ScanProject",
        query,
        variables: { owner: project.owner, number: project.number, cursor, statusField: options.statusField ?? "", withStatus },
      });
      const owner = parse(z.object({ [ownerField]: z.unknown() }), data)[ownerField];
      if (owner === null) throw new GitHubFailure(failureHint ?? "project_not_found");
      const projectData = parse(z.object({ projectV2: z.unknown() }), owner).projectV2;
      if (projectData === null) throw new GitHubFailure(failureHint ?? "project_not_found");
      const p = parse(scanProjectSchema, projectData);
      pages++;

      if (pages === 1 && withStatus) {
        if (p.field === undefined) throw new GitHubFailure("bad_output", "shape");
        statusField = p.field === null ? "missing" : p.field.__typename === "ProjectV2SingleSelectField" ? "found" : "not_single_select";
      }
      for (const item of p.items.nodes) {
        const type = item.content?.__typename;
        if (item.content === null) skipped.inaccessible++;
        else if (type === "PullRequest") skipped.pullRequest++;
        else if (type === "DraftIssue") skipped.draftIssue++;
        else if (type !== "Issue") skipped.inaccessible++;
        else {
          const c = parse(issueContent, item.content);
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          const sel = statusField === "found" && item.fieldValueByName?.__typename === "ProjectV2ItemFieldSingleSelectValue" ? singleSelect.safeParse(item.fieldValueByName) : undefined;
          issues.push({ nodeId: c.id, updatedAt: c.updatedAt, state: c.state, status: sel?.success ? { name: sel.data.name, optionId: sel.data.optionId } : null });
        }
      }
      if (!p.items.pageInfo.hasNextPage) break;
      if (p.items.pageInfo.endCursor === null || p.items.pageInfo.endCursor === cursor) throw new GitHubFailure("bad_output", "cursor");
      cursor = p.items.pageInfo.endCursor;
    }
    return { issues, skipped, statusField, pages };
  }

  async fetchIssueDetails(nodeIds: readonly string[]): Promise<IssueDetails> {
    return (await this.fetchIssueDetailsWithStats(nodeIds)).details;
  }

  /** Như `fetchIssueDetails` kèm số đếm của riêng lần gọi này (gọi song song không đếm lẫn nhau). */
  async fetchIssueDetailsWithStats(nodeIds: readonly string[]): Promise<{ details: IssueDetails; stats: DetailStats }> {
    const stats = { detailCalls: 0, commentPages: 0 };
    const ids = [...new Set(nodeIds)];
    const found = new Map<string, GitHubIssueSnapshot>();
    const missing: string[] = [];
    for (let i = 0; i < ids.length; i += this.detailBatch) {
      const batch = ids.slice(i, i + this.detailBatch);
      const { data } = await runGhCli(this.config, { operationName: "IssueDetails", query: DETAILS_QUERY, variables: { ids: batch } });
      stats.detailCalls++;
      const { nodes } = parse(detailsData, data);
      if (nodes.length !== batch.length) throw new GitHubFailure("bad_output", "shape");
      for (const [index, raw] of nodes.entries()) {
        const id = batch[index]!;
        if (raw === null || raw["id"] === undefined) {
          missing.push(id); // null (đã xoá / không có quyền) hoặc node không phải Issue
          continue;
        }
        const n = parse(issueNode, raw);
        const comments = n.comments.nodes.map(toComment);
        let next = n.comments.pageInfo;
        while (next.hasNextPage) {
          if (next.endCursor === null) throw new GitHubFailure("bad_output", "cursor");
          const more = await this.commentPage(n.id, next.endCursor, stats);
          comments.push(...more.nodes.map(toComment));
          next = more.pageInfo;
        }
        found.set(n.id, {
          nodeId: n.id,
          repo: n.repository.nameWithOwner,
          number: n.number,
          url: n.url,
          title: n.title,
          body: n.body,
          assignees: n.assignees.nodes.map((a) => a.login),
          updatedAt: n.updatedAt,
          comments: dedupeSorted(comments),
        });
      }
    }
    return { details: { issues: ids.filter((id) => found.has(id)).map((id) => found.get(id)!), missing }, stats };
  }

  private async commentPage(id: string, cursor: string, stats: { commentPages: number }) {
    const { data } = await runGhCli(this.config, { operationName: "IssueComments", query: COMMENTS_QUERY, variables: { id, cursor } });
    stats.commentPages++;
    const node = parse(commentsData, data).node;
    if (node === null) throw new GitHubFailure("bad_output", "shape");
    return node.comments;
  }
}

function toComment(c: z.infer<typeof commentNode>): GitHubCommentSnapshot {
  return { nodeId: c.id, author: c.author?.login ?? null, body: c.body, createdAt: c.createdAt, updatedAt: c.updatedAt };
}

function dedupeSorted(list: GitHubCommentSnapshot[]): GitHubCommentSnapshot[] {
  const seen = new Set<string>();
  const unique = list.filter((c) => (seen.has(c.nodeId) ? false : (seen.add(c.nodeId), true)));
  return unique.map((c, i) => ({ c, i })).sort((a, b) => a.c.createdAt.localeCompare(b.c.createdAt) || a.i - b.i).map((x) => x.c);
}
