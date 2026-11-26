#!/usr/bin/env node
/**
 * Khoá hành vi: ghi/kiểm tra sha256 của mọi file trong e2e/specs.
 *   write  — chạy SAU khi user duyệt e2e (bước 3 của workflow /feature).
 *   check  — chạy trong `pnpm verify` và CI; fail nếu spec bị sửa mà chưa re-lock.
 * Implementer KHÔNG được chạy `write`. Chỉ orchestrator chạy, sau khi user đồng ý.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SPECS = join(ROOT, "e2e/specs");
const LOCK = join(ROOT, "e2e/specs.lock.json");

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
function snapshot() {
  return Object.fromEntries(
    walk(SPECS)
      .sort()
      .map((p) => [relative(ROOT, p), createHash("sha256").update(readFileSync(p)).digest("hex")]),
  );
}

const cmd = process.argv[2];
if (cmd === "write") {
  writeFileSync(LOCK, JSON.stringify(snapshot(), null, 2) + "\n");
  console.log(`e2e lock updated: ${relative(ROOT, LOCK)}`);
} else if (cmd === "check") {
  if (!existsSync(LOCK)) {
    console.error("Thiếu e2e/specs.lock.json — chạy `pnpm e2e:lock` sau khi duyệt spec.");
    process.exit(1);
  }
  const locked = JSON.parse(readFileSync(LOCK, "utf8"));
  const now = snapshot();
  const keys = new Set([...Object.keys(locked), ...Object.keys(now)]);
  const diff = [...keys].filter((k) => locked[k] !== now[k]);
  if (diff.length) {
    console.error("E2E spec đã thay đổi so với bản khoá (hành vi user bị đổi?):");
    for (const k of diff) console.error(`  - ${k}${!now[k] ? " (bị xoá)" : !locked[k] ? " (mới, chưa khoá)" : ""}`);
    console.error("Nếu thay đổi là chủ ý và user đã duyệt: `pnpm e2e:lock`.");
    process.exit(1);
  }
  console.log(`e2e lock OK (${keys.size} file)`);
} else {
  console.error("usage: e2e-lock.mjs write|check");
  process.exit(2);
}
