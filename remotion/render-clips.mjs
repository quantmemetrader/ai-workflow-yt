/**
 * Director v2's motion clips, drawn in one browser.
 *
 *   node render-clips.mjs job.json
 *
 * `job.json` is
 *
 *   { width, height, fps, accent, concurrency, cacheDir, inFrames, outFrames,
 *     clips: [{ id, key, mode, seconds, box: {x,y,w,h}, props }] }
 *
 * and every clip is rendered from the `Clip` composition (`src/Root.tsx`)
 * with `props` as its input, cropped to `box`, as transparent VP9 —
 * `yuva420p` from PNG frames, the one WebM flavour FFmpeg on this box
 * decodes with alpha (through `-c:v libvpx-vp9`). Three modes:
 *
 *   full       one clip of every frame, for a graphic whose picture keeps
 *              changing (a counter, bars growing, a diagram's flow)
 *   segments   `in.webm` (the first `inFrames`), `hold.png` (that frame),
 *              `out.webm` (the last `outFrames`): a graphic that is still
 *              after its entrance costs 18 frames and a still instead of
 *              a hundred, and the compositor loops the still between them
 *   still      `hold.png` alone — the fallback the wrapper asks for when
 *              a clip render failed, so a graphic is never simply lost
 *
 * Like `render-stills.mjs`, this bundles the composition once (the bundle
 * is keyed by the sources and shared with the stills renderer, so a
 * deployment pays for it once) and opens one Chrome; unlike it, a clip is
 * many frames, so several clips render at once, each on a share of the
 * `concurrency` tabs, and the results are written to `cacheDir/<key>/`
 * where the wrapper (`lib/video/motion.ts`) keys them by the props and the
 * template version. One JSON line per clip goes to stdout as it finishes,
 * then a summary line; a clip that fails is reported and the rest carry
 * on, because a broken counter must not cost the whole video.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderMedia, renderStill, selectComposition } from "@remotion/renderer";

const here = path.dirname(fileURLToPath(import.meta.url));
const jobPath = process.argv[2];
if (!jobPath) {
  console.error("usage: node render-clips.mjs job.json");
  process.exit(2);
}
const job = JSON.parse(readFileSync(jobPath, "utf8"));
const IN = Number(job.inFrames) > 0 ? Number(job.inFrames) : 12;
const OUT = Number(job.outFrames) > 0 ? Number(job.outFrames) : 6;
const fps = Number(job.fps) > 0 ? Number(job.fps) : 30;
const clips = Array.isArray(job.clips) ? job.clips : [];
const cacheDir = job.cacheDir || path.join(here, ".clips");

const say = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");

/**
 * The bundle, rebuilt only when a source file under src/ has changed.
 *
 * The same key as `render-stills.mjs` computes — names, mtimes and sizes
 * of `src/` plus `package.json` — so both renderers use one bundle
 * directory and `lib/video/graphics.ts:bundleGeneration()` keeps seeing a
 * single newest generation.
 */
async function serveUrl() {
  const src = path.join(here, "src");
  const hash = createHash("sha1");
  for (const name of readdirSync(src).sort()) {
    const p = path.join(src, name);
    hash.update(name).update(String(statSync(p).mtimeMs)).update(String(statSync(p).size));
  }
  hash.update(readFileSync(path.join(here, "package.json")));
  const key = hash.digest("hex").slice(0, 12);
  const dir = path.join(here, ".bundle", key);
  if (existsSync(path.join(dir, "index.html"))) return dir;
  mkdirSync(path.join(here, ".bundle"), { recursive: true });
  return bundle({ entryPoint: path.join(src, "index.ts"), outDir: dir, onProgress: () => {} });
}

/** A finished clip directory: `meta.json` plus every part it names. */
function complete(dir) {
  try {
    const meta = JSON.parse(readFileSync(path.join(dir, "meta.json"), "utf8"));
    return Object.values(meta.parts ?? {}).every((f) => existsSync(path.join(dir, f))) ? meta : null;
  } catch {
    return null;
  }
}

const started = Date.now();
const url = await serveUrl();
const bundleMs = Date.now() - started;
mkdirSync(cacheDir, { recursive: true });

const browser = await openBrowser("chrome", { chromiumOptions: { gl: "swangle" } });
let done = 0;
let failed = 0;
let cached = 0;
try {
  const base = await selectComposition({
    serveUrl: url,
    id: "Clip",
    inputProps: clips[0]?.props ?? {},
    puppeteerInstance: browser,
    logLevel: "error",
  });

  /* `concurrency` is the number of Chrome tabs in all. Three clips at a
     time on two tabs each keeps every tab busy on the short in/out
     segments, where one clip could not use six tabs; a long through-animated
     clip still gets its share. */
  const total = Math.max(1, Number(job.concurrency) || 6);
  const lanes = Math.max(1, Math.min(3, Math.floor(total / 2), clips.length));
  const perLane = Math.max(1, Math.floor(total / lanes));

  async function renderOne(clip) {
    const t0 = Date.now();
    const dir = path.join(cacheDir, clip.key);
    const have = complete(dir);
    if (have) {
      cached++;
      done++;
      say({ id: clip.id, ok: true, cached: true, mode: have.mode, dir, parts: have.parts, ms: 0 });
      return;
    }
    const frames = Math.max(1, Math.round(Number(clip.seconds) * fps));
    const box = clip.box;
    const composition = { ...base, width: box.w, height: box.h, fps, durationInFrames: frames, props: clip.props };
    const common = {
      composition,
      serveUrl: url,
      inputProps: clip.props,
      puppeteerInstance: browser,
      logLevel: "error",
      chromiumOptions: { gl: "swangle" },
    };
    const media = (out, frameRange) =>
      renderMedia({
        ...common,
        codec: "vp9",
        pixelFormat: "yuva420p",
        imageFormat: "png",
        crf: 22,
        muted: true,
        concurrency: perLane,
        outputLocation: out,
        frameRange,
      });
    const still = (out, frame) => renderStill({ ...common, output: out, frame, imageFormat: "png" });

    const tmp = `${dir}.tmp-${process.pid}`;
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const parts = {};
    let mode = clip.mode;
    if (mode === "segments" && frames < IN + OUT + 2) mode = "full";
    try {
      if (mode === "full") {
        await media(path.join(tmp, "full.webm"), null);
        parts.full = "full.webm";
      } else if (mode === "segments") {
        await media(path.join(tmp, "in.webm"), [0, IN - 1]);
        parts.in = "in.webm";
        await still(path.join(tmp, "hold.png"), IN);
        parts.hold = "hold.png";
        await media(path.join(tmp, "out.webm"), [frames - OUT, frames - 1]);
        parts.out = "out.webm";
      } else {
        await still(path.join(tmp, "hold.png"), Math.min(IN, frames - 1));
        parts.hold = "hold.png";
      }
      for (const f of Object.values(parts)) {
        if ((statSync(path.join(tmp, f)).size ?? 0) < 100) throw new Error(`${f} came out empty`);
      }
      const meta = { id: clip.id, key: clip.key, mode, frames, fps, box, inFrames: IN, outFrames: OUT, parts, renderedAt: new Date().toISOString() };
      writeFileSync(path.join(tmp, "meta.json"), JSON.stringify(meta));
      rmSync(dir, { recursive: true, force: true });
      renameSync(tmp, dir);
      done++;
      say({ id: clip.id, ok: true, cached: false, mode, dir, parts, ms: Date.now() - t0 });
    } catch (err) {
      rmSync(tmp, { recursive: true, force: true });
      failed++;
      say({ id: clip.id, ok: false, mode, error: String(err && err.message ? err.message : err).slice(0, 600), ms: Date.now() - t0 });
    }
  }

  const queue = [...clips];
  await Promise.all(
    Array.from({ length: lanes }, async () => {
      for (let clip = queue.shift(); clip; clip = queue.shift()) await renderOne(clip);
    }),
  );
  say({ summary: true, ok: failed === 0, clips: clips.length, done, cached, failed, lanes, perLane, bundleMs, totalMs: Date.now() - started });
} finally {
  await browser.close({ silent: true });
}
