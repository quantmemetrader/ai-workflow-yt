#!/usr/bin/env node
/*
 * After a build: no page may trace old releases, temp files or thousands of
 * stray files. Fails the deploy (before anything is switched over) and names
 * the worst pages, so a tracing regression is caught at the first deploy that
 * has it, not when a build finally runs out of memory weeks later.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const dist = process.argv[2] || ".next-build";
const LIMIT = Number(process.env.TRACE_LIMIT || 30000);
const FORBIDDEN = [/\/releases\//, /\/static-archive\//, /^\/tmp\//, /\/\.next-dev\//, /\/backups\//];
const offenders = [];
const walk = (dir) => {
  let names;
  try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    const p = path.join(dir, n);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (n.endsWith(".nft.json")) {
      const files = JSON.parse(readFileSync(p, "utf8")).files ?? [];
      const abs = files.map((f) => path.resolve(path.dirname(p), f));
      const forbidden = abs.filter((a) => FORBIDDEN.some((re) => re.test(a)));
      if (files.length > LIMIT || forbidden.length) offenders.push({ p, n: files.length, forbidden: forbidden.slice(0, 3) });
    }
  }
};
walk(path.join(dist, "server"));
if (offenders.length) {
  offenders.sort((a, b) => b.n - a.n);
  console.error(`!! ${offenders.length} page(s) trace too much (limit ${LIMIT} files, or old releases / temp files):`);
  for (const o of offenders.slice(0, 10)) console.error(`   ${o.n} files  ${o.p}${o.forbidden.length ? `\n      e.g. ${o.forbidden.join("\n           ")}` : ""}`);
  process.exit(1);
}
console.log("trace output ok");
