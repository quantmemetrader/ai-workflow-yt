#!/usr/bin/env node
/*
 * Before a build: refuse server code that makes the file tracer sweep the
 * project. `path.join(process.cwd(), someVariable)` (or resolve) tells the
 * tracer "any file under the project could be read here", so it pulls in the
 * whole tree — releases/ included, which grows by a full build every deploy.
 * On 29 Sep that reached 215,000 traced files per page and the build was
 * OOM-killed at 54 GB. Mark a genuinely runtime path with a turbopackIgnore
 * comment (turbopackIgnore: true) right after the opening parenthesis.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOTS = ["app", "lib", "components", "remotion/src"];
const bad = [];
const walk = (dir) => {
  let names;
  try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = path.join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs)$/.test(n)) check(p);
  }
};
const check = (file) => {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (line.includes("turbopackIgnore")) return;
    const m = line.match(/\b(?:path\.)?(?:join|resolve)\(\s*process\.cwd\(\)\s*,([^)]*)\)/);
    if (!m) return;
    const args = m[1].split(",").map((a) => a.trim()).filter(Boolean);
    const dynamic = args.some((a) => !/^(["'`])[^"'`${}]*\1$/.test(a));
    if (dynamic) bad.push(`${file}:${i + 1}: ${line.trim()}`);
  });
};
ROOTS.forEach(walk);
if (bad.length) {
  console.error("!! process.cwd() joined with a runtime value: the build would trace the whole project (releases/ included).");
  console.error("   Add /*turbopackIgnore: true*/ after the opening parenthesis of each:\n");
  for (const b of bad) console.error("   " + b);
  process.exit(1);
}
console.log("trace sources ok");
