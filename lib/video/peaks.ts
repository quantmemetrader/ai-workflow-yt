import "server-only";
import { spawn } from "node:child_process";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, videoClips } from "@/lib/db/schema";
import { probe } from "@/lib/files/poster";
import { presignDownload } from "@/lib/storage/r2";

/**
 * The shape of a clip's sound, so a cut can be placed by eye.
 *
 * Trimming by typing a timecode means watching the clip, writing down a
 * number, typing it, and watching it again to check. Every editor worth using
 * draws the audio instead, because the places a cut belongs — the end of a
 * sentence, a breath, the beat a sound lands on — are *visible* in a waveform
 * and invisible in a number.
 *
 * Six hundred peaks. At a typical timeline width that is two or three pixels
 * each, which is as much resolution as the eye uses, and about 4KB of JSON
 * rather than the megabytes a real envelope would be.
 *
 * Read straight from storage over a signed URL: FFmpeg speaks HTTP, so this
 * never downloads a four-gigabyte master to measure it. Only the audio stream
 * is decoded, and at 8kHz mono, which is plenty for an envelope and is a
 * fraction of the work of decoding the picture.
 */
const BUCKETS = 600;
const RATE = 8000;

export async function makePeaks(clipId: string): Promise<{ made: boolean; reason?: string }> {
  const [clip] = await db.select().from(videoClips).where(eq(videoClips.id, clipId)).limit(1);
  if (!clip) return { made: false, reason: "no such clip" };

  const [file] = await db.select().from(files).where(eq(files.id, clip.fileId)).limit(1);
  if (!file?.storageKey) return { made: false, reason: "the source file is gone" };

  /*
   * The length first, and before the waveform's early return.
   *
   * A clip inherits its length from the file when it is added. A file measured
   * *after* the clip was made would leave the clip at null for ever — and a
   * clip of unknown length is one the timeline totals as zero, which disables
   * Transcribe and Export with nothing on screen to say why.
   */
  if (clip.durationMs === null) {
    const measured =
      file.durationMs ??
      (await presignDownload(file.storageKey, { expiresIn: 3600 })
        .then((url) => probe(url))
        .then((m) => m.durationMs)
        .catch(() => null));
    if (measured) {
      await db.update(videoClips).set({ durationMs: measured }).where(eq(videoClips.id, clipId));
    }
  }

  if (clip.peaks?.length) return { made: false, reason: "already measured" };

  try {
    // An hour is plenty for a signed URL that FFmpeg reads once, start to end.
    const url = await presignDownload(file.storageKey, { expiresIn: 3600 });
    const pcm = await readPcm(url);

    if (pcm.length < RATE / 4) {
      // Under a quarter second of audio is silence or a file with no sound. A
      // flat line drawn from nothing would claim a measurement nobody made.
      await db
        .update(videoClips)
        .set({ peaks: [], peaksError: "this clip has no audio" })
        .where(eq(videoClips.id, clipId));
      return { made: false, reason: "no audio" };
    }

    await db.update(videoClips).set({ peaks: envelope(pcm), peaksError: null }).where(eq(videoClips.id, clipId));
    return { made: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Recorded rather than thrown: a clip whose waveform could not be measured
    // is still a clip you can cut, and the screen says why the picture is
    // missing instead of showing a blank strip.
    await db.update(videoClips).set({ peaksError: message.slice(0, 300) }).where(eq(videoClips.id, clipId));
    return { made: false, reason: message };
  }
}

/**
 * Root-mean-square per bucket, normalised to the loudest.
 *
 * RMS rather than the highest sample: peak-picking draws a solid block for
 * anything with a transient in it, and what the eye is looking for is where
 * the *energy* is — where somebody is speaking and where they are not.
 *
 * Normalising to the loudest bucket means a quietly recorded interview draws
 * the same as a loud one. The waveform is for finding edit points, not for
 * judging levels; the numbers that matter for level are in the audio tab.
 */
function envelope(pcm: Int16Array): number[] {
  const per = Math.max(1, Math.floor(pcm.length / BUCKETS));
  const out: number[] = [];

  for (let b = 0; b < BUCKETS; b++) {
    const from = b * per;
    if (from >= pcm.length) break;
    const to = Math.min(pcm.length, from + per);

    let sum = 0;
    for (let i = from; i < to; i++) sum += pcm[i] * pcm[i];
    out.push(Math.sqrt(sum / (to - from)) / 32768);
  }

  const loudest = Math.max(...out, 0.0001);
  // Two decimals: the difference between 0.617 and 0.62 is not visible at
  // three pixels wide, and it is a third of the bytes.
  return out.map((v) => Math.round((v / loudest) * 100) / 100);
}

/** Raw mono PCM out of whatever the file is, straight from storage. */
function readPcm(url: string): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        // Storage can stall; without this a dead connection holds a worker.
        "-rw_timeout",
        "30000000",
        "-i",
        url,
        "-vn",
        "-ac",
        "1",
        "-ar",
        String(RATE),
        "-f",
        "s16le",
        "-",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    const chunks: Buffer[] = [];
    let bytes = 0;
    // Four hours of 8kHz mono. Past that something is wrong with the input,
    // and a worker should not fill its memory finding out.
    const cap = RATE * 2 * 60 * 60 * 4;

    child.stdout?.on("data", (c: Buffer) => {
      bytes += c.length;
      if (bytes > cap) {
        child.kill("SIGKILL");
        return;
      }
      chunks.push(c);
    });

    let stderr = "";
    child.stderr?.on("data", (c) => {
      if (stderr.length < 2000) stderr += String(c);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("measuring the audio timed out"));
    }, 10 * 60_000);

    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg could not start: ${e.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0 && chunks.length === 0) {
        reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(0, 300)}`));
        return;
      }
      const buf = Buffer.concat(chunks);
      // A Buffer's bytes are not necessarily aligned to a 16-bit boundary at
      // the end, and a half sample would be read as a very loud one.
      const samples = Math.floor(buf.byteLength / 2);
      const pcm = new Int16Array(samples);
      for (let i = 0; i < samples; i++) pcm[i] = buf.readInt16LE(i * 2);
      resolve(pcm);
    });
  });
}
