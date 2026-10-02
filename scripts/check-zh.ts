/**
 * Every Chinese string in the source must be Simplified and spelt from the
 * standard character set.
 *
 *   npm run check:zh
 *
 * The client reads the product in Simplified Chinese and has sent screenshots
 * of Traditional and garbled labels three times (30 Sep, 1 Oct, 2 Oct). A
 * converter in one browser caused the last round, but the two before were
 * strings in this repository. This runs before every deploy and fails it on:
 *
 *   - a Traditional character (anything OpenCC's t2s table would change);
 *   - a character outside 《通用规范汉字表》 (8105 characters), which is how
 *     a converter's garbage (艸藁 for 草稿) and rare variants show up.
 *
 * Comments are not checked (they quote what the client saw). A code line that
 * must keep such a character (a table of the very characters to fix, a search
 * query for a Traditional edition) carries the comment `zh-ok`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { hasTraditional, toSimplified } from "@/lib/text/simplified";
import { nonStandardChinese } from "@/lib/text/standard-chars";

const ROOTS = ["app", "components", "lib"];
/* Tables of characters (the conversion tables, a pinyin dictionary, the Traditional detector) and the one file that lists the garbage to undo. */
const SKIP = new Set(["lib/text/simplified.ts", "lib/text/vocab.ts", "lib/text/standard-chars.ts", "components/zh/SimplifiedGuard.tsx", "lib/video/pinyin.ts", "lib/research/traditional.ts", "lib/research/beats.ts", "lib/research/beat-sources.ts"]);
/* The ends of the CJK block, used as regex bounds (/[\u3400-\u9fff]/ written out). */
const SENTINELS = /[\u3400\u4dbf\u9fff]/g;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]+/g;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(ts|tsx)$/.test(name)) yield path;
  }
}

let errors = 0;
let scanned = 0;
for (const root of ROOTS) {
  for (const path of files(root)) {
    if (SKIP.has(path)) continue;
    scanned += 1;
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (line.includes("zh-ok")) return;
      /* A comment may quote what the client saw; only code and strings are checked. */
      const code = line.trim();
      if (/^(\*|\/\*|\/\/|\{\/\*)/.test(code)) return;
      line = line.replace(/\/\/.*$/, "");
      for (const run of (line.replace(SENTINELS, "").match(CJK) ?? [])) {
        const bad = nonStandardChinese(run);
        if (hasTraditional(run)) {
          errors += 1;
          console.log(`${path}:${i + 1}: Traditional 「${run}」 → 「${toSimplified(run)}」`);
        } else if (bad.length) {
          errors += 1;
          console.log(`${path}:${i + 1}: not in 通用规范汉字表: ${bad.join(" ")} in 「${run}」`);
        }
      }
    });
  }
}
console.log(`check-zh: ${scanned} files, ${errors} problem${errors === 1 ? "" : "s"}`);
if (errors) process.exit(1);
