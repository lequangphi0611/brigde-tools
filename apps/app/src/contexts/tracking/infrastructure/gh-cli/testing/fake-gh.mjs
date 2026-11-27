#!/usr/bin/env node
// Thay lệnh `gh` trong test (không bao giờ gọi GitHub). Chỉ hiểu `api graphql --input -`.
// Cấu hình bằng biến môi trường (adapter thật kế thừa process.env nên đi xuống được):
//   FAKE_GH_FIXTURE  đường dẫn file JSON kiểu GitHubFixture (test-harness/github-fixture.ts)
//   FAKE_GH_MODE     ok (mặc định) · partial (như ok; id không có trong fixture luôn trả null + errors + exit 1)
//                    · auth · scope · scope-partial (data null + errors INSUFFICIENT_SCOPES, exit 1) · project-null · not-resolved · unsupported · network · hang · hang-grandchild · fail
//                    · garbage · bad-shape · huge (FAKE_GH_HUGE_BYTES, mặc định 33 MiB)
//   FAKE_GH_RECORD   file JSONL: mỗi lần gọi một dòng { argv, stdin, operationName, env }
// Nhận diện query qua `operationName` trong body stdin: ScanProject · IssueDetails · IssueComments.
// Phân trang: items 100/trang, comment 100/trang; cursor là chuỗi "c<offset>".
import { appendFileSync, readFileSync } from "node:fs";

const PAGE = 100;
const argv = process.argv.slice(2);
const mode = process.env.FAKE_GH_MODE ?? "ok";

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (stdin += c));
process.stdin.on("end", () => main().catch((e) => fail(`fake-gh internal: ${e?.message}`, 99)));

function fail(stderr, code = 1, stdout = "") {
  if (stdout) process.stdout.write(stdout);
  process.stderr.write(stderr + "\n");
  process.exit(code);
}

async function main() {
  let body;
  try {
    body = JSON.parse(stdin);
  } catch {
    body = {};
  }
  const operationName = body.operationName;
  const record = process.env.FAKE_GH_RECORD;
  if (record) {
    const env = {};
    for (const k of ["GH_HOST", "GH_PROMPT_DISABLED", "GH_NO_UPDATE_NOTIFIER", "NO_COLOR"]) env[k] = process.env[k];
    appendFileSync(record, JSON.stringify({ argv, stdin, operationName, env }) + "\n");
  }

  if (argv.join(" ") !== "api graphql --input -") fail("fake-gh: unexpected arguments", 64);

  switch (mode) {
    case "auth":
      return fail("To get started with GitHub CLI, please run:  gh auth login", 4);
    case "scope":
      return fail("error: your authentication token is missing required scopes [read:project]\nINSUFFICIENT_SCOPES", 1);
    case "not-resolved":
      return fail("gh: Could not resolve to an Organization with the login of 'x'.", 1);
    case "unsupported":
      return fail("gh: Field 'projectV2' doesn't exist on type 'Organization'", 1);
    case "network":
      return fail("error connecting: dial tcp: lookup host: i/o timeout", 1);
    case "fail":
      return fail("something unexpected happened", 1);
    case "garbage":
      process.stdout.write("this is not json {{{");
      return;
    case "bad-shape":
      process.stdout.write(JSON.stringify({ data: { unexpected: 1 } }));
      return;
    case "huge": {
      const chunk = "x".repeat(1024 * 1024);
      const n = Number(process.env.FAKE_GH_HUGE_BYTES ?? 33 * 1024 * 1024) / chunk.length;
      for (let i = 0; i < n; i++) process.stdout.write(chunk);
      return;
    }
    case "hang-grandchild": {
      // Process con giữ pipe stdout/stderr (kế thừa) và sống lâu hơn gh: kill gh không làm 'close' phát ra.
      const { spawn } = await import("node:child_process");
      spawn(process.execPath, ["-e", "setTimeout(() => {}, 8000)"], { stdio: "inherit", detached: true }).unref();
      setInterval(() => {}, 1000);
      return;
    }
    case "hang":
      setInterval(() => {}, 1000);
      return;
  }

  const fixture = JSON.parse(readFileSync(process.env.FAKE_GH_FIXTURE, "utf8"));
  const v = body.variables ?? {};
  const query = String(body.query ?? "");
  if (operationName === "ScanProject") return scan(fixture, v, query);
  if (operationName === "IssueDetails") return details(fixture, v);
  if (operationName === "IssueComments") return comments(fixture, v);
  fail(`fake-gh: unknown operationName`, 65);
}

function out(data, errors) {
  process.stdout.write(JSON.stringify(errors ? { data, errors } : { data }));
  if (errors) {
    process.stderr.write("gh: Could not resolve to a node with the global id\n");
    process.exit(1);
  }
}

function allIssues(fixture) {
  const map = new Map();
  for (const i of fixture.extraIssues ?? []) map.set(i.nodeId, i);
  for (const it of fixture.items) if (it.kind === "issue") map.set(it.issue.nodeId, it.issue);
  return map;
}

function offset(cursor) {
  return cursor ? Number(String(cursor).slice(1)) : 0;
}

function page(list, cursor) {
  const start = offset(cursor);
  const nodes = list.slice(start, start + PAGE);
  const end = start + nodes.length;
  return { nodes, pageInfo: { hasNextPage: end < list.length, endCursor: end < list.length ? `c${end}` : null } };
}

function scan(fixture, v, query) {
  const ownerKey = /\buser\s*\(/.test(query) && !/\borganization\s*\(/.test(query) ? "user" : "organization";
  if (mode === "project-null") return out({ [ownerKey]: { projectV2: null } });
  if (mode === "scope-partial") {
    // GraphQL thật khi thiếu scope: data có projectV2 null kèm errors INSUFFICIENT_SCOPES, gh thoát mã 1.
    process.stdout.write(JSON.stringify({ data: { [ownerKey]: { projectV2: null } }, errors: [{ type: "INSUFFICIENT_SCOPES", message: "Your token has not been granted the required scopes to execute this query. The 'id' field requires one of the following scopes: ['read:project']" }] }));
    process.stderr.write("gh: Your token has not been granted the required scopes to execute this query.\n");
    process.exit(1);
  }
  const withStatus = v.withStatus === true && typeof v.statusField === "string";
  const sf = fixture.statusField;
  const { nodes, pageInfo } = page(fixture.items, v.cursor);
  const items = nodes.map((it) => {
    const base = { updatedAt: it.kind === "issue" ? (it.itemUpdatedAt ?? "2026-01-01T00:00:00Z") : "2026-01-01T00:00:00Z" };
    if (it.kind === "inaccessible") return { ...base, content: null };
    if (it.kind === "pullRequest") return { ...base, content: { __typename: "PullRequest" } };
    if (it.kind === "draftIssue") return { ...base, content: { __typename: "DraftIssue" } };
    const node = {
      ...base,
      content: { __typename: "Issue", id: it.issue.nodeId, updatedAt: it.issue.updatedAt, state: it.state ?? "OPEN" },
    };
    if (withStatus) {
      const matches = sf && sf.name === v.statusField;
      const opt = matches && sf.kind === "single_select" && it.status ? sf.options.find((o) => o.name === it.status) : undefined;
      node.fieldValueByName = opt
        ? { __typename: "ProjectV2ItemFieldSingleSelectValue", name: opt.name, optionId: opt.optionId }
        : matches && sf.kind === "text" && it.status
          ? { __typename: "ProjectV2ItemFieldTextValue" }
          : null;
    }
    return node;
  });
  const projectV2 = { items: { pageInfo, nodes: items } };
  if (withStatus && !v.cursor) {
    const matches = sf && sf.name === v.statusField;
    projectV2.field = matches ? { __typename: sf.kind === "single_select" ? "ProjectV2SingleSelectField" : "ProjectV2Field" } : null;
  }
  out({ [ownerKey]: { projectV2 } });
}

function issueNode(i) {
  const sorted = [...i.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const p = page(sorted.map(commentNode), null);
  return {
    id: i.nodeId,
    number: i.number,
    url: i.url,
    title: i.title,
    body: i.body,
    updatedAt: i.updatedAt,
    repository: { nameWithOwner: i.repo },
    assignees: { nodes: i.assignees.map((login) => ({ login })) },
    comments: { totalCount: sorted.length, pageInfo: p.pageInfo, nodes: p.nodes },
  };
}

function commentNode(c) {
  return { id: c.nodeId, author: c.author === null ? null : { login: c.author }, body: c.body, createdAt: c.createdAt, updatedAt: c.updatedAt };
}

function details(fixture, v) {
  const known = allIssues(fixture);
  const ids = Array.isArray(v.ids) ? v.ids : [];
  const nodes = ids.map((id) => (known.has(id) ? issueNode(known.get(id)) : null));
  const errors = ids.filter((id) => !known.has(id)).map((id) => ({ type: "NOT_FOUND", path: ["nodes", ids.indexOf(id)], message: `Could not resolve to a node with the global id of '${id}'` }));
  out({ nodes }, errors.length ? errors : undefined);
}

function comments(fixture, v) {
  const i = allIssues(fixture).get(v.id);
  if (!i) return out({ node: null }, [{ type: "NOT_FOUND", message: "Could not resolve to a node" }]);
  const sorted = [...i.comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const p = page(sorted.map(commentNode), v.cursor);
  out({ node: { comments: { pageInfo: p.pageInfo, nodes: p.nodes } } });
}
