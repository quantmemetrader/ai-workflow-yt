/**
 * The v1 graphics path after director v2's changes to `Graphics.tsx`.
 *
 *   cd /home/ubuntu/wt/dv2-W4 && TSX_TSCONFIG_PATH=$PWD/tsconfig.json \
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx \
 *     scripts/dv2/test-v1-stills.ts [--out /tmp/dv2_lab/W4/v1stills] [--fixture /tmp/dv2_lab/fixture/zhengliu.json]
 *
 * W4 changed the composition every v1 still is drawn from: the entrance
 * curve, the `statement` position, and a dispatch to the v2 templates.
 * The stills renderer (`remotion/render-stills.mjs`, frame 20 of the
 * `Overlay` composition) is untouched, and this draws one still per v1
 * kind the 蒸馏 fixture uses — header, watermark, footnote, title, stat,
 * card, chapter, statement, lower third, end card — through the very
 * function the worker calls (`lib/video/graphics.ts:renderGraphics`),
 * then tiles them on one sheet. Every PNG over 500 bytes is a pass; the
 * sheet is for the eye. No database: the rows come from the fixture file.
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { renderGraphics, type GraphicSpec } from "../../lib/video/graphics";

const run = promisify(execFile);
const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const OUT = arg("--out", "/tmp/dv2_lab/W4/v1stills");
const FIXTURE = arg("--fixture", "/tmp/dv2_lab/fixture/zhengliu.json");

type Row = { kind: string; text: string | null; sub?: string | null; startMs?: number; endMs?: number; options?: Record<string, unknown> | null };

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  const fixture = JSON.parse(await readFile(FIXTURE, "utf8")) as { graphics: Row[]; project?: { accent?: string } };
  const accent = fixture.project?.accent ?? "#d6e64f";

  /* One row per v1 kind, the first the fixture has of each; the three
     furniture rows carry no times, so they get three seconds. */
  const wanted = ["header", "watermark", "footnote", "title", "stat", "card", "chapter", "statement", "lower-third", "end-card"];
  const specs: GraphicSpec[] = [];
  for (const kind of wanted) {
    const row = fixture.graphics.find((g) => g.kind === kind && g.text);
    if (!row) continue;
    const startMs = row.startMs ?? 0;
    specs.push({ kind: kind as GraphicSpec["kind"], text: row.text ?? "", sub: row.sub ?? null, startMs, endMs: row.endMs && row.endMs > startMs ? row.endMs : startMs + 3000 });
  }

  const t0 = Date.now();
  const outs = await renderGraphics(specs, { width: 1080, height: 1920, accent, dir: OUT });
  const ms = Date.now() - t0;

  const sizes: { kind: string; file: string; bytes: number }[] = [];
  for (const [i, file] of outs.entries()) sizes.push({ kind: specs[i].kind, file, bytes: (await stat(file).catch(() => null))?.size ?? 0 });
  const ok = sizes.every((s) => s.bytes > 500);

  /* One sheet: every still over a mid-grey ground, 5 a row. */
  const sheet = path.join(OUT, "v1-sheet.jpg");
  const ins = outs.flatMap((f) => ["-i", f]);
  const graph = `${outs.map((_, i) => `[${i}:v]format=rgba,scale=270:480[s${i}];`).join("")}${outs.map((_, i) => `[s${i}]`).join("")}xstack=inputs=${outs.length}:layout=${outs.map((_, i) => `${(i % 5) * 270}_${Math.floor(i / 5) * 480}`).join("|")}:fill=0x777777[v]`;
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...ins, "-filter_complex", graph, "-map", "[v]", "-q:v", "3", sheet], { timeout: 120_000 });

  const report = { ok, ms, stills: sizes, sheet };
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  console.log(`v1 stills: ${ok ? "ok" : "FAILED"} — ${sizes.length} kinds in ${(ms / 1000).toFixed(1)} s`);
  for (const s of sizes) console.log(`  ${s.kind.padEnd(12)} ${String(s.bytes).padStart(8)} B  ${path.basename(s.file)}`);
  console.log(`sheet: ${sheet}`);
  if (!ok) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
