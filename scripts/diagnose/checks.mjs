// Logic thuần của `pnpm diagnose` (không I/O) để unit test được.
// Không phụ thuộc package nào: chạy được bằng `node` ngay sau khi giải nén zip, trước cả `pnpm install`.

/** Đoạn mẫu cố định (không phải dữ liệu công ty) → in bản dịch ra được, không lộ gì. */
export const SAMPLE_JA = "次のリリースでログイン画面のバグを修正します。`npm test` を実行してから @tanaka に確認してください。";

export const CLAUDE_SCHEMA = {
  type: "object",
  properties: { translation: { type: "string" } },
  required: ["translation"],
  additionalProperties: false,
};

export const CLAUDE_SYSTEM_PROMPT =
  "Dịch văn bản tiếng Nhật trong <source> sang tiếng Việt. Giữ nguyên inline code và @mention. Chỉ trả về trường translation.";

/** PHẢI giống `fixedArgs` trong core-translate (claude-cli-runner.ts); checks.test.ts giữ hai bên đồng bộ. */
export function claudeFixedArgs(schema, systemPrompt) {
  return [
    "-p",
    "--tools", "",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--output-format", "json",
    "--json-schema", JSON.stringify(schema),
    "--system-prompt", systemPrompt,
  ];
}

export function sampleStdin() {
  return `<source>\n${SAMPLE_JA}\n</source>`;
}

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Lấy envelope `result` từ stdout (một object, mảng event khi --verbose, hoặc dòng JSON sau log của wrapper). */
export function parseClaudeEnvelope(stdout) {
  const pick = (v) => {
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) if (isObject(v[i]) && v[i].type === "result") return v[i];
      return undefined;
    }
    return isObject(v) ? v : undefined;
  };
  let env = pick(tryParse(stdout.trim()));
  if (!env) {
    const lines = stdout.split(/\r?\n/);
    // Giống findEnvelope của runner: chỉ nhận dòng có `type: "result"` (wrapper có thể in log JSON riêng).
    for (let i = lines.length - 1; i >= 0 && !env; i--) {
      const found = pick(tryParse(lines[i].trim()));
      if (found?.type === "result") env = found;
    }
  }
  if (!env) return { ok: false, reason: "BAD_OUTPUT" };
  if (env.is_error) return { ok: false, reason: "IS_ERROR" };
  let out = env.structured_output;
  if (!isObject(out) && typeof env.result === "string") {
    // Giống readCliResult của runner: JSON có thể nằm giữa text (vd. trong ```json … ```).
    const m = /\{[\s\S]*\}/.exec(env.result);
    out = m ? tryParse(m[0]) : undefined;
  }
  if (!isObject(out) || typeof out.translation !== "string") return { ok: false, reason: "NO_TRANSLATION" };
  return { ok: true, translation: out.translation };
}

export function evaluateTranslation(text) {
  return {
    vietnamese: /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(text),
    keepsCode: text.includes("`npm test`"),
    keepsMention: text.includes("@tanaka"),
    japaneseLeft: /[぀-ヿ]/.test(text),
  };
}

/** Phân loại lỗi Claude CLI thành mã ngắn, không chứa đường dẫn hay nội dung. */
export function classifyClaudeFailure({ spawnErrorCode, stderr = "", timedOut = false }) {
  if (timedOut) return "TIMEOUT";
  if (spawnErrorCode === "ENOENT") return "NOT_FOUND";
  if (spawnErrorCode === "EINVAL") return "CMD_NOT_ALLOWED"; // .cmd/.bat không spawn được khi không có shell
  if (spawnErrorCode) return `SPAWN_${spawnErrorCode}`;
  const flag = /unknown option '?"?(--?[\w-]+)/i.exec(stderr);
  if (flag) return `UNKNOWN_FLAG ${flag[1]}`;
  if (/log ?in|auth|api key|credential|unauthorized/i.test(stderr)) return "AUTH";
  if (/ENOTFOUND|ECONN|ETIMEDOUT|certificate|proxy|network/i.test(stderr)) return "NETWORK";
  return "PROCESS_FAILED";
}

/** Phân loại lỗi `gh` thành mã ngắn. Thông báo gốc có thể chứa owner/hostname → không bao giờ in ra (trừ --raw). */
export function classifyGhError(text = "") {
  if (/argument '?query'? on Field '?items'?|doesn't accept argument '?query'?|Unknown argument "?query"?/i.test(text)) return "ARG_QUERY_UNSUPPORTED";
  if (/projectV2/i.test(text) && /doesn't exist|undefined field/i.test(text)) return "PROJECTS_V2_UNSUPPORTED";
  if (/INSUFFICIENT_SCOPES|read:project|required scopes/i.test(text)) return "SCOPE_MISSING";
  if (/Could not resolve to/i.test(text)) return "NOT_FOUND";
  if (/HTTP 401|Bad credentials|gh auth login|not logged/i.test(text)) return "AUTH";
  if (/rate limit/i.test(text)) return "RATE_LIMIT";
  if (/ENOTFOUND|connect|timeout|certificate|x509|proxy/i.test(text)) return "NETWORK";
  return "OTHER";
}

/** Kiểm checklist filter `updated:` của Projects v2. */
export function evaluateCounts({ base, gt, lt, eq, future }) {
  return {
    partition: gt + lt + eq === base,
    futureZero: future === 0,
    // Server bỏ qua filter: mọi query trả về đúng tổng.
    ignored: base > 0 && gt === base && lt === base,
  };
}

/**
 * So các item server trả cho `updated:>D` với mốc thời gian thật để biết filter dựa trên
 * updatedAt của project item hay của Issue (bẫy đã biết: app theo dõi Issue.updatedAt).
 */
export function compareNodes(nodes, boundaryIso) {
  const b = Date.parse(boundaryIso);
  let itemAfter = 0, issues = 0, issueAfter = 0;
  for (const n of nodes) {
    if (Date.parse(n.updatedAt) >= b) itemAfter++;
    if (n.content && n.content.__typename === "Issue") {
      issues++;
      if (Date.parse(n.content.updatedAt) >= b) issueAfter++;
    }
  }
  return { n: nodes.length, itemAfter, issues, issueAfter };
}

export function hasProjectScope(authStatusText) {
  return /'?(read:project|project)'?/.test(/Token scopes:(.*)/i.exec(authStatusText)?.[1] ?? "");
}

export function isoDay(d) {
  return d.toISOString().slice(0, 10);
}

export function isoSecond(d) {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Chọn claude từ output `where claude` (Windows). Node không spawn được .cmd/.ps1/shim không đuôi khi không có shell:
 * ưu tiên .exe; nếu chỉ có bản npm (.cmd) thì dùng node + cli.js.
 */
export function chooseClaude(whereLines, win = true) {
  const lines = whereLines.map((l) => l.trim()).filter(Boolean);
  if (!win) return lines[0] ? { kind: "exe", path: lines[0] } : undefined;
  const exe = lines.find((l) => /\.exe$/i.test(l));
  if (exe) return { kind: "exe", path: exe };
  const cmd = lines.find((l) => /\.cmd$/i.test(l));
  if (cmd) return { kind: "npm", path: cmd };
  return lines[0] ? { kind: "other", path: lines[0] } : undefined;
}

/**
 * So kết quả filter `updated:>D` với toàn bộ item. `safeMarkIso` cách D đủ xa (≥ 1 ngày) để lệch múi giờ của server
 * không ảnh hưởng: Issue cập nhật sau mốc này mà filter không trả = filter bỏ sót thật.
 */
export function analyzeFilter(allNodes, returnedIds, safeMarkIso) {
  const mark = Date.parse(safeMarkIso);
  const returned = new Set(returnedIds);
  let issuesAfter = 0, missed = 0, missedItemStale = 0;
  for (const n of allNodes) {
    if (!n.content || n.content.__typename !== "Issue") continue;
    if (Date.parse(n.content.updatedAt) < mark) continue;
    issuesAfter++;
    if (!returned.has(n.id)) {
      missed++;
      if (Date.parse(n.updatedAt) < mark) missedItemStale++;
    }
  }
  return { issuesAfter, missed, missedItemStale };
}

/** Item có `updatedAt` > iso (đếm phía client, làm chuẩn để so với server). */
export function countAfter(nodes, iso) {
  const t = Date.parse(iso);
  return nodes.filter((n) => Date.parse(n.updatedAt) > t).length;
}

/** Mốc thời gian để thử độ chi tiết giờ/phút: ngay trước item mới thứ k, lấy từ dữ liệu thật. */
export function pickTimeProbe(nodes, k = 5) {
  const times = nodes.map((n) => Date.parse(n.updatedAt)).filter(Number.isFinite).sort((a, b) => b - a);
  if (times.length === 0) return undefined;
  const t = times[Math.min(k, times.length) - 1] - 1000;
  return isoSecond(new Date(t));
}
