/**
 * W5's test: the compositor on the 蒸馏 fixture, without the database.
 *
 *   cd /home/ubuntu/wt/dv2-W5 && TSX_TSCONFIG_PATH=$PWD/tsconfig.json \
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx \
 *     scripts/dv2/test-render.ts [--fixture /tmp/dv2_lab/fixture/zhengliu.json] [--raw /home/ubuntu/raw/zhengliu.mp4] \
 *     [--out /tmp/dv2_lab/W5] [--only prep,a,b,regress,measure] [--fetch]
 *
 * Stages, each writing under `--out` only:
 *
 *   prep     the face track of the raw take (cached), the fixture's stock clips
 *            and pictures pulled from the object store once (`--fetch`; a read),
 *            the furniture still, 45 VP9-alpha clips made with ffmpeg as a
 *            stand-in for W4's, and the bilingual ASS from the fixture captions.
 *   a        the v1 fixture timeline (11 cuts, 3 punches, 9 pip cutaways, 33
 *            stills, ASS) through `renderTimeline` in v1 mode: the regression
 *            render and the timing baseline.
 *   b        a synthetic v2 plan on the same cut: alternating framing with snap
 *            and slow pushes, 20 cutaways across `full` / `split` / `run`, 45
 *            motion clips, furniture, ASS, the voice chain.
 *   regress  the v1 command for a 16:9 and a 1:1 plan (titles, a dissolve, a
 *            dip, stills, a pip cutaway, a punch, a ducked track) against the
 *            command the base commit's renderer built for the same input,
 *            argument for argument; then a short real render of each.
 *   measure  the acceptance numbers on (a) and (b): encode time, the eye line
 *            on sampled host frames (face.py on the output), bars on `full`,
 *            the `split` band, the `run` circle's centre, loudness (ebur128),
 *            clicks at the cuts (peak delta), contact sheets, and a JSON report.
 *
 * Nothing here talks to the database. `--fetch` reads R2 through the same
 * `getObject` the worker uses and writes only under `--out`.
 */
import { execFile, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { toAss, type AssCue } from "../../lib/video/ass";
import { faceAnchor, faceSamples, faceTrackCached, faceTrackFor, minFramingZoom, type FaceTrackDetail } from "../../lib/video/face";
import { layoutGeometry, renderGraphics, type BrollSpec, type GraphicSpec, type PunchSpec } from "../../lib/video/graphics";
import { renderTimeline, type RenderCut, type RenderInput } from "../../lib/video/render";
import type { MotionClip, RenderPlan } from "../../lib/video/v2/types";

const run = promisify(execFile);

const argv = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const FIXTURE = arg("--fixture", "/tmp/dv2_lab/fixture/zhengliu.json");
const RAW = arg("--raw", "/home/ubuntu/raw/zhengliu.mp4");
const OUT = arg("--out", "/tmp/dv2_lab/W5");
const ONLY = new Set(arg("--only", "prep,a,b,regress,measure").split(","));
const FETCH = argv.includes("--fetch");
const FONTS = path.join(process.cwd(), "remotion", "public", "fonts");
const BLACK = path.join(FONTS, "NotoSansCJKsc-Black.otf");
const W = 1080;
const H = 1920;

/* ------------------------------------------------------------ fixture */

type Fixture = {
  project: { accent: string; captionPreset: string };
  source: { path: string; clipId: string; durationMs: number };
  clips: { id: string; label: string; durationMs: number | null; file: { name: string; storageKey: string; mime: string } }[];
  timeline: { ord: number; clipId: string; kind: string; inMs: number; outMs: number | null; transition: string; transitionMs: number }[];
  captions: Record<string, { startMs: number; endMs: number; text: string; keywords: string[] | null; words: { start: number; end: number; text: string }[] | null }[]>;
  graphics: {
    id: string; kind: string; text: string; sub: string | null; startMs: number; endMs: number; fileId: string | null; icon: string | null;
    placement: string | null; scale: number | null; options: Record<string, unknown>; file: { name: string; mime: string; storageKey: string } | null;
  }[];
};

const exists = async (p: string) => Boolean(await stat(p).catch(() => null));
const sec = (ms: number) => (ms / 1000).toFixed(3);

/** Where a fetched asset lives locally, by its storage key. */
const assetPath = (dir: string, key: string) => path.join(dir, "assets", key.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120));

async function fetchAssets(fixture: Fixture, dir: string): Promise<void> {
  const { getObject } = await import("../../lib/storage/r2");
  await mkdir(path.join(dir, "assets"), { recursive: true });
  const keys = [
    ...fixture.clips.filter((c) => c.id !== fixture.source.clipId).map((c) => c.file.storageKey),
    ...fixture.graphics.filter((g) => g.kind === "image" && g.file?.storageKey).map((g) => g.file!.storageKey),
  ];
  for (const key of keys) {
    const to = assetPath(dir, key);
    if (await exists(to)) continue;
    const res = await getObject(key);
    if (!res.ok || !res.body) {
      console.warn(`  storage said ${res.status} for ${key}`);
      continue;
    }
    await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(to));
    console.log(`  fetched ${path.basename(to)} (${((await stat(to)).size / 1e6).toFixed(1)} MB)`);
  }
}

/** The fixture's cutaway clips that are on disk, deduped by content name. */
async function localClips(fixture: Fixture, dir: string): Promise<{ path: string; durationMs: number; label: string }[]> {
  const out: { path: string; durationMs: number; label: string }[] = [];
  const seen = new Set<string>();
  for (const c of fixture.clips) {
    if (c.id === fixture.source.clipId) continue;
    const p = assetPath(dir, c.file.storageKey);
    if (!(await exists(p)) || seen.has(c.label)) continue;
    seen.add(c.label);
    out.push({ path: p, durationMs: c.durationMs ?? 10000, label: c.label });
  }
  const spare = "/tmp/dv2_lab/vision/pexels-28709421.mp4";
  if (!out.length && (await exists(spare))) out.push({ path: spare, durationMs: 8000, label: "pexels 28709421" });
  return out;
}

/* ------------------------------------------------------------- captions */

function assFromFixture(fixture: Fixture, presetKey: string): string {
  const zh = fixture.captions["zh-CN"] ?? [];
  const en = new Map((fixture.captions.en ?? []).map((c) => [c.startMs, c.text]));
  const cues: AssCue[] = zh.map((c) => ({
    startMs: c.startMs,
    endMs: c.endMs,
    text: c.text,
    words: c.words,
    keywords: c.keywords,
    second: en.get(c.startMs) ?? null,
  }));
  return toAss(cues, { presetKey, width: W, height: H, accent: fixture.project.accent });
}

/* ------------------------------------------------------------ furniture */

/** The v1 header / watermark / footnote rows as one merged still (header at 90 %). */
async function makeFurniture(fixture: Fixture, dir: string): Promise<string> {
  const out = path.join(dir, "furniture.png");
  if (await exists(out)) return out;
  const rows = fixture.graphics.filter((g) => ["header", "watermark", "footnote"].includes(g.kind));
  const specs: GraphicSpec[] = rows.map((g) => ({
    kind: g.kind as GraphicSpec["kind"], text: g.text, sub: g.sub, startMs: 0, endMs: 3000,
    placement: g.placement, scale: g.scale, enter: "fade",
  }));
  const work = path.join(dir, "furniture");
  await mkdir(work, { recursive: true });
  const files = await renderGraphics(specs, { width: W, height: H, accent: fixture.project.accent, dir: work });
  const args = ["-y", "-f", "lavfi", "-i", `color=c=black@0.0:s=${W}x${H},format=rgba`];
  for (const f of files) args.push("-i", f);
  /* The header goes through colorchannelmixer first (90 %), the rest as drawn. */
  const graph: string[] = [];
  let label = "[0:v]";
  files.forEach((_, i) => {
    const next = i === files.length - 1 ? "[out]" : `[f${i}]`;
    if (rows[i].kind === "header") {
      graph.push(`[${i + 1}:v]format=rgba,colorchannelmixer=aa=0.9[h${i}]`, `${label}[h${i}]overlay=0:0:format=auto${next}`);
    } else graph.push(`${label}[${i + 1}:v]overlay=0:0:format=auto${next}`);
    label = next;
  });
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args, "-filter_complex", graph.join(";"), "-map", "[out]", "-frames:v", "1", out]);
  return out;
}

/* --------------------------------------------------------- alpha clips */

const ZH_LABELS = [
  "154页", "1.51亿次", "3500多个账号", "近30万条", "十几倍", "63.5% vs 35.5%", "便宜6到9成", "2月→6月→9月",
  "Anthropic", "DeepSeek", "月之暗面 Kimi", "MiniMax", "阿里巴巴", "字节跳动", "美国参议院", "商务部",
  "蒸馏", "思维链", "技术套利", "护城河", "01 罕见联手", "02 中方回应", "03 第三条路", "04 分水岭",
];

/**
 * A stand-in for W4's Remotion clips: 45 VP9-alpha pieces made by ffmpeg —
 * 30 through-animated (`full`, 2.5 s, a line of Noto Black rising and
 * fading over a translucent accent bar) and 15 in/hold/out sets (12 frames
 * in, one PNG hold, 6 frames out). Each is the size of a Zone-T bounding
 * box (952×300) and is decoded with libvpx to keep its alpha, exactly as
 * the real ones will be.
 */
async function makeAlphaClips(dir: string, accent: string): Promise<MotionClip[]> {
  const clipsDir = path.join(dir, "alpha");
  await mkdir(clipsDir, { recursive: true });
  const w = 952;
  const h = 300;
  const font = (await exists(BLACK)) ? BLACK : "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc";
  const acc = accent.replace("#", "0x");
  const text = (i: number) => ZH_LABELS[i % ZH_LABELS.length].replace(/\\/g, "").replace(/:/g, "\\:").replace(/'/g, "");
  const draw = (i: number, alphaExpr: string, yExpr: string) =>
    `drawbox=x=0:y=ih-8:w=iw:h=8:color=${acc}@0.9:t=fill,` +
    `drawtext=fontfile=${font}:text='${text(i)}':fontsize=110:fontcolor=white:borderw=4:bordercolor=0x0E0E10:x=(w-tw)/2:y='${yExpr}':alpha='${alphaExpr}'`;
  const vp9 = ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "32", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-auto-alt-ref", "0"];
  const jobs: (() => Promise<void>)[] = [];
  const clips: MotionClip[] = [];
  for (let i = 0; i < 45; i++) {
    const id = `m${String(i).padStart(2, "0")}`;
    const box = { x: 64, y: 260 + (i % 3) * 40, w, h };
    if (i % 3 !== 2) {
      const full = path.join(clipsDir, `${id}.webm`);
      clips.push({ id, startMs: 0, endMs: 2500, ...box, parts: { full } });
      if (!(await exists(full))) {
        jobs.push(() =>
          run("ffmpeg", [
            "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=black@0.0:s=${w}x${h}:r=30:d=2.5,format=rgba`,
            "-vf", draw(i, "min(1,t/0.3)*min(1,(2.5-t)/0.18)", "(h-th)/2+40*(1-min(1,t/0.3))"), ...vp9, full,
          ]).then(() => {}),
        );
      }
    } else {
      const inFile = path.join(clipsDir, `${id}-in.webm`);
      const hold = path.join(clipsDir, `${id}-hold.png`);
      const outFile = path.join(clipsDir, `${id}-out.webm`);
      clips.push({ id, startMs: 0, endMs: 3500, ...box, parts: { in: inFile, hold, out: outFile } });
      if (!(await exists(outFile))) {
        jobs.push(async () => {
          await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=black@0.0:s=${w}x${h}:r=30:d=0.4,format=rgba`,
            "-vf", draw(i, "min(1,t/0.3)", "(h-th)/2+40*(1-min(1,t/0.3))"), "-frames:v", "12", ...vp9, inFile]);
          await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=black@0.0:s=${w}x${h},format=rgba`,
            "-vf", draw(i, "1", "(h-th)/2"), "-frames:v", "1", hold]);
          await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=black@0.0:s=${w}x${h}:r=30:d=0.2,format=rgba`,
            "-vf", draw(i, "1-min(1,t/0.18)", "(h-th)/2"), "-frames:v", "6", ...vp9, outFile]);
        });
      }
    }
  }
  /* Six at a time, like W4's renderer. */
  for (let i = 0; i < jobs.length; i += 6) await Promise.all(jobs.slice(i, i + 6).map((j) => j()));
  const real = "/tmp/dv2_lab/rm_vp9.webm";
  if (await exists(real)) clips[0] = { ...clips[0], x: 0, y: 0, w: W, h: H, parts: { full: real } };
  return clips;
}

/* -------------------------------------------------------------- plans */

type Piece = { inMs: number; outMs: number; startMs: number; lengthMs: number };

function pieces(fixture: Fixture): Piece[] {
  let t = 0;
  return fixture.timeline
    .filter((p) => p.kind === "clip" && p.clipId === fixture.source.clipId)
    .sort((a, b) => a.ord - b.ord)
    .map((p) => {
      const outMs = p.outMs ?? fixture.source.durationMs;
      const piece = { inMs: p.inMs, outMs, startMs: t, lengthMs: outMs - p.inMs };
      t += piece.lengthMs;
      return piece;
    });
}

/** The v1 plan, as `loadRenderInput` would build it from these rows. */
async function planV1(fixture: Fixture, dir: string, assFile: string): Promise<RenderInput> {
  const cuts: RenderCut[] = pieces(fixture).map((p) => ({ clipId: fixture.source.clipId, file: RAW, inMs: p.inMs, outMs: p.outMs, zoom: 1, anchor: [0.5, 0.42], join: { kind: "cut", ms: 0 } }));
  const stills: GraphicSpec[] = [];
  for (const g of fixture.graphics) {
    if (g.kind === "broll" || g.kind === "punch" || g.endMs <= g.startMs) continue;
    const imagePath = g.kind === "image" && g.file ? assetPath(dir, g.file.storageKey) : null;
    if (g.kind === "image" && !(imagePath && (await exists(imagePath)))) continue;
    if (g.kind !== "image" && !g.text.trim()) continue;
    stills.push({ kind: g.kind as GraphicSpec["kind"], text: g.text, sub: g.sub, startMs: g.startMs, endMs: g.endMs, imagePath, imageMime: g.file?.mime ?? null, icon: g.icon, placement: g.placement, scale: g.scale, enter: String(g.options.enter ?? "fade") });
  }
  const brolls: BrollSpec[] = [];
  for (const g of fixture.graphics.filter((g) => g.kind === "broll" && g.endMs > g.startMs)) {
    const clip = fixture.clips.find((c) => c.id === String(g.options.clipId ?? ""));
    const local = clip ? assetPath(dir, clip.file.storageKey) : null;
    if (!clip || !local || !(await exists(local))) continue;
    const sourceInMs = Math.max(0, Number(g.options.sourceInMs ?? 0) || 0);
    const available = clip.durationMs ? clip.durationMs - sourceInMs : null;
    const length = available === null ? g.endMs - g.startMs : Math.min(g.endMs - g.startMs, available);
    if (length < 200) continue;
    brolls.push({ path: local, startMs: g.startMs, endMs: g.startMs + length, sourceInMs, placement: g.placement || "full", scale: g.scale ?? 34 });
  }
  const punches: PunchSpec[] = fixture.graphics
    .filter((g) => g.kind === "punch" && g.endMs > g.startMs)
    .map((g) => ({ startMs: g.startMs, endMs: g.endMs, zoom: Number(g.options.zoom ?? 1.15) || 1.15 }))
    .sort((a, b) => a.startMs - b.startMs)
    .filter((p, i, all) => i === 0 || p.startMs >= all[i - 1].endMs);
  return {
    width: W, height: H, fps: 30, mode: "v1", accent: fixture.project.accent, workDir: path.join(dir, "a"),
    cuts, cutaways: [], motion: [], assFile, audio: { voiceChain: false, cutFadeMs: 12 }, stills, brolls, punches, tracks: [],
  };
}

/**
 * The synthetic v2 plan on the fixture's cut: alternating framing on the
 * measured face, the three v1 punch spots as snap pushes, a slow push on
 * every take over six seconds without one, twenty cutaways across the three
 * layouts, forty-five motion clips, the furniture, the captions, the voice
 * chain. What W6 will produce, in shape; the choices here are a schedule.
 */
async function planV2(fixture: Fixture, dir: string, assFile: string, track: FaceTrackDetail, furniture: string, motion: MotionClip[]): Promise<RenderPlan & RenderInput> {
  const base = minFramingZoom(track);
  const ps = pieces(fixture);
  const punchSpots = fixture.graphics.filter((g) => g.kind === "punch").map((g) => ({ startMs: g.startMs, endMs: g.endMs }));
  const toSource = (tMs: number) => {
    const p = ps.find((p) => tMs >= p.startMs && tMs < p.startMs + p.lengthMs);
    return p ? { p, sMs: p.inMs + (tMs - p.startMs) } : null;
  };
  const cuts: RenderCut[] = ps.map((p, i) => {
    /* Each cut framed on the face as it is in that cut, at the take's base
       zoom alternated 1 : 1.12 (the compositor raises a cut whose own eye
       line would still sit under the band). */
    const local = faceTrackFor(track, p.inMs, p.outMs);
    const anchor = faceAnchor(local);
    const zoom = Math.round(Math.max(base, minFramingZoom(local)) * (i % 2 === 0 ? 1 : 1.12) * 1000) / 1000;
    const cut: RenderCut = { clipId: fixture.source.clipId, file: RAW, inMs: p.inMs, outMs: p.outMs, zoom, anchor, faceHeight: local.box[3] };
    const snap = punchSpots.find((s) => s.startMs >= p.startMs && s.endMs <= p.startMs + p.lengthMs);
    if (snap) {
      const a = toSource(snap.startMs)!.sMs;
      const b = toSource(snap.endMs - 1)!.sMs + 1;
      cut.push = { fromMs: a, toMs: b, to: Math.round(base * 1.18 * 1000) / 1000, rampMs: 167 };
    } else if (p.lengthMs > 6000) {
      cut.push = { fromMs: p.inMs + 400, toMs: p.outMs, to: zoom + 0.05 };
    }
    return cut;
  });

  const clips = await localClips(fixture, dir);
  const stills = fixture.graphics.filter((g) => g.kind === "image" && g.file).map((g) => assetPath(dir, g.file!.storageKey));
  const stillFiles: string[] = [];
  for (const s of stills) if (await exists(s)) stillFiles.push(s);
  const total = ps.reduce((a, p) => a + p.lengthMs, 0);
  const cutaways: RenderPlan["cutaways"] = [];
  const layouts: RenderPlan["cutaways"][number]["layout"][] = ["full", "split", "run", "run", "run", "full", "split", "full", "split", "run", "run", "run", "full", "split", "full", "split", "full", "split", "full", "full"];
  let t = 4200;
  let runNo = 0;
  let k = 0;
  for (let i = 0; i < 20 && t < total - 8000; i++) {
    const layout = layouts[i];
    const clip = clips[k++ % clips.length];
    const isStill = layout === "full" && stillFiles.length > 0 && (i === 7 || i === 16);
    if (layout === "run") {
      /* Three back to back, 2.6 s each, one circle for the group. */
      const runId = `run${runNo}`;
      for (let j = 0; j < 3; j++) {
        const c = clips[k++ % clips.length];
        cutaways.push({ file: c.path, startMs: t, endMs: t + 2600, sourceInMs: 1000 + j * 700, cropX: 0.5, still: false, layout: "run", runId });
        t += 2600;
      }
      runNo++;
      i += 2;
      t += 9500;
      continue;
    }
    const dur = layout === "split" ? 3200 : isStill ? 2800 : 2400;
    cutaways.push({
      file: isStill ? stillFiles[Math.floor(i / 7) % stillFiles.length] : clip.path,
      startMs: t, endMs: t + dur, sourceInMs: isStill ? 0 : 1200, cropX: 0.5, still: isStill, layout,
    });
    t += dur + 10500;
  }

  /* Forty-five motion clips, one at a time in Zone T, about every 6 s,
     each moved past any cutaway it would overlap: one non-caption layer at
     a time is the rule (§1), and white text over a run would also spoil
     the circle measurement. */
  const placedMotion: MotionClip[] = [];
  let mt = 2000;
  for (const m of motion) {
    const len = m.endMs - m.startMs;
    let startMs = mt;
    for (let guard = 0; guard < 40; guard++) {
      const hit = cutaways.find((c) => startMs < c.endMs + 400 && startMs + len > c.startMs - 400);
      if (!hit) break;
      startMs = hit.endMs + 400;
    }
    if (startMs + len >= total - 500) break;
    placedMotion.push({ ...m, startMs, endMs: startMs + len });
    mt = startMs + len + 3200;
  }

  return {
    width: W, height: H, fps: 30, mode: "v2", accent: fixture.project.accent, workDir: path.join(dir, "b"),
    cuts, cutaways, motion: placedMotion, furniture, assFile, audio: { voiceChain: true, cutFadeMs: 12 },
  };
}

/* ------------------------------------------------------------ regress */

/**
 * The base commit's `buildArgs` and `joinCuts`, exported from a copy under
 * `scripts/.tmp/` (gitignored), plus the old inline cut loop typed here from
 * that source. Together they are the command the old renderer would have
 * built; the new `renderTimeline` in a dry run must build the same one.
 */
async function oldCommand(plan: RenderInput, dir: string, out: string): Promise<string[] | null> {
  const copy = path.join(process.cwd(), "scripts", ".tmp", "render-v1.ts");
  if (!(await exists(copy))) {
    await mkdir(path.dirname(copy), { recursive: true });
    const { stdout } = await run("git", ["show", "87c7898:lib/video/render.ts"], { maxBuffer: 4e6 });
    await writeFile(copy, stdout.replace("function joinCuts(", "export function joinCuts(").replace("function buildArgs(", "export function buildArgs("), "utf8");
  }
  const old = (await import(copy)) as {
    joinCuts: (cuts: { v: string; a: string; lengthMs: number; join: { kind: string; ms: number } }[]) => { filters: string[]; video: string; audio: string; overlapMs: number };
    buildArgs: (input: Record<string, unknown>) => string[];
  };
  const size = { w: plan.width, h: plan.height };
  const inputs: { path: string; ss: number; t: number }[] = [];
  const cuts: { v: string; a: string; lengthMs: number; join: { kind: string; ms: number } }[] = [];
  const pre: string[] = [];
  const audioOf = new Map<string, boolean>();
  for (const cut of plan.cuts) {
    const arrive = cuts.length === 0 ? { kind: "cut", ms: 0 } : (cut.join ?? { kind: "cut", ms: 0 });
    const n = cuts.length;
    if (cut.title) {
      const hold = Math.max(200, cut.outMs - cut.inMs);
      const safe = cut.title.text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").slice(0, 200);
      pre.push(
        `color=c=0x111111:s=${size.w}x${size.h}:r=30:d=${(hold / 1000).toFixed(3)},drawtext=text='${safe}':fontcolor=white:fontsize=${Math.round(size.w / 22)}:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=12,format=yuv420p,setsar=1[c${n}v]`,
        `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${(hold / 1000).toFixed(3)},asetpts=PTS-STARTPTS[c${n}a]`,
      );
      cuts.push({ v: `[c${n}v]`, a: `[c${n}a]`, lengthMs: hold, join: arrive });
      continue;
    }
    if (!audioOf.has(cut.file)) {
      const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", cut.file]);
      audioOf.set(cut.file, stdout.includes("audio"));
    }
    const inSec = cut.inMs / 1000;
    const outSec = Math.max(inSec + 0.05, cut.outMs / 1000);
    const lengthMs = Math.round((outSec - inSec) * 1000);
    const k = inputs.length;
    inputs.push({ path: cut.file, ss: inSec, t: outSec - inSec });
    pre.push(
      `[${k}:v]setpts=PTS-STARTPTS,scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2:color=black,fps=30,setsar=1,format=yuv420p[c${n}v]`,
      audioOf.get(cut.file)
        ? `[${k}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[c${n}a]`
        : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${(lengthMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS[c${n}a]`,
    );
    cuts.push({ v: `[c${n}v]`, a: `[c${n}a]`, lengthMs, join: arrive });
  }
  const joined = old.joinCuts(cuts);
  pre.push(...joined.filters);
  return old.buildArgs({
    inputs, pre, joinedV: joined.video, joinedA: joined.audio, assPath: plan.assFile ?? null,
    graphicFiles: (plan.stills ?? []).map((_, i) => path.join(dir, `graphic-${i}.png`)), graphicSpecs: plan.stills ?? [],
    brolls: plan.brolls ?? [], accent: plan.accent, punches: plan.punches ?? [], tracks: plan.tracks ?? [], size, out,
  });
}

/** A v1 plan with every legacy feature, at a size. */
async function legacyPlan(fixture: Fixture, dir: string, aspect: "16:9" | "1:1", clips: { path: string }[]): Promise<RenderInput> {
  const size = aspect === "16:9" ? { w: 1920, h: 1080 } : { w: 1080, h: 1080 };
  const work = path.join(dir, `regress-${aspect.replace(":", "x")}`);
  await mkdir(work, { recursive: true });
  const assFile = path.join(work, "captions.ass");
  const zh = (fixture.captions["zh-CN"] ?? []).slice(0, 8);
  await writeFile(assFile, toAss(zh.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text, keywords: c.keywords })), { presetKey: "clean", width: size.w, height: size.h, accent: fixture.project.accent }), "utf8");
  /* A short music bed for the ducked track: a 20 s tone made here. */
  const bed = path.join(work, "bed.mp3");
  if (!(await exists(bed))) await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=20", "-c:a", "libmp3lame", "-q:a", "5", bed]);
  const src = fixture.source.clipId;
  return {
    width: size.w, height: size.h, fps: 30, mode: "v1", accent: fixture.project.accent, workDir: work,
    /* 16:9 joins footage by a cut, a dissolve and a dip; 1:1 opens on a
       title card and cuts. Not both in one plan: a title card anywhere
       before a dissolve fails in v1 and in this copy alike (xfade refuses
       the title's 1/30 timebase against the footage's), so each plan keeps
       to what v1 renders today. */
    cuts:
      aspect === "16:9"
        ? [
            { clipId: src, file: RAW, inMs: 1210, outMs: 6000, zoom: 1, anchor: [0.5, 0.42], join: { kind: "cut", ms: 0 } },
            { clipId: src, file: RAW, inMs: 9156, outMs: 13000, zoom: 1, anchor: [0.5, 0.42], join: { kind: "dissolve", ms: 400 } },
            { clipId: src, file: RAW, inMs: 41160, outMs: 46000, zoom: 1, anchor: [0.5, 0.42], join: { kind: "dip", ms: 500 } },
          ]
        : [
            { clipId: "", file: "", inMs: 0, outMs: 1500, zoom: 1, anchor: [0.5, 0.42], join: { kind: "cut", ms: 0 }, title: { text: "蒸馏之战: a title's card" } },
            { clipId: src, file: RAW, inMs: 1210, outMs: 6000, zoom: 1, anchor: [0.5, 0.42], join: { kind: "cut", ms: 0 } },
            { clipId: src, file: RAW, inMs: 9156, outMs: 13000, zoom: 1, anchor: [0.5, 0.42], join: { kind: "cut", ms: 0 } },
            { clipId: src, file: RAW, inMs: 41160, outMs: 46000, zoom: 1, anchor: [0.5, 0.42], join: { kind: "cut", ms: 0 } },
          ],
    cutaways: [], motion: [], assFile, audio: { voiceChain: false, cutFadeMs: 12 },
    stills: [
      { kind: "title", text: "蒸馏之战", sub: null, startMs: 1800, endMs: 4000, placement: "center", scale: 30, enter: "pop" },
      { kind: "lower-third", text: "谢亚芳", sub: "你的新经济摆渡人", startMs: 6500, endMs: 9500, placement: "bottom-left", scale: 30, enter: "rise" },
    ],
    brolls: clips.length ? [{ path: clips[0].path, startMs: 10000, endMs: 12500, sourceInMs: 1000, placement: "pip", scale: 34 }] : [],
    punches: [{ startMs: 4500, endMs: 5800, zoom: 1.15 }],
    tracks: [{ path: bed, startMs: 0, gain: 0.3, duck: true }],
  };
}

/* ------------------------------------------------------------ measure */

async function ebur128(file: string): Promise<{ I: number; LRA: number; TP: number }> {
  const text = await new Promise<string>((resolve) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (c) => (err = (err + String(c)).slice(-6000)));
    child.on("close", () => resolve(err));
  });
  const num = (re: RegExp) => Number((re.exec(text) ?? [])[1]);
  return { I: num(/I:\s+(-?[\d.]+) LUFS/), LRA: num(/LRA:\s+([\d.]+) LU/), TP: num(/Peak:\s+(-?[\d.]+) dBFS/) };
}

/** Mono 48 kHz samples of a file as floats in −1..1. */
async function samplesOf(file: string): Promise<Float32Array> {
  const buf = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-ac", "1", "-ar", "48000", "-f", "s16le", "-"], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", reject);
    child.on("close", () => resolve(Buffer.concat(chunks)));
  });
  const out = new Float32Array(Math.floor(buf.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}

/**
 * Clicks at the cuts: the largest jump between neighbouring samples within
 * 6 ms of each boundary, against the same statistic over the rest of the
 * film. A join that clicks shows as a jump several times the speech's own.
 */
function clickCheck(pcm: Float32Array, boundariesMs: number[]): { worst: number; typical: number; over: number[] } {
  const maxDelta = (from: number, to: number) => {
    let m = 0;
    for (let i = Math.max(1, from); i < Math.min(pcm.length, to); i++) m = Math.max(m, Math.abs(pcm[i] - pcm[i - 1]));
    return m;
  };
  const win = Math.round(0.006 * 48000);
  const at = boundariesMs.map((ms) => {
    const c = Math.round((ms / 1000) * 48000);
    return maxDelta(c - win, c + win);
  });
  /* The typical: the 95th percentile of the same window measured every 0.5 s. */
  const typ: number[] = [];
  for (let c = win; c < pcm.length - win; c += 24000) typ.push(maxDelta(c - win, c + win));
  typ.sort((a, b) => a - b);
  const typical = typ[Math.floor(typ.length * 0.95)] ?? 0;
  const over = boundariesMs.filter((_, i) => at[i] > Math.max(0.25, typical * 2.5));
  return { worst: Math.max(...at, 0), typical, over };
}

/** A frame as 8-bit grey rows. */
async function greyFrame(file: string, tS: number, w: number, h: number): Promise<Uint8Array> {
  const buf = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-ss", tS.toFixed(3), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.on("error", reject);
    child.on("close", () => resolve(Buffer.concat(chunks)));
  });
  if (buf.length < w * h) throw new Error(`frame at ${tS} came out short`);
  return new Uint8Array(buf.buffer, buf.byteOffset, w * h);
}

/** Share of an edge strip that is black (≤ 18): bars from `pad` are 100 %. */
function edgeBlack(g: Uint8Array, w: number, h: number): { top: number; bottom: number; left: number; right: number } {
  const share = (xs: number[], ys: number[]) => {
    let n = 0;
    let k = 0;
    for (const y of ys) for (const x of xs) {
      n++;
      if (g[y * w + x] <= 18) k++;
    }
    return n ? k / n : 0;
  };
  const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i);
  return {
    top: share(range(0, w), range(0, 8)), bottom: share(range(0, w), range(h - 8, h)),
    left: share(range(0, 8), range(0, h)), right: share(range(w - 8, w), range(0, h)),
  };
}

/** The centroid of near-white pixels in a region, as shares of the frame. */
function ringCentroid(g: Uint8Array, w: number, region: { x0: number; y0: number; x1: number; y1: number }): { cx: number; cy: number; n: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = region.y0; y < region.y1; y++) for (let x = region.x0; x < region.x1; x++) {
    if (g[y * w + x] >= 235) {
      sx += x;
      sy += y;
      n++;
    }
  }
  return { cx: n ? sx / n : 0, cy: n ? sy / n : 0, n };
}

async function contactSheet(file: string, timesS: number[], out: string, label: (i: number) => string): Promise<void> {
  const dir = `${out}.frames`;
  await mkdir(dir, { recursive: true });
  const font = (await exists(BLACK)) ? BLACK : "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc";
  for (const [i, t] of timesS.entries()) {
    const text = `${t.toFixed(1)}s ${label(i)}`.replace(/\\/g, "").replace(/:/g, "\\:").replace(/'/g, "");
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", t.toFixed(3), "-i", file, "-frames:v", "1",
      "-vf", `scale=360:640,drawtext=fontfile=${font}:text='${text}':fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:x=6:y=6`, path.join(dir, `f${String(i).padStart(2, "0")}.jpg`)]);
  }
  const cols = 5;
  const rows = Math.ceil(timesS.length / cols);
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-framerate", "1", "-i", path.join(dir, "f%02d.jpg"),
    "-vf", `tile=${cols}x${rows}:padding=4:color=0x222222`, "-frames:v", "1", "-q:v", "4", out]);
}

/* --------------------------------------------------------------- main */

async function main() {
  await mkdir(OUT, { recursive: true });
  const fixture = JSON.parse(await readFile(FIXTURE, "utf8")) as Fixture;
  const timings: Record<string, number> = {};
  const report: Record<string, unknown> = { fixture: FIXTURE, raw: RAW, startedAt: new Date().toISOString() };
  const timed = async <T,>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    const r = await fn();
    timings[name] = Math.round((Date.now() - t0) / 100) / 10;
    console.log(`  ${name}: ${timings[name]} s`);
    return r;
  };

  /* ---- prep ---- */
  console.log("prep");
  if (FETCH) await fetchAssets(fixture, OUT);
  const track = await timed("faceTrack", () => faceTrackCached(RAW, { cacheDir: path.join(OUT, "cache"), clipId: fixture.source.clipId }));
  console.log(`  face: eye ${track.eyeY}, chin ${track.chinY}, box ${track.box.join(",")}, ${track.samples} samples; base zoom ${minFramingZoom(track)}`);
  report.face = { ...track, baseZoom: minFramingZoom(track) };
  const assFile = path.join(OUT, "captions.ass");
  await writeFile(assFile, assFromFixture(fixture, fixture.project.captionPreset || "bilingual"), "utf8");
  const clips = await localClips(fixture, OUT);
  console.log(`  ${clips.length} cutaway clips on disk`);
  let furniture = "";
  let motion: MotionClip[] = [];
  if (ONLY.has("prep") || ONLY.has("b")) {
    furniture = await timed("furniture", () => makeFurniture(fixture, OUT));
    motion = await timed("alphaClips", () => makeAlphaClips(OUT, fixture.project.accent));
  }

  /* ---- a: the v1 timeline ---- */
  const aOut = path.join(OUT, "a_v1.mp4");
  let aPlan: RenderInput | null = null;
  if (ONLY.has("a")) {
    console.log("a: v1 timeline through renderTimeline");
    aPlan = await planV1(fixture, OUT, assFile);
    await mkdir(aPlan.workDir!, { recursive: true });
    await writeFile(path.join(OUT, "a_plan.json"), JSON.stringify(aPlan, null, 1), "utf8");
    console.log(`  ${aPlan.cuts.length} cuts, ${aPlan.stills?.length} stills, ${aPlan.brolls?.length} brolls, ${aPlan.punches?.length} punches`);
    let encodeStart = 0;
    const r = await timed("a_total", () =>
      renderTimeline(aPlan!, aOut, (p) => {
        if (p.phase === "encode" && p.command !== undefined) encodeStart = Date.now();
      }),
    );
    timings.a_encode = Math.round((Date.now() - encodeStart) / 100) / 10;
    console.log(`  a: encode ${timings.a_encode} s for ${(r.durationMs / 1000).toFixed(1)} s`);
    await writeFile(path.join(OUT, "a_command.txt"), r.command, "utf8");
  }

  /* ---- b: the v2 plan ---- */
  const bOut = path.join(OUT, "b_v2.mp4");
  let bPlan: (RenderPlan & RenderInput) | null = null;
  if (ONLY.has("b")) {
    console.log("b: synthetic v2 plan");
    bPlan = await planV2(fixture, OUT, assFile, track, furniture, motion);
    await mkdir(bPlan.workDir!, { recursive: true });
    await writeFile(path.join(OUT, "b_plan.json"), JSON.stringify(bPlan, null, 1), "utf8");
    const by = (l: string) => bPlan!.cutaways.filter((c) => c.layout === l).length;
    console.log(`  ${bPlan.cuts.length} cuts (${bPlan.cuts.filter((c) => c.push).length} pushes), ${bPlan.cutaways.length} cutaways (full ${by("full")}, split ${by("split")}, run ${by("run")}), ${bPlan.motion.length} motion clips`);
    let encodeStart = 0;
    const r = await timed("b_total", () =>
      renderTimeline(bPlan!, bOut, (p) => {
        if (p.phase === "encode" && p.command !== undefined) encodeStart = Date.now();
      }),
    );
    timings.b_encode = Math.round((Date.now() - encodeStart) / 100) / 10;
    console.log(`  b: encode ${timings.b_encode} s for ${(r.durationMs / 1000).toFixed(1)} s`);
    await writeFile(path.join(OUT, "b_command.txt"), r.command, "utf8");
  }

  /* ---- regress: v1 command identity + short renders at 16:9 and 1:1 ---- */
  if (ONLY.has("regress")) {
    console.log("regress: v1 command against the base commit");
    const results: Record<string, unknown> = {};
    for (const aspect of ["16:9", "1:1"] as const) {
      const plan = await legacyPlan(fixture, OUT, aspect, clips);
      const out = path.join(plan.workDir!, "new.mp4");
      const mine = await renderTimeline(plan, out, undefined, { dryRun: true });
      const theirs = await oldCommand(plan, plan.workDir!, out);
      const same = theirs !== null && theirs.length === mine.args.length && theirs.every((a, i) => a === mine.args[i]);
      let firstDiff: string | null = null;
      if (!same && theirs) {
        const i = theirs.findIndex((a, i) => a !== mine.args[i]);
        firstDiff = `arg ${i}: old=${theirs[i]?.slice(0, 300)} new=${mine.args[i]?.slice(0, 300)}`;
      }
      console.log(`  ${aspect}: ${same ? "identical command" : `DIFFERENT (${firstDiff})`}`);
      const r = await timed(`regress_${aspect}`, () => renderTimeline(plan, out));
      const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "csv=p=0", out]);
      results[aspect] = { identical: same, firstDiff, durationMs: r.durationMs, probe: stdout.trim().replace(/\n/g, " ") };
    }
    report.regress = results;
  }

  /* ---- measure ---- */
  if (ONLY.has("measure")) {
    console.log("measure");
    const m: Record<string, unknown> = {};
    if (!bPlan) bPlan = await planV2(fixture, OUT, assFile, track, furniture || path.join(OUT, "furniture.png"), await makeAlphaClips(OUT, fixture.project.accent));
    if (await exists(bOut)) {
      const total = bPlan.cuts.reduce((a, c) => a + (c.outMs - c.inMs), 0);
      /* Host-visible moments: every 2 s, clear of every cutaway by 0.3 s. */
      const busy = (t: number) => bPlan!.cutaways.some((c) => t * 1000 > c.startMs - 300 && t * 1000 < c.endMs + 300);
      const hostTimes: number[] = [];
      for (let t = 1; t < total / 1000 - 1; t += 2) if (!busy(t)) hostTimes.push(t);
      const samples = await timed("eyeLine", () => faceSamples(bOut, hostTimes));
      const eyes = samples.map((s) => s.eyeY).filter((e): e is number => e !== null);
      const inBand = eyes.filter((e) => e >= 0.3 && e <= 0.38).length;
      m.eyeLine = { sampled: samples.length, detected: eyes.length, inBand, share: eyes.length ? inBand / eyes.length : 0, min: Math.min(...eyes), max: Math.max(...eyes), outliers: samples.filter((s) => s.eyeY !== null && (s.eyeY < 0.3 || s.eyeY > 0.38)).map((s) => ({ t: s.t, eyeY: s.eyeY })) };
      console.log(`  eye line: ${inBand}/${eyes.length} in 30–38 % (min ${Math.min(...eyes).toFixed(3)}, max ${Math.max(...eyes).toFixed(3)})`);

      /* full: no bars. */
      const fulls = bPlan.cutaways.filter((c) => c.layout === "full");
      const bars = [];
      for (const c of fulls) {
        const g = await greyFrame(bOut, (c.startMs + c.endMs) / 2000, W, H);
        bars.push({ t: (c.startMs + c.endMs) / 2000, ...edgeBlack(g, W, H) });
      }
      /* Bars from `pad` are a strip that is black to the pixel AND unlike the
         strip beside it; dark footage is dark on both. */
      const barred = bars.filter((b) => Math.max(b.top, b.bottom, b.left, b.right) > 0.98);
      m.fullBars = { checked: bars.length, barred: barred.length, worst: Math.max(...bars.map((b) => Math.max(b.top, b.bottom, b.left, b.right)), 0), samples: bars };
      console.log(`  full cutaways with a black edge strip: ${barred.length}/${bars.length}`);

      /* split: the band is the clip across the whole width — its left and
         right edge strips change against the frame before the cutaway. */
      const geo = layoutGeometry({ width: W, height: H });
      const splits = bPlan.cutaways.filter((c) => c.layout === "split");
      const bandChecks = [];
      for (const c of splits) {
        const mid = (c.startMs + c.endMs) / 2000;
        const g = await greyFrame(bOut, mid, W, H);
        const before = await greyFrame(bOut, c.startMs / 1000 - 0.25, W, H);
        const y0 = geo.split.y + 40;
        const y1 = geo.split.y + geo.split.h - 40;
        const stripDiff = (x0: number, x1: number) => {
          let d = 0;
          let n = 0;
          for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x++) {
            d += Math.abs(g[y * W + x] - before[y * W + x]);
            n++;
          }
          return d / n;
        };
        bandChecks.push({ t: mid, leftEdge: stripDiff(0, 8), rightEdge: stripDiff(W - 8, W), middle: stripDiff(W / 2 - 4, W / 2 + 4) });
      }
      m.split = { checked: bandChecks.length, edgesChanged: bandChecks.filter((b) => b.leftEdge > 8 && b.rightEdge > 8).length, samples: bandChecks };
      console.log(`  split bands changed to both edges: ${(m.split as { edgesChanged: number }).edgesChanged}/${bandChecks.length}`);

      /* run: the circle's centre. */
      const runs = bPlan.cutaways.filter((c) => c.layout === "run");
      const circles = [];
      for (const c of runs) {
        const mid = (c.startMs + c.endMs) / 2000;
        const g = await greyFrame(bOut, mid, W, H);
        const { d, x, y } = geo.run;
        const r = ringCentroid(g, W, { x0: x - 30, y0: y - 30, x1: x + d + 30, y1: y + d + 30 });
        circles.push({ t: mid, cx: r.cx / W, cy: r.cy / H, n: r.n });
      }
      const off = circles.map((c) => Math.max(Math.abs(c.cx - 0.74), Math.abs(c.cy - 0.31)));
      m.runCircle = { checked: circles.length, within2pct: off.filter((o) => o <= 0.02).length, worstOffset: Math.max(...off, 0), samples: circles };
      console.log(`  run circles within 2 %: ${(m.runCircle as { within2pct: number }).within2pct}/${circles.length} (worst ${Math.max(...off, 0).toFixed(4)})`);

      /* loudness + clicks. */
      const loud = await timed("ebur128", () => ebur128(bOut));
      m.loudness = loud;
      console.log(`  loudness I ${loud.I} LUFS, LRA ${loud.LRA}, TP ${loud.TP}`);
      const pcm = await samplesOf(bOut);
      const bounds: number[] = [];
      let t = 0;
      for (const c of bPlan.cuts) {
        t += c.outMs - c.inMs;
        bounds.push(t);
      }
      bounds.pop();
      const clicks = clickCheck(pcm, bounds);
      m.clicks = clicks;
      console.log(`  clicks: worst delta ${clicks.worst.toFixed(3)} vs typical ${clicks.typical.toFixed(3)}; ${clicks.over.length} boundaries over`);
      const clickDir = path.join(OUT, "clicks");
      await mkdir(clickDir, { recursive: true });
      for (const b of bounds.slice(0, 10)) {
        await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", sec(Math.max(0, b - 600)), "-t", "1.2", "-i", bOut, "-vn", "-ac", "1", path.join(clickDir, `cut_${Math.round(b / 1000)}s.wav`)]);
      }

      /* contact sheets: every cutaway's midpoint, and every fourth motion clip's. */
      const sheetTimes = [
        ...bPlan.cutaways.map((c) => ({ t: (c.startMs + c.endMs) / 2000, l: `${c.layout}${c.still ? " still" : ""}` })),
        ...bPlan.motion.filter((_, i) => i % 5 === 0).map((c) => ({ t: (c.startMs + c.endMs) / 2000, l: `motion ${c.id}` })),
        ...bPlan.cuts.filter((c) => c.push).map((c, i) => ({ t: (bPlan!.cuts.slice(0, bPlan!.cuts.indexOf(c)).reduce((a, x) => a + x.outMs - x.inMs, 0) + (c.push!.toMs - c.inMs) - 200) / 1000, l: `push ${i}` })),
      ].sort((a, b) => a.t - b.t);
      await timed("sheet_b", () => contactSheet(bOut, sheetTimes.map((s) => s.t), path.join(OUT, "sheet_b.jpg"), (i) => sheetTimes[i].l));
    }
    if (await exists(aOut)) {
      m.loudnessA = await ebur128(aOut);
      const times = Array.from({ length: 20 }, (_, i) => 8 + i * 14.5);
      await contactSheet(aOut, times, path.join(OUT, "sheet_a.jpg"), () => "v1");
    }
    report.measure = m;
  }

  report.timings = timings;
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(OUT, "report.json"), JSON.stringify(report, null, 1), "utf8");
  console.log(`report: ${path.join(OUT, "report.json")}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  /* The storage client pulls in the database pool, whose idle connections
     would keep the process alive for a while after the work is done. */
  .finally(() => process.exit(process.exitCode ?? 0));
