import "server-only";
import { spawn } from "node:child_process";
import { UNDECODABLE_STDERR } from "./render-error";

/**
 * Whether a media file can be decoded at all, asked of ffprobe.
 *
 * A six-byte text file named `.mp4` used to be accepted as footage: the
 * director narrated over it, placed it, designed it and only the render
 * found out ("moov atom not found"), three times over. One ffprobe call at
 * the start says the same thing in a second.
 *
 * `certain` is the important half. ffprobe reading a signed URL can also fail
 * because the network did; only a failure that names the bytes themselves
 * (the patterns in `UNDECODABLE_STDERR`, or a file with no picture and no
 * sound) marks a file unreadable. Anything else is "could not tell", and the
 * caller carries on as it would have before.
 */
export type Readability =
  | { ok: true; durationMs: number | null; hasVideo: boolean; hasAudio: boolean }
  | { ok: false; certain: boolean; why: string };

export function probeReadable(source: string, timeoutMs = 60_000): Promise<Readability> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", source], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c) => (out += String(c)));
    child.stderr.on("data", (c) => {
      if (err.length < 4000) err += String(c);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, certain: false, why: "ffprobe timed out" });
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, certain: false, why: `ffprobe could not start: ${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const why = err.trim().slice(0, 400) || `ffprobe exited ${code}`;
        resolve({ ok: false, certain: UNDECODABLE_STDERR.test(err), why });
        return;
      }
      let parsed: { format?: { duration?: string }; streams?: { codec_type?: string }[] } = {};
      try {
        parsed = JSON.parse(out || "{}");
      } catch {
        resolve({ ok: false, certain: false, why: "ffprobe answered with something that is not JSON" });
        return;
      }
      const hasVideo = Boolean(parsed.streams?.some((s) => s.codec_type === "video"));
      const hasAudio = Boolean(parsed.streams?.some((s) => s.codec_type === "audio"));
      if (!hasVideo && !hasAudio) {
        resolve({ ok: false, certain: true, why: "no picture and no sound in the file" });
        return;
      }
      const seconds = Number(parsed.format?.duration);
      resolve({ ok: true, durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : null, hasVideo, hasAudio });
    });
  });
}

/** The tag a file gets once a probe has found it cannot be decoded. */
export const UNREADABLE_TAG = "unreadable";

/**
 * Footage that cannot be decoded, named, in Chinese. `permanent` tells the
 * queue (`lib/jobs/queue.ts` `fail`) that running the job again would only
 * fail the same way.
 */
export class UnreadableMedia extends Error {
  readonly permanent = true;
  constructor(readonly names: string[]) {
    super(
      `无法读取${names.length ? names.map((n) => `「${n}」`).join("、") : "素材"}：它不是能解码的视频（可能已损坏、没有上传完整，或只是改了扩展名）。请把它从素材库移除，换一个文件再试。`,
    );
    this.name = "UnreadableMedia";
  }
}
