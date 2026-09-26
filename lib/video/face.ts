import "server-only";
import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { FaceTrack } from "@/lib/video/v2/types";

/**
 * Where the presenter's face is, so the compositor can frame every cut on it.
 *
 * The v1 renderer framed by assumption: a punch-in scaled about the centre of
 * the frame, and the picture-in-picture circle cropped "about two fifths
 * down", which is where a seated presenter's face usually is. Usually. The
 * v2 framing rules (PLAN.md §1) are stated against the eye line — 30–36 % of
 * the height on every host shot, the circle centred on the face, the split
 * layout's host shifted so the eyes sit at a fixed line — and none of that
 * can be done without measuring where the eyes are.
 *
 * The measurement is `scripts/dv2/face.py`: one frame every two seconds at
 * 540 px wide through YuNet (OpenCV's own detector, MIT, one 230 KB onnx)
 * in a venv of its own, because cv2 is not installed anywhere on the box and
 * has no business in the Next.js process. The whole 379 s take measures in
 * about nine seconds. What comes back is the *median* face box and eye line
 * over the take: a presenter to camera does not move much, and a median is
 * what survives the frames where she leans in or looks down.
 *
 * Three layers, like every module in v2:
 *
 *   - `faceTrack(file)` is the core: run the detector, take the median, fall
 *     back to a fixed anchor when the detector is missing or finds nothing.
 *     It writes nothing.
 *   - `faceTrackCached(file, { cacheDir })` keeps the JSON beside the lab's
 *     other caches, keyed by the file's path, size and mtime.
 *   - `faceTrackForFile(fileId, localPath)` is the product's wrapper: reads
 *     `file_meta.meta.face`, computes and stores it when missing. Imports
 *     the database lazily so a lab script can load this module without one.
 */

/** The venv's interpreter and the script. Both settable without a deploy. */
export const FACE_PYTHON = process.env.FACE_PYTHON || "/home/ubuntu/.venvs/dv2face/bin/python";
export const FACE_SCRIPT = process.env.FACE_SCRIPT || path.join(process.cwd(), "scripts", "dv2", "face.py");

/**
 * Where the eyes go on a host shot, as a share of the height, and the most
 * the compositor will let them sit below before it tightens the framing.
 * §1 says 30–36 %; the acceptance gate is 30–38 %; 34 % is the middle of the
 * spec and 37 % leaves a percent of slack under the gate.
 */
export const EYE_TARGET = 0.34;
export const EYE_MAX = 0.37;

/**
 * The anchor when nothing could be measured: the plan's (0.5, 0.42), which
 * is where the channel's own framing puts the face. `samples: 0` says it was
 * never measured, so a caller can decide to keep the loose framing rather
 * than push in on a guess.
 */
export const FACE_FALLBACK: Omit<FaceTrack, "clipId"> = {
  box: [0.35, 0.3, 0.3, 0.24],
  eyeY: 0.42,
  chinY: 0.54,
  samples: 0,
};

/** The detector's answer per sampled frame, for the harness. */
export type FaceSample = {
  t: number;
  /** [left, top, width, height] as shares of the frame, or null when no face. */
  box: [number, number, number, number] | null;
  eyeY: number | null;
  chinY: number | null;
  score: number;
};

type FaceJson = {
  error?: string;
  width: number;
  height: number;
  total: number;
  detected: number;
  samples: FaceSample[];
  median: { box: [number, number, number, number]; eyeY: number; chinY: number } | null;
};

/** A track is worth trusting when at least this many frames had a face. */
const MIN_SAMPLES = 3;

/**
 * The contract's track plus the samples it was taken from, so a planner
 * can anchor each cut on the face *in that cut* rather than on the take's
 * median: a presenter sits lower for the first ten seconds and higher when
 * she leans in, and two percent of the height is the difference between
 * an eye line inside the band and one just under it.
 */
export type FaceTrackDetail = FaceTrack & { series: FaceSample[] };

/**
 * The face track of a video file: the median box and eye line over frames
 * sampled every `everyS` seconds, with the samples themselves.
 *
 * Never throws for a missing detector or an empty result — the render must
 * go on with the fallback anchor — but says so on stderr, and a caller who
 * needs the truth can look at `samples`.
 */
export async function faceTrack(
  file: string,
  opts: { clipId?: string; everyS?: number; width?: number; timeoutMs?: number } = {},
): Promise<FaceTrackDetail> {
  const clipId = opts.clipId ?? "";
  try {
    const parsed = await runFace([file, "--every", String(opts.everyS ?? 2), "--width", String(opts.width ?? 540)], opts.timeoutMs);
    if (parsed.median && parsed.detected >= MIN_SAMPLES) {
      return { clipId, box: parsed.median.box, eyeY: parsed.median.eyeY, chinY: parsed.median.chinY, samples: parsed.detected, series: parsed.samples };
    }
    console.warn(`[face] ${parsed.detected} of ${parsed.total} frames had a face in ${path.basename(file)}; using the fallback anchor`);
  } catch (err) {
    console.warn(`[face] detector unavailable (${err instanceof Error ? err.message : String(err)}); using the fallback anchor`);
  }
  return { clipId, ...FACE_FALLBACK, series: [] };
}

/**
 * The track over one window of the source — the median of the samples
 * inside `[inMs, outMs]`, widened to the nearest samples when the window is
 * shorter than the sampling step — so a cut is framed on the face as it is
 * in that cut. Falls back to the whole track when nothing was sampled.
 */
export function faceTrackFor(track: FaceTrack & { series?: FaceSample[] }, inMs: number, outMs: number): FaceTrack {
  const series = (track.series ?? []).filter((s) => s.box !== null && s.eyeY !== null && s.chinY !== null);
  if (!series.length) return track;
  let inside = series.filter((s) => s.t * 1000 >= inMs - 1000 && s.t * 1000 <= outMs + 1000);
  if (inside.length < 2) {
    const mid = (inMs + outMs) / 2000;
    inside = [...series].sort((a, b) => Math.abs(a.t - mid) - Math.abs(b.t - mid)).slice(0, 3);
  }
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const box = [0, 1, 2, 3].map((k) => round4(median(inside.map((s) => s.box![k])))) as [number, number, number, number];
  return { clipId: track.clipId, box, eyeY: round4(median(inside.map((s) => s.eyeY!))), chinY: round4(median(inside.map((s) => s.chinY!))), samples: inside.length };
}

/**
 * The face at given moments of a file — one seek each — for checking a
 * finished render: is the eye line where the framing rules put it.
 */
export async function faceSamples(file: string, timesS: number[], opts: { width?: number; timeoutMs?: number } = {}): Promise<FaceSample[]> {
  if (!timesS.length) return [];
  const parsed = await runFace(
    [file, "--times", timesS.map((t) => t.toFixed(3)).join(","), "--width", String(opts.width ?? 540)],
    opts.timeoutMs ?? Math.max(120_000, timesS.length * 3_000),
  );
  return parsed.samples;
}

/** The point a cut is framed on: the face's centre line and the eye line. */
export function faceAnchor(track: Pick<FaceTrack, "box" | "eyeY">): [number, number] {
  const [x, , w] = track.box;
  return [round4(x + w / 2), round4(track.eyeY)];
}

/**
 * The loosest zoom that can still put the eye line at or above `eyeMax`.
 *
 * A crop of height H/z whose top is at y puts a source eye line e (a share
 * of the height) at z·(e − y/H) in the output; the top can go down as far as
 * H − H/z, so the highest the eyes can be placed is z·e − (z − 1). Asking
 * for that to equal `eyeMax` gives z = (1 − eyeMax) / (1 − e). For the 蒸馏
 * take, whose eyes sit at 40 % of the raw frame, that is 1.05: a "1.00"
 * framing on this footage is really a 5 % crop, and the planner alternates
 * 1.05 / 1.18 rather than 1.00 / 1.12. The compositor applies this floor by
 * itself as well, so the gate holds whatever the plan says.
 */
export function minFramingZoom(track: Pick<FaceTrack, "eyeY">, eyeMax = EYE_MAX): number {
  if (track.eyeY <= eyeMax) return 1;
  return Math.min(1.25, Math.max(1, round4((1 - eyeMax) / (1 - track.eyeY))));
}

/**
 * The track with a JSON cache beside it, for the lab: a raw take's track is
 * the same on every run, and nine seconds a run adds up over thirty runs.
 */
export async function faceTrackCached(
  file: string,
  opts: { cacheDir: string; clipId?: string; everyS?: number },
): Promise<FaceTrackDetail> {
  const info = await stat(file);
  const key = createHash("sha1").update(`${path.resolve(file)}|${info.size}|${Math.round(info.mtimeMs)}|${opts.everyS ?? 2}|v2`).digest("hex").slice(0, 16);
  const cached = path.join(opts.cacheDir, `face-${key}.json`);
  const hit = await readFile(cached, "utf8").then((t) => JSON.parse(t) as FaceTrackDetail, () => null);
  if (hit && Array.isArray(hit.box) && typeof hit.eyeY === "number") return { ...hit, series: hit.series ?? [], clipId: opts.clipId ?? hit.clipId ?? "" };
  const track = await faceTrack(file, { clipId: opts.clipId, everyS: opts.everyS });
  // A fallback is not cached: the detector may be installed by the next run.
  if (track.samples > 0) {
    await mkdir(opts.cacheDir, { recursive: true });
    await writeFile(cached, JSON.stringify(track), "utf8");
  }
  return track;
}

/** What is kept on the file row: the track plus what it was measured on. */
type StoredFace = FaceTrackDetail & { version: 1; sizeBytes: number; measuredAt: string };
const STORED_VERSION = 1;

/**
 * The product's wrapper: the track from `file_meta.meta.face`, measured and
 * stored when the row has none (or one for an older file size). A store that
 * fails is a warning, not a failed render — the track is already in hand.
 */
export async function faceTrackForFile(fileId: string, localPath: string, opts: { clipId?: string } = {}): Promise<FaceTrackDetail> {
  const size = (await stat(localPath).catch(() => null))?.size ?? 0;
  let dbmod: typeof import("@/lib/db/client") | null = null;
  let schema: typeof import("@/lib/db/schema") | null = null;
  let orm: typeof import("drizzle-orm") | null = null;
  try {
    [dbmod, schema, orm] = await Promise.all([import("@/lib/db/client"), import("@/lib/db/schema"), import("drizzle-orm")]);
    const [row] = await dbmod.db.select({ meta: schema.fileMeta.meta }).from(schema.fileMeta).where(orm.eq(schema.fileMeta.fileId, fileId)).limit(1);
    const stored = row?.meta?.face as Partial<StoredFace> | undefined;
    if (stored && stored.version === STORED_VERSION && stored.sizeBytes === size && Array.isArray(stored.box) && typeof stored.eyeY === "number") {
      return {
        clipId: opts.clipId ?? stored.clipId ?? "",
        box: stored.box,
        eyeY: stored.eyeY,
        chinY: stored.chinY ?? stored.eyeY + 0.12,
        samples: stored.samples ?? 0,
        series: Array.isArray(stored.series) ? stored.series : [],
      };
    }
  } catch (err) {
    console.warn("[face] could not read file_meta; measuring afresh:", err instanceof Error ? err.message : err);
  }

  const track = await faceTrack(localPath, { clipId: opts.clipId });
  if (track.samples > 0 && dbmod && schema && orm) {
    /* The samples go in too (a few KB for a six-minute take): the planner
       frames each cut on the face in that cut, and re-measuring on every
       run is the nine seconds this cache exists to save. */
    const face: StoredFace = { ...track, version: STORED_VERSION, sizeBytes: size, measuredAt: new Date().toISOString() };
    try {
      /* `meta` is a jsonb the extractor also writes into; only the `face`
         key is set, and the row is created when the file never had meta. */
      await dbmod.db
        .insert(schema.fileMeta)
        .values({ fileId, meta: { face } })
        .onConflictDoUpdate({ target: schema.fileMeta.fileId, set: { meta: orm.sql`${schema.fileMeta.meta} || ${JSON.stringify({ face })}::jsonb` } });
    } catch (err) {
      console.warn("[face] could not store the track:", err instanceof Error ? err.message : err);
    }
  }
  return track;
}

/* ----------------------------------------------------------- internals */

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Run the detector with an argv array, never a shell string: the path is a
 * caller's, and a temp path with a quote in it must not become shell syntax.
 * Bounded: three minutes is twenty times the measured run on a six-minute
 * take, and past that the venv is broken, not slow.
 */
function runFace(args: string[], timeoutMs = 180_000): Promise<FaceJson> {
  return new Promise((resolve, reject) => {
    const child = spawn(FACE_PYTHON, [FACE_SCRIPT, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        /* The detector is one small network; four threads keep it off the
           encoder's cores when the two run beside each other. */
        OMP_NUM_THREADS: process.env.FACE_THREADS || "4",
        OPENCV_LOG_LEVEL: "ERROR",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += String(c)));
    child.stderr.on("data", (c) => {
      if (stderr.length < 2000) stderr += String(c);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`face.py did not finish within ${Math.round(timeoutMs / 1000)} s`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`${FACE_PYTHON} could not start: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`face.py exited ${code}: ${stderr.trim().slice(0, 400)}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as FaceJson;
        if (parsed.error) reject(new Error(parsed.error));
        else resolve(parsed);
      } catch {
        reject(new Error(`face.py printed something that is not JSON: ${stdout.slice(0, 200)}`));
      }
    });
  });
}
