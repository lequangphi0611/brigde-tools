#!/usr/bin/env node
// Thay Claude CLI trong test (không bao giờ gọi AI). Cấu hình như người dùng thật:
//   { "command": "<node>", "args": ["<file này>", "--fake-mode", "ok", "--fake-record", "<file.jsonl>"] }
// Mode: ok (mặc định) · slow (--fake-delay ms) · hang · garbage · fail (exit 2, in stderr) · wrapped (log trước dòng JSON).
// "ok" trả structured_output { translation: "[vi] <nội dung trong <source>> " } để test assert được.
import { appendFileSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const mode = opt("--fake-mode", "ok");

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (stdin += c));
process.stdin.on("end", async () => {
  const record = opt("--fake-record");
  if (record) appendFileSync(record, JSON.stringify({ argv, stdin, cwd: process.cwd(), envProbe: process.env.FAKE_ENV_PROBE }) + "\n");

  if (mode === "fail") {
    process.stderr.write("fake: not logged in\n");
    process.exit(2);
  }
  if (mode === "garbage") return void process.stdout.write("not json at all");
  if (mode === "hang") return void setTimeout(() => {}, 1e9);
  if (mode === "slow") await new Promise((r) => setTimeout(r, Number(opt("--fake-delay", "800"))));

  const source = /<source>\n?([\s\S]*?)\n?<\/source>/.exec(stdin)?.[1] ?? stdin;
  const envelope = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "", structured_output: { translation: `[vi] ${source}` }, modelUsage: { "fake-model": {} } });
  if (mode === "wrapped") process.stdout.write("wrapper: starting claude\n");
  process.stdout.write(envelope);
});
