import "server-only";
import { spawn } from "node:child_process";
import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { headObject, presignDownload, putObject } from "@/lib/storage/r2";

/**
 * A still out of a video, so the file lists have something to show.
 *
 * This used to run inside the thumbnail request. Two things were wrong with
 * that and only one of them was visible:
 *
 *   1. **FFmpeg is not on Vercel.** The box has it; a serverless function does
 *      not. So video posters worked on `84.32.176.16` and silently never
 *      appeared on the deployment everybody actually opens.
 *   2. **It downloaded the whole video inside a request.** A four-gigabyte
 *      master, to make one 480-pixel JPEG, while a browser waits.
 *
 * It is a job now, run once when the upload completes, and the request path
 * only ever redirects to something already in storage.
 */
export const posterKeyFor = (storageKey: string) => `${storageKey}.poster.jpg`;

/** A poster that already exists is not made twice. */
export async function posterExists(storageKey: string): Promise<boolean> {
  return Boolean(await headObject(posterKeyFor(storageKey)).catch(() => null));
}

/**
 * A poster from a file already on disk, written beside the object in storage.
 *
 * Three seconds in, not zero: the first frame of a cut is very often black or
 * a slate, and a grid of black rectangles is no more useful than a grid of
 * glyphs. A clip shorter than that falls back to its first frame. Used by the
 * poster job, and inline by everything the platform makes itself (a stock
 * import, a render), so those have a thumbnail from their first second.
 */
export async function posterFromLocal(local: string, storageKey: string): Promise<string> {
  // The output next to the temp dir, not next to the input: the input may be
  // a signed URL (a big file is read over the network, not downloaded).
  const out = path.join(tmpdir(), `poster-${process.pid}-${Date.now()}.jpg`);
  try {
    try {
      await run(["-ss", "3", "-i", local, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "5", out]);
    } catch {
      await run(["-i", local, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "5", out]);
    }
    if ((await stat(out)).size < 200) throw new Error("the frame came out empty");
    const key = posterKeyFor(storageKey);
    await putObject(key, await readFile(out), "image/jpeg");
    return key;
  } finally {
    await rm(out, { force: true }).catch(() => {});
  }
}

/** The row remembers its poster, so a list can tell at once what has one. */
export async function rememberPoster(fileId: string, posterKey: string) {
  await db.update(files).set({ posterKey }).where(eq(files.id, fileId));
}

export async function makePoster(fileId: string): Promise<{ made: boolean; reason?: string }> {
  const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!file) return { made: false, reason: "no such file" };
  if (!file.storageKey) return { made: false, reason: "nothing stored" };

  /* Audio has no frame to grab, but it does have a duration, and a track with
     no duration draws as a zero-length block on the timeline. So the measuring
     happens for both and only the picture is video-only. */
  const hasPoster = file.kind === "video" && (await posterExists(file.storageKey));
  if (hasPoster && !file.posterKey) await rememberPoster(file.id, posterKeyFor(file.storageKey));
  const wantsPoster = file.kind === "video" && !hasPoster;
  const wantsMeasure = (file.kind === "video" || file.kind === "audio") && file.durationMs === null;
  if (!wantsPoster && !wantsMeasure) return { made: false, reason: "already done" };

  /*
   * Read from a signed URL, not from a download.
   *
   * FFmpeg and ffprobe range-request what they need over HTTP: ffprobe reads
   * the moov atom for the length and size, and `-ss 3 -i URL` seeks to one
   * frame. A gigabyte side-angle take used to be pulled down whole three
   * times over (poster, peaks, transcribe), which overran the ten-minute job
   * limit and left the file with no thumbnail. Now nothing is downloaded.
   */
  const url = await presignDownload(file.storageKey, { expiresIn: 6 * 3600 });

  if (wantsMeasure) {
    const probed = await probe(url).catch(() => null);
    if (probed) {
      await db
        .update(files)
        .set({
          durationMs: probed.durationMs,
          ...(probed.width ? { width: probed.width, height: probed.height } : {}),
        })
        .where(eq(files.id, file.id));
    }
  }

  if (!wantsPoster) return { made: false, reason: "measured" };

  const posterKey = await posterFromLocal(url, file.storageKey);
  await rememberPoster(file.id, posterKey);
  return { made: true };
}

/** Length, and the picture's size when there is a picture. */
export async function probe(
  file: string,
): Promise<{ durationMs: number; width: number | null; height: number | null }> {
  const text = await new Promise<string>((resolve, reject) => {
    const child = spawn("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration:stream=width,height,codec_type",
      "-of", "json",
      file,
    ]);
    let out = "";
    child.stdout.on("data", (c) => (out += String(c)));
    child.on("error", (e) => reject(new Error(`ffprobe could not start: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error("ffprobe failed"))));
  });

  const parsed = JSON.parse(text) as {
    format?: { duration?: string };
    streams?: { width?: number; height?: number; codec_type?: string }[];
  };
  const seconds = Number(parsed.format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("no duration in the file");
  const picture = parsed.streams?.find((s) => s.codec_type === "video" && s.width);
  return {
    durationMs: Math.round(seconds * 1000),
    width: picture?.width ?? null,
    height: picture?.height ?? null,
  };
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (c) => {
      if (stderr.length < 2000) stderr += String(c);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg timed out making a poster"));
    }, 5 * 60_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg could not start: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 400)}`));
    });
  });
}
