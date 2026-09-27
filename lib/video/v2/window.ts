import "server-only";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Beat } from "@/lib/video/v2/types";
import { pickWindow as visionPickWindow, type ScoreContext, type VisionOptions, type WindowResult } from "@/lib/video/vision";

/**
 * Where in a clip to cut.
 *
 * v1 started every cutaway at second zero. A clip's first second is a
 * title, a fade, a talking head about to say something; the picture the
 * line needs is somewhere inside. So: sample frames across the clip (one a
 * second for a short one, eight spread evenly across a long one, scaled to
 * 480 wide because eight frames cost the judge about what one contact
 * sheet does), ask the vision model which one shows the thing and where
 * its subject sits, refuse a frame with burned-in captions or a watermark,
 * and start the window there — at least a second in whenever the clip has
 * the room, clamped so the whole window fits.
 *
 * Long videos are not downloaded whole: `sourcing.ts` fetches a section
 * (`sectionStartMs` says where it begins) and this module works inside it;
 * the window it returns is in the source's own clock, so the asset record
 * says where the piece came from. `cutClip` then writes the piece: video
 * only (a fetched clip's sound is never used, PLAN.md §1), H.264, no larger
 * than the frame it will be composited into.
 */

const exec = promisify(execFile);

export type Frame = { file: string; atMs: number };

export type LocalClip = { file: string; durationMs: number; sectionStartMs: number };

export type WindowPick = {
  /** In the source's clock. */
  windowMs: [number, number];
  /** In the local file's clock. */
  localStartMs: number;
  subjectX: number;
  burnedText: boolean;
  best: Frame;
  score: number;
  reason: string;
  frames: { atMs: number; score: number; reason: string }[];
  usage: WindowResult["usage"];
};

export type WindowVerdict = { ok: true; pick: WindowPick; frames: Frame[] } | { ok: false; reasonZh: string; frames: Frame[]; usage?: WindowResult["usage"] };

export async function probeVideo(file: string): Promise<{ durationMs: number; width: number; height: number }> {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "format=duration:stream=width,height,side_data_list", "-of", "json", file], { timeout: 30_000 });
  const p = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { width?: number; height?: number; side_data_list?: { rotation?: number }[] }[] };
  const v = p.streams?.[0];
  const rot = Math.abs(Number(v?.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation ?? 0)) % 360;
  const sideways = rot === 90 || rot === 270;
  return { durationMs: Math.round(Number(p.format?.duration ?? 0) * 1000), width: (sideways ? v?.height : v?.width) ?? 0, height: (sideways ? v?.width : v?.height) ?? 0 };
}

/**
 * When to look: from one second in (when there is room) to the last start
 * that still fits the window, one a second up to eight, else eight spread
 * evenly. A clip no longer than the window itself gets one look.
 */
export function frameTimes(durationMs: number, needMs: number, max = 8): number[] {
  const from = durationMs > needMs + 2_000 ? 1_000 : 0;
  const to = Math.max(from, durationMs - needMs);
  if (to - from < 500) return [Math.min(from, Math.max(0, durationMs / 2))];
  const span = to - from;
  const step = Math.max(1_000, span / (max - 1));
  const out: number[] = [];
  for (let t = from; t <= to + 1 && out.length < max; t += step) out.push(Math.round(t));
  return out;
}

/** JPEG frames at the given times, 480 wide, four extractions at a time. */
export async function sampleFrames(file: string, times: number[], dir: string, prefix: string, width = 480): Promise<Frame[]> {
  await mkdir(dir, { recursive: true });
  const frames: Frame[] = [];
  for (let i = 0; i < times.length; i += 4) {
    const batch = await Promise.all(
      times.slice(i, i + 4).map(async (atMs, j) => {
        const out = path.join(dir, `${prefix}-${String(i + j).padStart(2, "0")}.jpg`);
        try {
          await exec("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", (atMs / 1000).toFixed(3), "-i", file, "-frames:v", "1", "-vf", `scale='min(${width},iw)':-2`, "-q:v", "4", out], { timeout: 30_000 });
          return { file: out, atMs };
        } catch {
          return null;
        }
      }),
    );
    for (const f of batch) if (f) frames.push(f);
  }
  return frames;
}

/**
 * Write the piece: from `startMs` for `durationMs`, video only, H.264
 * 4:2:0, scaled down to `maxEdge` on the long side when larger, never up.
 */
export async function cutClip(src: string, out: string, opts: { startMs: number; durationMs: number; maxEdge?: number }): Promise<{ durationMs: number; width: number; height: number }> {
  const edge = opts.maxEdge ?? 1920;
  await mkdir(path.dirname(out), { recursive: true });
  await exec(
    "ffmpeg",
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-ss", (Math.max(0, opts.startMs) / 1000).toFixed(3),
      "-i", src,
      "-t", (Math.max(500, opts.durationMs) / 1000).toFixed(3),
      "-map", "0:v:0", "-an",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
      "-vf", `scale='min(${edge},iw)':'min(${edge},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,
      "-movflags", "+faststart",
      out,
    ],
    { timeout: 300_000 },
  );
  return probeVideo(out);
}

export type PickOptions = {
  dir: string;
  prefix: string;
  context?: string;
  entity?: ScoreContext["entity"];
  minScore?: number;
  /** A headline beat: the story's own text on screen (a tweet, a document, a masthead) is the picture, not a defect. */
  allowBurnedText?: boolean;
  vision?: typeof visionPickWindow;
  visionOpts?: VisionOptions;
};

/**
 * The window for one fetched clip and one line. Null-ish (`ok: false`)
 * when no sampled frame reaches the gate or the best one carries burned-in
 * text; the caller moves to the runner-up candidate.
 */
export async function pickWindow(local: LocalClip, beat: Beat, line: string, needMs: number, opts: PickOptions): Promise<WindowVerdict> {
  const times = frameTimes(local.durationMs, needMs);
  const frames = await sampleFrames(local.file, times, opts.dir, opts.prefix);
  if (!frames.length) return { ok: false, reasonZh: "抽不出画面（文件损坏或无视频流）", frames };
  const ask = opts.vision ?? visionPickWindow;
  const r = await ask(line, frames.map((f) => f.file), { context: opts.context, must: beat.must, mustNot: beat.mustNot, entity: opts.entity }, opts.visionOpts);
  const minScore = opts.minScore ?? 7;
  const scored = r.scores.map((s) => ({ atMs: frames[s.index].atMs, score: s.score, reason: s.reason }));
  const bestIndex = r.best !== null && r.scores[r.best].score >= minScore ? r.best : r.scores.reduce((b, s) => (s.score > r.scores[b].score ? s.index : b), 0);
  const best = r.scores[bestIndex];
  if (best.score < minScore) return { ok: false, reasonZh: `片内最佳画面只有 ${best.score}/10（${best.reason}）`, frames, usage: r.usage };
  if (r.burnedText && !opts.allowBurnedText) return { ok: false, reasonZh: `所选画面带有字幕或水印（${best.reason}）`, frames, usage: r.usage };

  const maxStart = Math.max(0, local.durationMs - needMs);
  let start = Math.min(frames[bestIndex].atMs, maxStart);
  if (local.durationMs > needMs + 2_000) start = Math.max(start, 1_000);
  start = Math.min(start, maxStart);
  return {
    ok: true,
    frames,
    pick: {
      windowMs: [local.sectionStartMs + start, local.sectionStartMs + start + needMs],
      localStartMs: start,
      subjectX: r.subjectX,
      burnedText: r.burnedText,
      best: frames[bestIndex],
      score: best.score,
      reason: best.reason,
      frames: scored,
      usage: r.usage,
    },
  };
}
