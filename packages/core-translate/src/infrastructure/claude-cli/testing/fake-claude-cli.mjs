#!/usr/bin/env node
// Thay Claude CLI trong test (không bao giờ gọi AI). Cấu hình như người dùng thật:
//   { "command": "<node>", "args": ["<file này>", "--fake-mode", "ok", "--fake-record", "<file.jsonl>"] }
// Mode: ok (mặc định) · slow (--fake-delay ms) · hang · garbage · fail (exit 2, in stderr) · wrapped (log trước dòng JSON).
// Stdin không có <segment: "ok" trả structured_output { translation: "[vi] <nội dung trong <source>> " }.
// Stdin có <segment: trả structured_output { segments: [{ id, translation: "[vi] <nội dung segment>" }] }; thêm mode
//   batch-missing (bỏ segment cuối) · batch-extra (thêm id lạ) · batch-drop-placeholder (xoá ⟦1⟧ đầu tiên)
//   · batch-result-text (JSON nằm trong `result`, không có structured_output).
// Cờ: --fake-fail-on <n> (lần gọi thứ n theo số dòng record thì thoát lỗi như mode fail)
//     --fake-lock <file> (tạo độc quyền lúc bắt đầu, xoá khi kết thúc; đã có → thoát lỗi, phát hiện gọi song song).
// Record: mỗi lần gọi một dòng JSON, có startedAt/endedAt (ms epoch; endedAt được ghi khi trả lời xong, hang/fail thì không có).
import { appendFileSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const mode = opt("--fake-mode", "ok");
const startedAt = Date.now();

const lock = opt("--fake-lock");
if (lock) {
  try {
    writeFileSync(lock, String(process.pid), { flag: "wx" });
  } catch {
    process.stderr.write("fake: concurrent call detected\n");
    process.exit(3);
  }
  process.on("exit", () => {
    try {
      unlinkSync(lock);
    } catch {}
  });
}

const record = opt("--fake-record");
let recordLine = -1;
let entry;
const finishRecord = () => {
  if (!record || recordLine < 0) return;
  const lines = readFileSync(record, "utf8").split("\n");
  lines[recordLine] = JSON.stringify({ ...entry, endedAt: Date.now() });
  writeFileSync(record, lines.join("\n"));
};

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (stdin += c));
process.stdin.on("end", async () => {
  if (record) {
    entry = { argv, stdin, cwd: process.cwd(), envProbe: process.env.FAKE_ENV_PROBE, startedAt };
    appendFileSync(record, JSON.stringify(entry) + "\n");
    recordLine = readFileSync(record, "utf8").trim().split("\n").length - 1;
  }

  const failOn = opt("--fake-fail-on");
  if (mode === "fail" || (failOn !== undefined && recordLine + 1 === Number(failOn))) {
    process.stderr.write("fake: not logged in\n");
    process.exit(2);
  }
  if (mode === "garbage") return void process.stdout.write("not json at all");
  if (mode === "hang") return void setTimeout(() => {}, 1e9);
  if (mode === "slow") await new Promise((r) => setTimeout(r, Number(opt("--fake-delay", "800"))));

  const done = (envelope) => {
    finishRecord();
    process.stdout.write(envelope);
  };
  const base = { type: "result", subtype: "success", is_error: false, modelUsage: { "fake-model": {} } };
  if (mode === "wrapped") process.stdout.write("wrapper: starting claude\n");

  if (stdin.includes("<segment")) {
    let segments = [...stdin.matchAll(/<segment id="([^"]*)">([\s\S]*?)<\/segment>/g)].map((m) => ({ id: m[1], translation: `[vi] ${m[2]}` }));
    if (mode === "batch-missing") segments = segments.slice(0, -1);
    if (mode === "batch-extra") segments.push({ id: "s999", translation: "[vi] extra" });
    if (mode === "batch-drop-placeholder") {
      const t = segments.find((s) => s.translation.includes("⟦1⟧"));
      if (t) t.translation = t.translation.replace("⟦1⟧", "");
    }
    if (mode === "batch-result-text") return done(JSON.stringify({ ...base, result: `Here is the JSON:\n${JSON.stringify({ segments })}` }));
    return done(JSON.stringify({ ...base, result: "", structured_output: { segments } }));
  }

  const source = /<source>\n?([\s\S]*?)\n?<\/source>/.exec(stdin)?.[1] ?? stdin;
  done(JSON.stringify({ ...base, result: "", structured_output: { translation: `[vi] ${source}` } }));
});
