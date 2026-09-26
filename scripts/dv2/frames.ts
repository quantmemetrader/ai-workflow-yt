/**
 * Frames off a rendered reel, for the vision model and for a person.
 *
 * `sampleFrames(mp4, input)` picks the moments worth looking at — just after
 * every cut, just after every graphic lands and at its midpoint, the middle
 * of every cutaway, and a tick every five seconds — pulls each one as a
 * clean 540×960 JPEG (what `checkFrame` sees, with nothing drawn on it),
 * then builds the human view: 4×3 contact sheets of 360×640 tiles with the
 * time and the spoken line burned into each tile, and 15 fps motion strips
 * around six key moments (the hook, the first counter, a comparison, a
 * stinger, a cutaway entrance, an entity card) so eased entrances and
 * word-synced landings can be judged frame by frame.
 *
 * Everything is ffmpeg with an argv array; eight extractions run at a
 * time; nothing is written outside `opts.out`. The labels go through
 * `textfile=` with `expansion=none`, so a caption with a colon or a percent
 * sign is drawn as written rather than parsed as filter syntax.
 */
import { execFile } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FURNITURE_KINDS, cutBoundaries, totalMs, type GradeInput } from "./metrics";

const run = promisify(execFile);

export type SampledFrame = { index: number; tMs: number; why: string; file: string; line: string };
export type MotionStrip = { name: string; nameZh: string; tMs: number; file: string; kind: string };
export type FrameSet = { frames: SampledFrame[]; sheets: string[]; strips: MotionStrip[]; tiles: string[] };

/** Fonts a label can be drawn in, first found wins. */
const LABEL_FONTS = [
  path.join(process.cwd(), "remotion", "public", "fonts", "NotoSansCJKsc-Bold.otf"),
  path.join(process.cwd(), "remotion", "public", "fonts", "NotoSansCJKsc-Black.otf"),
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
];

const exists = async (p: string) => Boolean(await stat(p).catch(() => null));

async function labelFont(): Promise<string | null> {
  for (const f of LABEL_FONTS) if (await exists(f)) return f;
  return null;
}

/** Run up to `n` promises at a time, in order of submission. */
export async function pmap<T, R>(items: T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}.${String(Math.floor((ms % 1000) / 100))}`;

/**
 * The moments to sample, deduplicated within 150 ms and capped at `max`:
 * the five-second ticks give way first, because the event-driven moments
 * are the ones that can be wrong.
 */
export function frameTimes(input: GradeInput, max = 150): { tMs: number; why: string }[] {
  const total = totalMs(input);
  const wanted: { tMs: number; why: string; priority: number }[] = [];
  for (const b of cutBoundaries(input.cuts)) wanted.push({ tMs: b + 100, why: "cut+100ms", priority: 1 });
  for (const g of input.graphics) {
    if (g.furniture || FURNITURE_KINDS.has(g.kind)) continue;
    wanted.push({ tMs: g.startMs + 150, why: `${g.kind} in`, priority: 0 }, { tMs: Math.round((g.startMs + g.endMs) / 2), why: `${g.kind} mid`, priority: 1 });
  }
  input.cutaways.forEach((c, i) => wanted.push({ tMs: Math.round((c.startMs + c.endMs) / 2), why: `cutaway#${i} ${c.layout} mid`, priority: 0 }));
  for (let t = 5000; t < total - 500; t += 5000) wanted.push({ tMs: t, why: "5s tick", priority: 2 });
  wanted.sort((a, b) => a.tMs - b.tMs || a.priority - b.priority);
  const picked: { tMs: number; why: string; priority: number }[] = [];
  for (const w of wanted) {
    if (w.tMs < 0 || w.tMs > total - 40) continue;
    const last = picked[picked.length - 1];
    if (last && w.tMs - last.tMs < 150) {
      if (w.priority < last.priority) picked[picked.length - 1] = w;
      continue;
    }
    picked.push(w);
  }
  /* Over the cap: drop the ticks, then the midpoints, keeping time order. */
  let out = picked;
  for (const level of [2, 1]) {
    if (out.length <= max) break;
    const keep = out.filter((w) => w.priority < level);
    const drop = out.filter((w) => w.priority === level);
    const room = Math.max(0, max - keep.length);
    const step = drop.length && room ? drop.length / room : Infinity;
    const kept = drop.filter((_, i) => room > 0 && Math.floor(i % step) === 0).slice(0, room);
    out = [...keep, ...kept].sort((a, b) => a.tMs - b.tMs);
  }
  return out.slice(0, max).map(({ tMs, why }) => ({ tMs, why }));
}

/** The caption on screen at a moment, for the tile label. */
export function lineAt(input: GradeInput, tMs: number): string {
  const c = input.captions.find((c) => tMs >= c.startMs && tMs <= c.endMs);
  return c?.text ?? "";
}

/** The six key moments, with fallbacks for a v1 render that has no v2 kinds. */
export function keyMoments(input: GradeInput): { name: string; nameZh: string; tMs: number; kind: string }[] {
  const g = (kinds: string[], pick: (rows: GradeInput["graphics"]) => GradeInput["graphics"][number] | undefined = (rows) => rows[0]) => {
    for (const k of kinds) {
      const rows = input.graphics.filter((x) => x.kind === k && !x.furniture).sort((a, b) => a.startMs - b.startMs);
      const hit = pick(rows);
      if (hit) return { tMs: hit.startMs, kind: hit.kind };
    }
    return null;
  };
  const out: { name: string; nameZh: string; tMs: number; kind: string }[] = [];
  const add = (name: string, nameZh: string, m: { tMs: number; kind: string } | null) => {
    if (m) out.push({ name, nameZh, tMs: m.tMs, kind: m.kind });
  };
  add("hook", "开场", g(["hook", "title", "statement"]));
  add("counter", "计数", g(["counter", "stat"]));
  add("compare", "对比", g(["compare"]) ?? g(["stat"], (rows) => rows.find((r) => Boolean(r.sub))));
  add("stinger", "章节转场", g(["stinger", "chapter"]));
  const first = [...input.cutaways].sort((a, b) => a.startMs - b.startMs)[0];
  if (first) out.push({ name: "cutaway", nameZh: "切出镜头入场", tMs: first.startMs, kind: `cutaway:${first.layout}` });
  add("entity", "机构卡", g(["entity", "image", "chip"]));
  return out;
}

/**
 * Sample, label, tile and strip.
 *
 * `frames` are the clean JPEGs for the vision check; `sheets` and `strips`
 * are for people. `width`/`height` size the clean frames (720×1280 keeps
 * the small type readable to the model at under half the tokens of 1080p).
 */
export async function sampleFrames(
  mp4: string,
  input: GradeInput,
  opts: { out: string; max?: number; width?: number; height?: number; concurrency?: number },
): Promise<FrameSet> {
  const out = opts.out;
  /* 720×1280 for the vision check: at 540 wide the 26 px footnote and the
     36 px English line read as smudges and the model files them as
     low-contrast text; at 720 they are letters. */
  const W = opts.width ?? 720;
  const H = opts.height ?? 1280;
  const n = opts.concurrency ?? 8;
  const framesDir = path.join(out, "frames");
  const tilesDir = path.join(out, "tiles");
  const sheetsDir = path.join(out, "sheets");
  const stripsDir = path.join(out, "strips");
  await Promise.all([framesDir, tilesDir, sheetsDir, stripsDir].map((d) => mkdir(d, { recursive: true })));
  const font = await labelFont();
  const times = frameTimes(input, opts.max ?? 150);

  /* Clean frames. Input seeking (`-ss` before `-i`) lands on the nearest
     keyframe and decodes forward, which is a few hundred milliseconds each
     on a 300 s x264 file; eight at a time keeps the whole set under ten
     seconds. */
  const frames: SampledFrame[] = await pmap(times, n, async (t, i) => {
    const file = path.join(framesDir, `f${String(i).padStart(3, "0")}.jpg`);
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", (t.tMs / 1000).toFixed(3), "-i", mp4, "-frames:v", "1", "-vf", `scale=${W}:${H}`, "-q:v", "3", file], { timeout: 60_000 });
    return { index: i, tMs: t.tMs, why: t.why, file, line: lineAt(input, t.tMs) };
  });

  /* Labelled tiles: time, reason, spoken line, in a box at the top-left. */
  const tiles: string[] = await pmap(frames, n, async (f) => {
    const tile = path.join(tilesDir, `t${String(f.index).padStart(3, "0")}.jpg`);
    const textFile = path.join(tilesDir, `t${String(f.index).padStart(3, "0")}.txt`);
    await writeFile(textFile, `${fmt(f.tMs)} ${f.why}\n${f.line.slice(0, 22)}`, "utf8");
    const label = font ? `,drawtext=fontfile=${font}:textfile=${textFile}:expansion=none:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=6:x=6:y=6:line_spacing=3` : "";
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", f.file, "-vf", `scale=360:640${label}`, "-q:v", "4", tile], { timeout: 60_000 });
    return tile;
  });

  /* 4×3 sheets of twelve. Each sheet's tiles are numbered from zero so the
     image2 demuxer picks them up in order. */
  const sheets: string[] = [];
  for (let s = 0; s * 12 < tiles.length; s++) {
    const group = tiles.slice(s * 12, s * 12 + 12);
    const listDir = path.join(tilesDir, `s${String(s).padStart(2, "0")}`);
    await mkdir(listDir, { recursive: true });
    await Promise.all(group.map((t, k) => run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", t, "-q:v", "4", path.join(listDir, `${String(k).padStart(2, "0")}.jpg`)], { timeout: 30_000 })));
    const sheet = path.join(sheetsDir, `sheet-${String(s).padStart(2, "0")}.jpg`);
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-framerate", "1", "-i", path.join(listDir, "%02d.jpg"), "-vf", "tile=4x3:padding=4:margin=4:color=0x1a1a1a", "-frames:v", "1", "-q:v", "4", sheet], { timeout: 60_000 });
    sheets.push(sheet);
  }

  /* Motion strips: 18 frames at 15 fps from 100 ms before the moment, tiled
     9×2 at 180×320, so an entrance of 250–350 ms shows as four or five
     frames of movement and a landing can be read to ±67 ms. */
  const strips: MotionStrip[] = [];
  for (const m of keyMoments(input)) {
    const file = path.join(stripsDir, `strip-${m.name}.jpg`);
    const from = Math.max(0, m.tMs - 100) / 1000;
    const textFile = path.join(stripsDir, `strip-${m.name}.txt`);
    await writeFile(textFile, `${m.name} ${m.kind} @ ${fmt(m.tMs)}  (15 fps from -0.1 s; each frame 67 ms)`, "utf8");
    const label = font ? `,drawtext=fontfile=${font}:textfile=${textFile}:expansion=none:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=6:x=8:y=8` : "";
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", from.toFixed(3), "-t", "1.25", "-i", mp4, "-vf", `fps=15,scale=180:320,tile=9x2:padding=2:margin=2:color=0x1a1a1a${label}`, "-frames:v", "1", "-q:v", "4", file], { timeout: 90_000 });
    strips.push({ ...m, file });
  }

  return { frames, sheets, strips, tiles };
}
