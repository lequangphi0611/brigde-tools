import { GitHubFailure, type GitHubGateway, type GitHubIssueSnapshot, type IssueDetails, type ProjectRef } from "../../shared/ports/github-gateway.port.ts";
import { countJapaneseChars } from "../translate-issue/issue-input.ts";

export const USAGE = `Cách dùng:
  pnpm -s github-check --owner <org|user> --number <n> [--owner-type user] [--status-field <tên>] [--days <1-30>] [--max-details <1-200>] [--raw]

  Cần đặt GH_HOST (máy GHES). Chỉ đọc: không ghi DB, không gọi Claude. Dòng cuối chỉ có mã và số đếm.
  --raw  in thêm stderr gốc của gh ra stderr (có thể chứa hostname/owner; tự đọc, không gõ lại)
`;

export interface Sink {
  write(chunk: string): void;
}

/** Gateway dùng cho github-check: lấy chi tiết kèm số đếm của chính lần gọi đó. */
export interface CheckGateway extends GitHubGateway {
  fetchIssueDetailsWithStats(nodeIds: readonly string[]): Promise<{ details: IssueDetails; stats: { detailCalls: number; commentPages: number } }>;
}

export interface RunGithubCheckOptions {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
  stdout: Sink;
  stderr: Sink;
  createGateway: (opts: { onStderr?: (text: string) => void }) => CheckGateway;
  now?: () => Date;
}

interface Args {
  project: ProjectRef;
  statusField: string;
  days: number;
  maxDetails: number;
  raw: boolean;
}

function intIn(v: string | undefined, min: number, max: number): number | undefined {
  if (v === undefined || !/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  return n >= min && n <= max ? n : undefined;
}

function parseArgv(argv: readonly string[]): Args | undefined {
  const args = argv.filter((a) => a !== "--");
  let owner: string | undefined;
  let number: number | undefined;
  let ownerType: "org" | "user" = "org";
  let statusField = "Status";
  let days = 7;
  let maxDetails = 50;
  let raw = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--raw") {
      raw = true;
      continue;
    }
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) return undefined;
    i++;
    if (a === "--owner") owner = v;
    else if (a === "--number") {
      number = intIn(v, 1, Number.MAX_SAFE_INTEGER);
      if (number === undefined) return undefined;
    } else if (a === "--owner-type") {
      if (v !== "user" && v !== "org") return undefined;
      ownerType = v;
    } else if (a === "--status-field") {
      if (v === "") return undefined;
      statusField = v;
    } else if (a === "--days") {
      const d = intIn(v, 1, 30);
      if (d === undefined) return undefined;
      days = d;
    } else if (a === "--max-details") {
      const m = intIn(v, 1, 200);
      if (m === undefined) return undefined;
      maxDetails = m;
    } else return undefined;
  }
  if (owner === undefined || owner === "" || number === undefined) return undefined;
  return { project: { owner, ownerType, number }, statusField, days, maxDetails, raw };
}

export interface CheckFields {
  items: number;
  issues: number;
  skipped: { pullRequest: number; draftIssue: number; inaccessible: number };
  closed: number;
  statusField: string;
  statusSet: number;
  statusOptions: number;
  pages: number;
  scanMs: number;
  recent: number;
  details: number;
  missing: number;
  detailCalls: number;
  comments: number;
  maxComments: number;
  commentPages: number;
  jaChars: number;
  newerComment: number;
  editedComment: number;
  detailMs: number;
}

/** Dòng trạng thái: chỉ mã và số đếm. `host` luôn là tên biến, không bao giờ là giá trị. */
export function formatStatusLine(f: CheckFields): string {
  const s = f.skipped;
  return [
    "github-check OK host=GH_HOST",
    `items=${f.items}`,
    `issues=${f.issues}`,
    `skipped=pr:${s.pullRequest},draft:${s.draftIssue},noaccess:${s.inaccessible}`,
    `closed=${f.closed}`,
    `statusField=${f.statusField}`,
    `statusSet=${f.statusSet}`,
    `statusOptions=${f.statusOptions}`,
    `pages=${f.pages}`,
    `scanMs=${f.scanMs}`,
    `recent=${f.recent}`,
    `details=${f.details}`,
    `missing=${f.missing}`,
    `detailCalls=${f.detailCalls}`,
    `comments=${f.comments}`,
    `maxComments=${f.maxComments}`,
    `commentPages=${f.commentPages}`,
    `jaChars=${f.jaChars}`,
    `newerComment=${f.newerComment}`,
    `editedComment=${f.editedComment}`,
    `detailMs=${f.detailMs}`,
  ].join(" ");
}

/** Số đo trên các snapshot (hàm thuần). */
export function measureDetails(issues: readonly GitHubIssueSnapshot[]) {
  let comments = 0;
  let maxComments = 0;
  let jaChars = 0;
  let newerComment = 0;
  let editedComment = 0;
  for (const i of issues) {
    comments += i.comments.length;
    maxComments = Math.max(maxComments, i.comments.length);
    jaChars += countJapaneseChars(i.title) + countJapaneseChars(i.body);
    for (const c of i.comments) jaChars += countJapaneseChars(c.body);
    const t = Date.parse(i.updatedAt);
    if (i.comments.some((c) => Date.parse(c.createdAt) > t)) newerComment++;
    if (i.comments.some((c) => Date.parse(c.updatedAt) > t)) editedComment++;
  }
  return { comments, maxComments, jaChars, newerComment, editedComment };
}

/** Điều phối `github-check` (005a). Trả exit code; không đụng `process`. Mã lỗi là tên cố định, không bao giờ là dữ liệu. */
export async function runGithubCheck(options: RunGithubCheckOptions): Promise<number> {
  const { stdout, stderr } = options;
  const fail = (exit: number, code: string): number => {
    stdout.write(`github-check FAIL ${code}\n`);
    return exit;
  };
  const args = parseArgv(options.argv);
  if (!args) {
    stderr.write(USAGE);
    return fail(2, "usage");
  }
  if (!options.env["GH_HOST"]) return fail(2, "gh_host_unset");

  const gateway = options.createGateway(args.raw ? { onStderr: (t) => void stderr.write(t.endsWith("\n") ? t : t + "\n") } : {});
  const now = (options.now ?? (() => new Date()))();
  try {
    const t0 = performance.now();
    const scan = await gateway.scanProject(args.project, { statusField: args.statusField });
    const scanMs = Math.round(performance.now() - t0);

    const since = now.getTime() - args.days * 86_400_000;
    const recent = scan.issues.filter((i) => Date.parse(i.updatedAt) >= since).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const chosen = recent.slice(0, args.maxDetails).map((i) => i.nodeId);

    const t1 = performance.now();
    const { details, stats } = await gateway.fetchIssueDetailsWithStats(chosen);
    const detailMs = Math.round(performance.now() - t1);

    const m = measureDetails(details.issues);
    const fields: CheckFields = {
      items: scan.issues.length + scan.skipped.pullRequest + scan.skipped.draftIssue + scan.skipped.inaccessible,
      issues: scan.issues.length,
      skipped: scan.skipped,
      closed: scan.issues.filter((i) => i.state === "CLOSED").length,
      statusField: scan.statusField,
      statusSet: scan.issues.filter((i) => i.status !== null).length,
      statusOptions: new Set(scan.issues.flatMap((i) => (i.status ? [i.status.optionId] : []))).size,
      pages: scan.pages,
      scanMs,
      recent: recent.length,
      details: details.issues.length,
      missing: details.missing.length,
      detailCalls: stats.detailCalls,
      commentPages: stats.commentPages,
      detailMs,
      ...m,
    };
    stdout.write(formatStatusLine(fields) + "\n");
    return 0;
  } catch (e) {
    return fail(1, e instanceof GitHubFailure ? `github:${e.reason}` : "internal");
  }
}

/** Như `runGithubCheck` nhưng lỗi bất ngờ ngoài tầm (vd. lỗi ghi stdout) vẫn ra mã `internal`. */
export async function runGithubCheckSafely(options: RunGithubCheckOptions): Promise<number> {
  try {
    return await runGithubCheck(options);
  } catch {
    options.stdout.write("github-check FAIL internal\n");
    return 1;
  }
}
