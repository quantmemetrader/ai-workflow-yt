import "server-only";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { V2 } from "@/remotion/src/theme";
import type { GraphicSpecV2, MotionClip } from "@/lib/video/v2/types";

/**
 * Director v2's graphics as motion clips (PLAN.md §2 W4, `motion.ts`).
 *
 * v1 drew every graphic as one PNG and let FFmpeg fade and nudge it. That
 * is the right trade for a title that sits still, and the wrong one for a
 * number that has to count up to the figure being said, bars that grow in
 * turn, or three lines landing on three words: those are motion, and the
 * only honest way to get them is to let Remotion draw the frames.
 *
 * So each `GraphicSpecV2` becomes one `MotionClip`: transparent VP9 parts
 * cropped to the box the graphic occupies (a Zone-T card is 1080×500, not
 * 1080×1920), drawn by `remotion/render-clips.mjs` in one browser. Kinds
 * whose picture keeps changing are one clip (`parts.full`); kinds that are
 * still after their entrance are `in` (12 frames) + `hold` (one PNG) +
 * `out` (6 frames), which the compositor loops — eighteen frames instead of
 * a hundred, and a four-minute reel's forty-five graphics render in the
 * plan's budget (cold ≤ 150 s at six tabs, warm ≤ 10 s).
 *
 * Every clip is cached under `remotion/.clips/<key>` where the key is a
 * hash of the props, the frame, the mode and the bundle generation (which
 * changes whenever a composition source changes), so a re-render of the
 * same project draws nothing and an edited template draws fresh.
 *
 * Failure is per graphic, never per render: a clip that fails is rendered
 * again as a single still through the same composition (`mode: "still"`),
 * and if even that fails the graphic is left out with a warning. This
 * function does not throw for a render problem. (The plan names
 * `renderGraphics` as the still fallback; that path cannot carry a v2
 * template's `options`, so the still is drawn by the same `Clip`
 * composition instead, which is the picture the clip would have had.)
 */
const PROJECT = path.join(process.cwd(), "remotion");
const CACHE = path.join(PROJECT, ".clips");
const RENDERER = "render-clips.mjs";

/** Bumped when a template's look changes in a way the bundle hash would not catch (it always does; this is belt and braces). */
export const TEMPLATE_VERSION = 1;

/** Kinds whose picture keeps changing after the entrance: always one clip. Mirrors `THROUGH_ANIMATED` in `remotion/src/v2.tsx`. */
export const THROUGH_ANIMATED: ReadonlySet<string> = new Set(["hook", "counter", "compare", "list", "diagram", "stinger"]);

/** The in/hold/out split the compositor loops: `in` is the first 12 frames, `out` the last 6. */
export const MOTION_SEGMENTS = { inFrames: V2.inFrames, outFrames: V2.outFrames } as const;

export type Box = { x: number; y: number; w: number; h: number };
export type ClipMode = "full" | "segments" | "still";

export type MotionOptions = {
  width: number;
  height: number;
  accent: string;
  /** Where the clip parts are copied for this render (self-contained, like the stills). */
  dir: string;
  fps?: number;
  /** Chrome tabs in all; `DV2_CONCURRENCY`, default 6. */
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
  /** Ceiling on one renderer run; the default grows with the clip count. */
  timeoutMs?: number;
  log?: (line: string) => void;
};

export type ClipPlan = {
  id: string;
  kind: string;
  mode: ClipMode;
  seconds: number;
  startMs: number;
  endMs: number;
  box: Box;
  /** The `Clip` composition's props, exactly as the renderer receives them. */
  props: Record<string, unknown>;
  key: string;
};

/* ------------------------------------------------------------- pure cores */

/** The v2 templates, which draw in the zone the row names. */
const V2_KINDS: ReadonlySet<string> = new Set(["hook", "counter", "compare", "list", "entity", "chip", "headline", "term", "diagram", "stinger"]);

/**
 * The frame box a graphic of `zone` is rendered into, scaled from the
 * 1080×1920 reference. `end-card` is always the whole frame and `chip`
 * always the corner, whatever the row says, because that is where the
 * template draws them. A v1 kind draws where its own template puts it
 * (`stat` in the middle, `card` at the lower third, `chapter` under the
 * header…), so it gets the whole frame unless it is one this code knows
 * the v2 director moves: `statement` into Zone T, and a `lower-third` with
 * `zone: "lower"` into the lower zone. Cropping a v1 kind to a zone it
 * does not draw in would render an empty clip.
 */
export function boxForZone(zone: string | undefined, kind: string, width: number, height: number): Box {
  const zoned = zone === "full" || zone === "lower" || zone === "corner" ? zone : "T";
  const name =
    kind === "end-card" ? "full"
    : kind === "chip" ? "corner"
    : V2_KINDS.has(kind) ? zoned
    : kind === "statement" ? "T"
    : kind === "lower-third" && zone === "lower" ? "lower"
    : "full";
  const ref = V2.boxes[name];
  const sx = width / V2.frame.width;
  const sy = height / V2.frame.height;
  const x = Math.max(0, Math.round(ref.x * sx));
  const y = Math.max(0, Math.round(ref.y * sy));
  const w = Math.max(2, Math.min(width - x, Math.round(ref.w * sx)));
  const h = Math.max(2, Math.min(height - y, Math.round(ref.h * sy)));
  /* VP9 wants even dimensions. */
  return { x, y, w: w - (w % 2), h: h - (h % 2) };
}

/** One clip for a through-animated kind or anything too short to split; in/hold/out for the rest. */
export function clipMode(kind: string, seconds: number, fps: number): ClipMode {
  if (THROUGH_ANIMATED.has(kind)) return "full";
  if (Math.round(seconds * fps) < V2.inFrames + V2.outFrames + 2) return "full";
  return "segments";
}

/**
 * When the parts of a segmented clip play, in timeline ms: `in` from
 * `startMs`, the hold from `inEndMs` to `outStartMs`, `out` from there to
 * `endMs`. A `full` clip simply plays from `startMs`.
 */
export function segmentTimes(startMs: number, endMs: number, fps = 30): { inEndMs: number; outStartMs: number } {
  const frameMs = 1000 / fps;
  return {
    inEndMs: Math.round(startMs + V2.inFrames * frameMs),
    outStartMs: Math.round(endMs - V2.outFrames * frameMs),
  };
}

const text = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

/**
 * The renderer's view of one graphic: the `Clip` composition's props, the
 * box, the mode and the cache key. Pure, so the lab can list what would be
 * drawn without drawing it. `props.text`/`sub`/`icon`/`placement`/`scale`
 * are the row's columns; the whole `props` object rides along as `options`
 * for the template to read its timing and data from.
 */
export function planClip(
  spec: GraphicSpecV2,
  ctx: { width: number; height: number; fps: number; accent: string; generation: string; mode?: ClipMode },
): ClipPlan {
  const seconds = Math.max(0.2, Math.round(((spec.endMs - spec.startMs) / 1000) * 1000) / 1000);
  const mode = ctx.mode ?? clipMode(spec.kind, seconds, ctx.fps);
  const box = boxForZone(spec.zone, spec.kind, ctx.width, ctx.height);
  const p = spec.props ?? {};
  const props = {
    graphic: {
      kind: spec.kind,
      text: text(p.text),
      sub: p.sub == null ? null : text(p.sub),
      icon: p.icon == null ? null : text(p.icon),
      placement: p.placement == null ? null : text(p.placement),
      scale: typeof p.scale === "number" ? p.scale : null,
      options: p,
    },
    accent: ctx.accent,
    seconds,
    frame: { width: ctx.width, height: ctx.height },
    box,
  };
  const key = createHash("sha256")
    .update(JSON.stringify({ v: TEMPLATE_VERSION, g: ctx.generation, fps: ctx.fps, mode, props }))
    .digest("hex")
    .slice(0, 40);
  return { id: spec.id, kind: spec.kind, mode, seconds, startMs: spec.startMs, endMs: spec.endMs, box, props, key };
}

/* --------------------------------------------------------------- helpers */

/** The bundle's identity, computed the way the renderers key their bundle directory. */
async function bundleGeneration(): Promise<string> {
  const src = path.join(PROJECT, "src");
  const hash = createHash("sha1");
  const names = (await readdir(src).catch(() => [] as string[])).sort();
  for (const name of names) {
    const s = await stat(path.join(src, name)).catch(() => null);
    if (s) hash.update(name).update(String(s.mtimeMs)).update(String(s.size));
  }
  hash.update(await readFile(path.join(PROJECT, "package.json")).catch(() => Buffer.alloc(0)));
  return hash.digest("hex").slice(0, 12);
}

const MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * A picture for a template (`logo`, `image`), inlined as a data URL.
 *
 * Chrome renders the composition from a bundle served over HTTP and cannot
 * read a path on this box; a data URL travels inside the props, is part of
 * the cache key, and needs no copy into `public/`. A URL or a data URL is
 * left as it is; a file over 6 MB or of an unknown type is dropped with a
 * note, and the template draws its monogram instead.
 */
async function inlineImage(value: unknown, log: (l: string) => void): Promise<string | undefined> {
  if (typeof value !== "string" || !value) return undefined;
  if (value.startsWith("data:") || /^https?:\/\//.test(value)) return value;
  const mime = MIME[path.extname(value).toLowerCase()];
  if (!mime) {
    log(`[motion] ${value}: not an image type a template can show; drawing without it`);
    return undefined;
  }
  const s = await stat(value).catch(() => null);
  if (!s || s.size > 6 * 1024 * 1024) {
    log(`[motion] ${value}: ${s ? "over 6 MB" : "missing"}; drawing without it`);
    return undefined;
  }
  const bytes = await readFile(value);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

type ClipResult = { id: string; ok: boolean; cached?: boolean; mode?: ClipMode; dir?: string; parts?: Record<string, string>; error?: string; ms?: number };

/**
 * One run of the renderer over a job file. Resolves with what each clip
 * came to; rejects only when the process itself could not run or run to
 * the end (a bundle or browser failure), which the caller treats as "every
 * clip failed".
 */
function runRenderer(jobPath: string, timeoutMs: number, onLine: (r: ClipResult) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [RENDERER, jobPath], { cwd: PROJECT, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let buffer = "";
    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      let nl = buffer.indexOf("\n");
      while (nl >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
        if (!line) continue;
        try {
          const parsed = JSON.parse(line) as ClipResult & { summary?: boolean };
          if (!parsed.summary) onLine(parsed);
        } catch {
          /* a stray log line from Remotion; not ours */
        }
      }
    });
    child.stderr?.on("data", (c) => {
      if (stderr.length < 6000) stderr += String(c);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`the motion renderer timed out after ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`the motion renderer could not start: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`the motion renderer exited ${code}: ${stderr.slice(0, 800)}`));
    });
  });
}

/** Whether a cached clip directory is complete: `meta.json` and every part it names. */
async function cachedParts(key: string): Promise<{ mode: ClipMode; parts: Record<string, string> } | null> {
  const dir = path.join(CACHE, key);
  const meta = await readFile(path.join(dir, "meta.json"), "utf8")
    .then((s) => JSON.parse(s) as { mode: ClipMode; parts: Record<string, string> })
    .catch(() => null);
  if (!meta || !meta.parts) return null;
  for (const f of Object.values(meta.parts)) if (!(await stat(path.join(dir, f)).catch(() => null))) return null;
  return { mode: meta.mode, parts: meta.parts };
}

/* ---------------------------------------------------------------- the IO */

/**
 * Draw every v2 graphic of a render as motion clips.
 *
 * Returns one `MotionClip` per spec that could be drawn, in the specs'
 * order, with its parts copied under `opts.dir/motion/`. Specs whose clip
 * and still both failed are left out (and said so on the log); nothing
 * here throws for a render problem, so motion can never fail a render.
 */
export async function renderMotionClips(specs: GraphicSpecV2[], opts: MotionOptions): Promise<MotionClip[]> {
  const log = opts.log ?? ((l: string) => console.log(l));
  if (specs.length === 0) return [];
  const fps = opts.fps ?? 30;
  const concurrency = Math.max(1, Math.min(6, opts.concurrency ?? Number(process.env.DV2_CONCURRENCY || 6)));
  const started = Date.now();

  const generation = await bundleGeneration();
  const ctx = { width: opts.width, height: opts.height, fps, accent: opts.accent, generation };

  /* Pictures first, so the cache key sees the bytes and not a path that
     may point at something else tomorrow. */
  const prepared: GraphicSpecV2[] = [];
  for (const spec of specs) {
    const props = { ...(spec.props ?? {}) };
    for (const field of ["logo", "image"]) {
      if (field in props) {
        const inlined = await inlineImage(props[field], log);
        if (inlined) props[field] = inlined;
        else delete props[field];
      }
    }
    prepared.push({ ...spec, props });
  }

  const plans = prepared.map((spec) => planClip(spec, ctx));
  const results = new Map<string, ClipResult>();
  let cachedCount = 0;
  const fresh: ClipPlan[] = [];
  for (const plan of plans) {
    const hit = await cachedParts(plan.key);
    if (hit) {
      cachedCount++;
      results.set(plan.id, { id: plan.id, ok: true, cached: true, mode: hit.mode, dir: path.join(CACHE, plan.key), parts: hit.parts });
    } else fresh.push(plan);
  }

  await mkdir(opts.dir, { recursive: true });
  const total = plans.length;
  let doneCount = cachedCount;
  opts.onProgress?.(doneCount, total);

  const attempt = async (batch: ClipPlan[], label: string) => {
    if (batch.length === 0) return;
    const jobPath = path.join(opts.dir, `motion-${label}.json`);
    await writeFile(
      jobPath,
      JSON.stringify({
        width: opts.width,
        height: opts.height,
        fps,
        accent: opts.accent,
        concurrency,
        cacheDir: CACHE,
        inFrames: V2.inFrames,
        outFrames: V2.outFrames,
        clips: batch.map((p) => ({ id: p.id, key: p.key, mode: p.mode, seconds: p.seconds, box: p.box, props: p.props })),
      }),
    );
    const timeoutMs = opts.timeoutMs ?? Math.min(15 * 60_000, 90_000 + batch.length * 12_000);
    try {
      await runRenderer(jobPath, timeoutMs, (r) => {
        results.set(r.id, r);
        if (r.ok) {
          doneCount++;
          opts.onProgress?.(doneCount, total);
        }
      });
    } catch (err) {
      log(`[motion] ${label}: ${(err as Error).message}`);
    }
  };

  /* Pass one: the clips. Pass two: a still for whatever failed, through the
     same composition, so the graphic keeps its look and only loses its
     motion. */
  await attempt(fresh, "clips");
  const failedFirst = fresh.filter((p) => !results.get(p.id)?.ok);
  if (failedFirst.length) {
    for (const p of failedFirst) log(`[motion] ${p.id} (${p.kind}): clip failed — ${results.get(p.id)?.error ?? "no result"}; drawing a still instead`);
    const stills = failedFirst.map((p) => planClip(prepared.find((s) => s.id === p.id)!, { ...ctx, mode: "still" }));
    await attempt(stills, "stills");
  }

  /* Collect: copy each clip's parts beside the render, keyed by graphic id. */
  const outDir = path.join(opts.dir, "motion");
  await mkdir(outDir, { recursive: true });
  const clips: MotionClip[] = [];
  let stillCount = 0;
  let omitted = 0;
  for (const plan of plans) {
    const r = results.get(plan.id);
    if (!r?.ok || !r.parts || !r.dir) {
      omitted++;
      log(`[motion] ${plan.id} (${plan.kind}): left out — ${r?.error ?? "no result"}`);
      continue;
    }
    if (r.mode === "still") stillCount++;
    const parts: MotionClip["parts"] = {};
    let complete = true;
    for (const [part, file] of Object.entries(r.parts)) {
      const dest = path.join(outDir, `${plan.id}-${part}${path.extname(file)}`);
      const ok = await copyFile(path.join(r.dir, file), dest).then(() => true, () => false);
      if (!ok) {
        complete = false;
        break;
      }
      parts[part as keyof MotionClip["parts"]] = dest;
    }
    if (!complete) {
      omitted++;
      log(`[motion] ${plan.id} (${plan.kind}): left out — its parts could not be copied from the cache`);
      continue;
    }
    clips.push({ id: plan.id, startMs: plan.startMs, endMs: plan.endMs, x: plan.box.x, y: plan.box.y, w: plan.box.w, h: plan.box.h, parts });
  }

  log(
    `[motion] ${clips.length} of ${plans.length} graphics: ${cachedCount} from cache, ${plans.length - cachedCount - omitted - stillCount} rendered, ${stillCount} as stills (fallback), ${omitted} left out, ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
  return clips;
}
