#!/usr/bin/env node
// `pnpm diagnose` / `node scripts/diagnose/index.mjs` — kiểm M0 trên máy Windows thật (GHES qua GH_HOST,
// Projects v2, claude -p, Task Scheduler, toast). Không cần `pnpm install`.
//
// Output chỉ gồm trạng thái, phiên bản, số đếm, thời gian và mã lỗi: KHÔNG in hostname, owner, user, đường dẫn,
// title hay nội dung issue → gõ lại / gửi đi được. `--raw` in thêm lỗi gốc để TỰ đọc trên máy, không gửi đi.
//
//   set GH_HOST=github.example.co.jp            (PowerShell: $env:GH_HOST = "github.example.co.jp")
//   node scripts/diagnose/index.mjs --owner <org> --number <n> [--owner-type user] [--scheduler] [--toast] [--raw]

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { release, tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  CLAUDE_SCHEMA, CLAUDE_SYSTEM_PROMPT, claudeFixedArgs, classifyClaudeFailure, classifyGhError, compareNodes,
  evaluateCounts, evaluateTranslation, hasProjectScope, isoDay, isoSecond, parseClaudeEnvelope, sampleStdin,
} from "./checks.mjs";

const SCRIPT = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(SCRIPT), "../..");
const WIN = process.platform === "win32";

const { values: opt } = parseArgs({
  options: {
    owner: { type: "string" },
    "owner-type": { type: "string", default: "org" },
    number: { type: "string" },
    config: { type: "string", default: join(REPO, "config/claude-cli.local.json") },
    claude: { type: "string" },
    model: { type: "string", default: "sonnet" },
    scheduler: { type: "boolean", default: false },
    toast: { type: "boolean", default: false },
    raw: { type: "boolean", default: false },
    "skip-claude": { type: "boolean", default: false },
    "only-claude": { type: "boolean", default: false }, // nội bộ: lượt chạy từ Task Scheduler
    out: { type: "string" },
  },
});

const lines = [];
let failures = 0;
function say(key, status, detail = "") {
  if (status === "FAIL") failures++;
  const l = `${key.padEnd(14)}${status.padEnd(6)}${detail}`.trimEnd();
  lines.push(l);
  console.log(l);
}
function raw(text) {
  if (opt.raw && text) console.log(`    [raw] ${String(text).trim().replace(/\n/g, "\n          ")}`);
}

function runSync(cmd, args, timeout = 60_000) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true, timeout, env: process.env });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", error: r.error };
}

function firstLine(s) {
  return s.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
}

// ---------- môi trường ----------
function checkEnv() {
  say("os", "INFO", `${process.platform} ${release()}`);
  say("node", "INFO", process.version);
  const gh = runSync("gh", ["--version"]);
  if (gh.error || gh.code !== 0) say("gh", "FAIL", "không chạy được gh (chưa cài hoặc không có trong PATH)");
  else say("gh", "OK", firstLine(gh.out).replace(/^gh version\s*/, ""));
  // pnpm trên Windows là .cmd → phải qua shell; chỉ chạy lệnh cố định, không có input người dùng.
  const pnpm = spawnSync("pnpm --version", { shell: true, encoding: "utf8", windowsHide: true, timeout: 30_000 });
  say("pnpm", pnpm.status === 0 ? "OK" : "WARN", pnpm.status === 0 ? firstLine(pnpm.stdout) : "chưa có (cần để chạy app, không cần cho diagnose)");
  if (pnpm.status === 0) {
    const reg = firstLine(spawnSync("pnpm config get registry", { shell: true, encoding: "utf8", windowsHide: true, timeout: 30_000 }).stdout ?? "");
    say("registry", "INFO", /registry\.npmjs\.org/.test(reg) ? "mặc định (npmjs)" : reg ? "registry riêng" : "?"); // không in URL
  }
  return !gh.error && gh.code === 0;
}

// ---------- GitHub (GHES qua GH_HOST) ----------
function gql(query, vars) {
  const args = ["api", "graphql", "-f", `query=${query.replace(/\s+/g, " ")}`];
  for (const [k, v] of Object.entries(vars)) args.push(typeof v === "number" ? "-F" : "-f", `${k}=${v}`);
  const r = runSync("gh", args);
  if (r.code === 0) {
    try {
      return { ok: true, data: JSON.parse(r.out).data };
    } catch {
      return { ok: false, cls: "BAD_JSON" };
    }
  }
  raw(r.err || r.out);
  return { ok: false, cls: classifyGhError(`${r.err}\n${r.out}`) };
}

function checkGitHub() {
  const host = process.env.GH_HOST;
  if (!host) {
    say("GH_HOST", "FAIL", "chưa đặt biến môi trường GH_HOST");
    return false;
  }
  say("GH_HOST", "OK", host === "github.com" ? "github.com" : "đã đặt (GHES)");

  const auth = runSync("gh", ["auth", "status", "--hostname", host]);
  const authText = `${auth.out}\n${auth.err}`;
  if (auth.code !== 0) {
    raw(authText);
    say("gh auth", "FAIL", `chạy: gh auth login --hostname <GH_HOST>`);
    return false;
  }
  say("gh auth", "OK");
  if (/Token scopes:/i.test(authText))
    say("scope", hasProjectScope(authText) ? "OK" : "WARN", hasProjectScope(authText) ? "read:project" : "thiếu read:project → gh auth refresh -s read:project --hostname <GH_HOST>");
  else say("scope", "INFO", "không đọc được scope (token kiểu khác)");

  const meta = runSync("gh", ["api", "meta"]);
  if (meta.code === 0) {
    let v;
    try {
      v = JSON.parse(meta.out).installed_version;
    } catch {}
    say("ghes", v ? "INFO" : "WARN", v ?? "không có installed_version (có thể là github.com)");
  } else {
    raw(meta.err);
    say("ghes", "FAIL", classifyGhError(meta.err));
  }

  const rl = runSync("gh", ["api", "rate_limit"]);
  if (rl.code === 0) {
    try {
      const g = JSON.parse(rl.out).resources?.graphql;
      say("rate limit", "INFO", g ? `graphql ${g.remaining}/${g.limit}` : "không có mục graphql");
    } catch {
      say("rate limit", "WARN", "BAD_JSON");
    }
  } else if (/not enabled/i.test(rl.err + rl.out)) say("rate limit", "INFO", "GHES tắt rate limit");
  else {
    raw(rl.err);
    say("rate limit", "WARN", classifyGhError(rl.err));
  }
  return true;
}

function checkProject() {
  if (!opt.owner || !opt.number) {
    say("project", "SKIP", "thêm --owner <org> --number <n> để kiểm Projects v2");
    return;
  }
  const field = opt["owner-type"] === "user" ? "user" : "organization";
  const vars = { login: opt.owner, n: Number(opt.number) };

  const base = gql(
    `query($login:String!,$n:Int!){ ${field}(login:$login){ projectV2(number:$n){ items(first:1){ totalCount } } } rateLimit{ cost remaining limit } }`,
    vars,
  );
  const baseCount = base.ok ? base.data?.[field]?.projectV2?.items?.totalCount : undefined;
  if (!base.ok || typeof baseCount !== "number") {
    say("projectsV2", "FAIL", base.ok ? "không đọc được project" : base.cls);
    return;
  }
  say("projectsV2", "OK", `${baseCount} item`);
  const rate = base.data.rateLimit;
  say("query cost", "INFO", rate ? `cost ${rate.cost}, còn ${rate.remaining}/${rate.limit}` : "rateLimit = null (GHES tắt rate limit?)");

  const countQ = `query($login:String!,$n:Int!,$q:String!){ ${field}(login:$login){ projectV2(number:$n){ items(first:1, query:$q){ totalCount } } } }`;
  const count = (q) => {
    const r = gql(countQ, { ...vars, q });
    const c = r.ok ? r.data?.[field]?.projectV2?.items?.totalCount : undefined;
    return typeof c === "number" ? { ok: true, c } : { ok: false, cls: r.cls ?? "NO_DATA" };
  };

  const now = new Date();
  const day = isoDay(new Date(now.getTime() - 7 * 86_400_000));
  const gt = count(`updated:>${day}`);
  if (!gt.ok) {
    say("updated:", "FAIL", `${gt.cls} → poller phải lấy hết item rồi lọc phía client`);
    return;
  }
  const lt = count(`updated:<${day}`);
  const eq = count(`updated:${day}`);
  const future = count(`updated:>2099-01-01`);
  if (!lt.ok || !eq.ok || !future.ok) {
    say("updated:", "WARN", `gt=${gt.c} lt=${lt.c ?? lt.cls} eq=${eq.c ?? eq.cls} future=${future.c ?? future.cls}`);
  } else {
    const e = evaluateCounts({ base: baseCount, gt: gt.c, lt: lt.c, eq: eq.c, future: future.c });
    const st = e.ignored ? "FAIL" : e.partition && e.futureZero ? "OK" : "WARN";
    say("updated:", st, `base=${baseCount} gt=${gt.c} lt=${lt.c} eq=${eq.c} future=${future.c}` +
      (e.ignored ? " → server bỏ qua filter" : ` partition=${e.partition} futureZero=${e.futureZero}`));
  }

  // Filter dựa trên updatedAt của item hay của Issue? Mốc ≈ đầu ngày sau `day` (UTC).
  const nodesQ = `query($login:String!,$n:Int!,$q:String!){ ${field}(login:$login){ projectV2(number:$n){ items(first:100, query:$q){ nodes{ updatedAt content{ __typename ... on Issue{ updatedAt } } } } } } }`;
  const nodes = gql(nodesQ, { ...vars, q: `updated:>${day}` });
  const list = nodes.ok ? nodes.data?.[field]?.projectV2?.items?.nodes : undefined;
  if (Array.isArray(list)) {
    const c = compareNodes(list, new Date(Date.parse(day) + 86_400_000).toISOString());
    say("filter basis", "INFO", `${c.n} item trả về: item.updatedAt sau mốc ${c.itemAfter}/${c.n}, Issue.updatedAt sau mốc ${c.issueAfter}/${c.issues}`);
  } else say("filter basis", "WARN", nodes.cls ?? "NO_DATA");

  // Độ chi tiết: filter có hiểu giờ/phút không?
  const since = new Date(now.getTime() - 2 * 3_600_000);
  const dt = count(`updated:>${isoSecond(since)}`);
  if (!dt.ok) say("updated time", "WARN", `${dt.cls} → chỉ dùng được mức ngày`);
  else {
    const r = gql(nodesQ, { ...vars, q: `updated:>${isoSecond(since)}` });
    const l = r.ok ? r.data?.[field]?.projectV2?.items?.nodes ?? [] : [];
    const c = compareNodes(l, since.toISOString());
    say("updated time", "INFO", `2h gần nhất: server trả ${dt.c}, trong đó item.updatedAt đúng trong 2h: ${c.itemAfter}`);
  }
}

// ---------- Claude CLI ----------
function resolveClaude() {
  if (opt.claude) return { command: opt.claude, args: ["--model", opt.model], source: "--claude", timeoutSeconds: 180 };
  if (existsSync(opt.config)) {
    try {
      const c = JSON.parse(readFileSync(opt.config, "utf8"));
      return { command: c.command, args: c.args ?? [], source: "config", timeoutSeconds: c.timeoutSeconds ?? 180 };
    } catch {
      say("claude cfg", "FAIL", "config/claude-cli.local.json không phải JSON hợp lệ");
      return undefined;
    }
  }
  const found = runSync(WIN ? "where.exe" : "which", ["claude"]);
  const first = firstLine(found.out);
  if (!first) return undefined;
  return { command: first, args: ["--model", opt.model], source: "PATH", timeoutSeconds: 180 };
}

function runClaude(cfg) {
  return new Promise((done) => {
    const cwd = mkdtempSync(join(tmpdir(), "m0-claude-"));
    const args = [...cfg.args, ...claudeFixedArgs(CLAUDE_SCHEMA, CLAUDE_SYSTEM_PROMPT)];
    const started = Date.now();
    let out = "", err = "", timedOut = false, child;
    const finish = (r) => {
      rmSync(cwd, { recursive: true, force: true });
      done({ ...r, ms: Date.now() - started, out, err, timedOut });
    };
    try {
      child = spawn(cfg.command, args, { cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      return finish({ spawnErrorCode: e.code ?? "UNKNOWN" });
    }
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, cfg.timeoutSeconds * 1000);
    child.stdout.setEncoding("utf8").on("data", (d) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      finish({ spawnErrorCode: e.code ?? "UNKNOWN" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish({ code });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(sampleStdin(), "utf8");
  });
}

async function checkClaude() {
  const cfg = resolveClaude();
  if (!cfg) {
    say("claude", "FAIL", "không tìm thấy: tạo config/claude-cli.local.json hoặc truyền --claude <đường dẫn tuyệt đối>");
    return;
  }
  const kind = extname(cfg.command).toLowerCase() || "(không đuôi)";
  say("claude path", WIN && /\.(cmd|bat|ps1)$/.test(kind) ? "FAIL" : "OK",
    `nguồn ${cfg.source}, loại ${kind}` + (WIN && /\.(cmd|bat|ps1)$/.test(kind) ? " → trỏ tới claude.exe hoặc node + cli.js" : ""));
  const v = runSync(cfg.command, [...cfg.args.filter((a, i, all) => a !== "--model" && all[i - 1] !== "--model"), "--version"]);
  if (v.code === 0) say("claude ver", "INFO", firstLine(v.out));

  const r = await runClaude(cfg);
  if (r.spawnErrorCode || r.timedOut || r.code !== 0) {
    raw(r.err);
    say("claude -p", "FAIL", `${classifyClaudeFailure({ spawnErrorCode: r.spawnErrorCode, stderr: r.err, timedOut: r.timedOut })} (${r.ms}ms)`);
    return;
  }
  const env = parseClaudeEnvelope(r.out);
  if (!env.ok) {
    raw(r.out.slice(0, 2000));
    say("claude -p", "FAIL", `${env.reason} (${r.ms}ms)`);
    return;
  }
  const e = evaluateTranslation(env.translation);
  const good = e.vietnamese && e.keepsCode && e.keepsMention && !e.japaneseLeft;
  say("claude -p", good ? "OK" : "WARN", `${r.ms}ms vi=${e.vietnamese} code=${e.keepsCode} mention=${e.keepsMention} jaLeft=${e.japaneseLeft}`);
  say("claude out", "INFO", env.translation.replace(/\s+/g, " ").slice(0, 200)); // đoạn mẫu, không phải dữ liệu công ty
}

// ---------- Task Scheduler (Windows) ----------
function powershell(script, timeout = 60_000) {
  const b64 = Buffer.from(script, "utf16le").toString("base64");
  return runSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", b64], timeout);
}
const psq = (s) => `'${s.replace(/'/g, "''")}'`;

async function checkScheduler() {
  if (!WIN) return say("scheduler", "SKIP", "chỉ chạy trên Windows");
  const name = "gh-issue-translator-m0-check";
  const out = join(tmpdir(), `m0-sched-${Date.now()}.txt`);
  const argLine = `"${SCRIPT}" --only-claude --out "${out}"` + (opt.claude ? ` --claude "${opt.claude}"` : "") + ` --config "${opt.config}"`;
  const reg = powershell(`
$ErrorActionPreference = 'Stop'
$a = New-ScheduledTaskAction -Execute ${psq(process.execPath)} -Argument ${psq(argLine)} -WorkingDirectory ${psq(REPO)}
$p = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName ${psq(name)} -Action $a -Principal $p -Force | Out-Null
Start-ScheduledTask -TaskName ${psq(name)}`);
  if (reg.code !== 0) {
    raw(reg.err);
    return say("scheduler", "FAIL", "không tạo/chạy được task (GPO chặn?)");
  }
  say("scheduler", "INFO", "đã tạo task tạm, đang chờ lượt chạy claude (tối đa ~4 phút)…");
  const deadline = Date.now() + 240_000;
  while (!existsSync(out) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 2000));
  await new Promise((r) => setTimeout(r, 500));
  const info = powershell(`(Get-ScheduledTaskInfo -TaskName ${psq(name)}).LastTaskResult; Unregister-ScheduledTask -TaskName ${psq(name)} -Confirm:$false`);
  if (!existsSync(out)) return say("scheduler", "FAIL", `task không ghi kết quả (LastTaskResult ${firstLine(info.out) || "?"})`);
  for (const l of readFileSync(out, "utf8").split(/\r?\n/).filter(Boolean)) {
    lines.push(`[sched] ${l}`);
    console.log(`[sched] ${l}`);
    if (/^\S+\s+FAIL/.test(l)) failures++;
  }
  rmSync(out, { force: true });
}

// ---------- Toast (Windows) ----------
async function checkToast() {
  if (!WIN) return say("toast", "SKIP", "chỉ chạy trên Windows");
  const url = "http://localhost:4317/issues/123";
  const r = powershell(`
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
$xml = @'
<toast activationType="protocol" launch="${url}">
  <visual><binding template="ToastGeneric">
    <text>[M0] Thử toast tiếng Việt: Lỗi đăng nhập</text>
    <text>Bấm vào đây: trình duyệt phải mở ${url}</text>
  </binding></visual>
</toast>
'@
$doc = New-Object Windows.Data.Xml.Dom.XmlDocument
$doc.LoadXml($xml)
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($doc))`);
  if (r.code !== 0) {
    raw(r.err);
    return say("toast", "FAIL", "PowerShell WinRT không hiện được toast");
  }
  say("toast show", "INFO", "đã gửi toast (PowerShell WinRT)");
  if (!process.stdin.isTTY) return say("toast click", "SKIP", "không hỏi được (không phải terminal)");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const seen = (await rl.question("  Toast có hiện, tiếng Việt đúng dấu không? (y/n) ")).trim().toLowerCase() === "y";
  const opened = (await rl.question(`  Bấm toast có mở trình duyệt tới ${url} không? (y/n) `)).trim().toLowerCase() === "y";
  rl.close();
  say("toast show", seen ? "OK" : "FAIL");
  say("toast click", opened ? "OK" : "FAIL", opened ? "" : "→ cần cách khác (node-notifier/snoretoast hoặc AppUserModelID riêng)");
}

// ---------- main ----------
async function main() {
  if (opt["only-claude"]) {
    say("ctx", "INFO", "Task Scheduler");
    const p = runSync(WIN ? "where.exe" : "which", ["claude"]);
    say("PATH claude", "INFO", firstLine(p.out) ? "có" : "không (dùng đường dẫn tuyệt đối trong config)");
    await checkClaude();
  } else {
    console.log(`gh-issue-translator diagnose — ${new Date().toISOString().slice(0, 10)}\n`);
    if (checkEnv() && checkGitHub()) checkProject();
    if (!opt["skip-claude"]) await checkClaude();
    if (opt.scheduler) await checkScheduler();
    if (opt.toast) await checkToast();
    console.log(`\n${failures === 0 ? "Không có FAIL." : `${failures} FAIL.`} Các dòng trên không chứa hostname/owner/nội dung → gõ lại được.`);
  }
  if (opt.out) writeFileSync(opt.out, lines.join("\n") + "\n", "utf8");
  process.exitCode = failures === 0 ? 0 : 1;
}

main();
