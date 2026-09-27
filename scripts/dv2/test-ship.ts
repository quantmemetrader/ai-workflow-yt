/**
 * The product path's write-then-read round trip, checked against a lab run.
 *
 *   cd /home/ubuntu/wt/dv2 && TSX_TSCONFIG_PATH=$PWD/tsconfig.json \
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx \
 *     scripts/dv2/test-ship.ts --run /tmp/dv2_lab/runs/r03ship
 *
 * The product director writes a v2 video down as rows (`persist.ts:toRows`,
 * `writeCaptionLines`, `writeCutTimeline`) and the export's renderer reads
 * them back (`render-input.ts:readRows`) into the plan the lab renders
 * directly. This takes a finished lab run, writes its plan as the director
 * would (in memory: no database, no storage), reads the rows back as the
 * renderer does, and checks that every input to `renderTimeline` comes out
 * the same: the motion props of every graphic, the cutaways, the cuts and
 * their framing, the furniture, the ASS. Exit 1 on any difference.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LayoutPlan } from "@/lib/video/layout";
import type { GraphicSpecV2 } from "@/lib/video/v2/types";
import type { CutOut, DesignOut } from "@/lib/video/v2/pipeline";

const argv = process.argv.slice(2);
const RUN = argv[argv.indexOf("--run") + 1] ?? "/tmp/dv2_lab/runs/r03ship";

const readJson = async <T,>(p: string): Promise<T> => JSON.parse(await readFile(path.join(RUN, p), "utf8")) as T;

/** JSON with sorted keys, so two objects built in different orders compare equal. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x));
}

async function main() {
  const { rowId, toRows } = await import("@/lib/video/v2/persist");
  const { readRows, fillPictures } = await import("@/lib/video/v2/render-input");
  const { toMotionSpecs, FURNITURE } = await import("@/lib/video/v2/render-plan");
  const { captionsAss, v2RenderPlan, withImageExt } = await import("@/lib/video/v2/pipeline");

  const plan = await readJson<LayoutPlan>("plan.json");
  const d = await readJson<DesignOut>("design.json");
  const cut = await readJson<CutOut>("cut.json");
  const fixture = JSON.parse(await readFile(argv.includes("--fixture") ? argv[argv.indexOf("--fixture") + 1] : "/tmp/dv2_lab/fixture/zhengliu.json", "utf8")) as { project: { accent: string }; source: { clipId: string } };
  const accent = fixture.project.accent;
  const problems: string[] = [];
  const check = (what: string, a: unknown, b: unknown) => {
    const same = stable(a) === stable(b);
    console.log(`${same ? "SAME" : "DIFF"}  ${what}`);
    if (!same) {
      problems.push(what);
      const sa = stable(a);
      const sb = stable(b);
      let i = 0;
      while (i < sa.length && sa[i] === sb[i]) i++;
      console.log(`      lab:     …${sa.slice(Math.max(0, i - 120), i + 160)}`);
      console.log(`      product: …${sb.slice(Math.max(0, i - 120), i + 160)}`);
    }
  };

  /* ---- the lab's side: what its motion and render stages were handed ---- */
  const labGraphics = JSON.parse(JSON.stringify(plan.graphics)) as GraphicSpecV2[];
  for (const g of labGraphics) {
    for (const ref of [g.props.logo, g.props.image, ...(Array.isArray(g.props.group) ? (g.props.group as { logo?: unknown }[]).map((m) => m.logo) : [])]) {
      const a = (ref as { asset?: { localPath?: string } } | null | undefined)?.asset;
      if (a?.localPath) a.localPath = await withImageExt(a.localPath);
    }
  }

  /* ---- the product's side: rows as the director writes them, through JSON as the database keeps them ---- */
  const clipIds = new Map<string, string>();
  for (const c of plan.cutaways) if (!c.still) clipIds.set(c.asset.fileId, `clip_${c.asset.fileId}`);
  let n = 0;
  const rows = JSON.parse(JSON.stringify(toRows(plan, "prj_test", clipIds).map((r) => ({ ...r, id: `gfx_${n++}`, options: { ...r.options, planId: r.id } }))));
  const byFile = new Map<string, string>();
  for (const c of plan.cutaways) if (c.asset.localPath) byFile.set(c.asset.fileId, c.asset.localPath);
  for (const g of labGraphics)
    for (const ref of [g.props.logo, g.props.image, ...(Array.isArray(g.props.group) ? (g.props.group as { logo?: unknown }[]).map((m) => m.logo) : [])]) {
      const a = (ref as { asset?: { fileId?: string; localPath?: string } } | null | undefined)?.asset;
      if (a?.fileId && a.localPath) byFile.set(a.fileId, a.localPath);
    }
  /* A lab asset's id is `local:…`, which the real renderer never pulls; here it stands for the Files id. */
  const pull = async (fileId: string | null | undefined) => (fileId ? (byFile.get(fileId) ?? null) : null);
  const read = readRows(rows, (clipId) => (clipId.startsWith("clip_") ? clipId.slice(5) : undefined));
  await fillPictures(read.specs, pull);
  const cutaways = [];
  for (const c of read.cutaways) {
    const local = await pull(c.fileId);
    if (local) cutaways.push({ ...c.spec, asset: { ...c.spec.asset, localPath: local } });
  }
  console.log(`rows ${rows.length}: ${read.specs.length} graphics, ${read.cutaways.length} cutaways, ${read.stills.length} stills, ${read.brolls.length} brolls (the last two only from editor edits)`);
  if (read.stills.length || read.brolls.length) problems.push("editor-only kinds appeared");

  /* ---- motion: every graphic's props as the templates receive them ---- */
  /* The row keeps the plan id as `rowId(id)` in `options.planId`. */
  const labMotion = new Map(toMotionSpecs(labGraphics).map((g) => [rowId(g.id), g]));
  const prodMotion = new Map(toMotionSpecs(read.specs).map((g) => [g.id, g]));
  check("motion graphic ids", [...labMotion.keys()].sort(), [...prodMotion.keys()].sort());
  let motionDiffs = 0;
  for (const [id, g] of labMotion) {
    const p = prodMotion.get(id);
    const zoneOf = (x: GraphicSpecV2) => (typeof x.props.zone === "string" ? x.props.zone : x.zone);
    const a = { kind: g.kind, startMs: g.startMs, endMs: g.endMs, zone: zoneOf(g), props: { ...g.props, zone: zoneOf(g) } };
    const b = p ? { kind: p.kind, startMs: p.startMs, endMs: p.endMs, zone: zoneOf(p), props: { ...p.props, zone: zoneOf(p) } } : null;
    if (stable(a) !== stable(b)) {
      motionDiffs++;
      check(`motion ${id}`, a, b);
    }
  }
  console.log(`${motionDiffs ? "DIFF" : "SAME"}  motion props of ${labMotion.size} graphics`);

  /* ---- furniture ---- */
  const furn = (gs: GraphicSpecV2[]) => gs.filter((g) => FURNITURE.has(g.kind)).map((g) => ({ kind: g.kind, text: g.props.text, sub: g.props.sub ?? null })).sort((x, y) => x.kind.localeCompare(y.kind));
  check("furniture text", furn(labGraphics), furn(read.specs));
  const placements = Object.fromEntries(rows.filter((r: { kind: string }) => FURNITURE.has(r.kind)).map((r: { kind: string; placement: string; scale: number }) => [r.kind, [r.placement, r.scale]]));
  check("furniture placement", { footnote: ["bottom-center", 30], header: ["top-left", 30], watermark: ["bottom-center", 30] }, placements);

  /* ---- the render plan: cuts, framing, cutaways ---- */
  const pieces = cut.pieces.map((p) => ({ ...p, clipId: fixture.source.clipId }));
  const base = { raw: "/raw.mp4", cutZooms: plan.cutZooms, renderHints: plan.renderHints, face: d.face, motion: [], furniture: null, assFile: undefined, accent, workDir: "/w" };
  const lab = await v2RenderPlan({ ...base, pieces: cut.pieces, cutaways: plan.cutaways });
  /* The product reads the pieces back off the timeline, which keeps whole milliseconds. */
  const prod = await v2RenderPlan({ ...base, pieces: pieces.map((p) => ({ ...p, inMs: Math.round(p.inMs), outMs: Math.round(p.outMs) })), cutaways, ...{ cutZooms: JSON.parse(JSON.stringify(plan.cutZooms)) } });
  check("render cuts (framing, anchors, pushes, seams)", lab.plan.cuts, prod.plan.cuts);
  check("render cutaways (layouts, crops, runs, split host)", lab.plan.cutaways, prod.plan.cutaways);
  check("skipped cutaways", lab.skipped, prod.skipped);

  /* ---- captions: the rows the director writes, paired again by start ---- */
  const zh = d.captions.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text, words: c.words, keywords: c.keywords }));
  const secondAt = new Map(d.captions.filter((c) => c.second).map((c) => [c.startMs, c.second]));
  const labAss = await readFile(path.join(RUN, "captions.ass"), "utf8");
  const prodAss = await captionsAss(JSON.parse(JSON.stringify(zh.map((c) => ({ ...c, second: secondAt.get(c.startMs) ?? null })))), { accent, chinY: d.chinY });
  check("captions.ass", labAss, prodAss);
  const dupStarts = d.captions.length - new Set(d.captions.map((c) => c.startMs)).size;
  if (dupStarts) problems.push(`${dupStarts} caption lines share a start (the English pairing needs unique starts)`);

  console.log(problems.length ? `\nFAIL: ${problems.join("; ")}` : "\nPASS: the rows read back into the lab's render inputs");
  process.exitCode = problems.length ? 1 : 0;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
