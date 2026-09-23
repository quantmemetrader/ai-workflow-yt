import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { captions, files, timelineItems, videoClips, videoProjects } from "@/lib/db/schema";
import { getObject } from "@/lib/storage/r2";
import { newId } from "@/lib/ids";
import { probe } from "@/lib/files/poster";
import { ElevenLabsUnconfigured, toCaptionLines, transcribe } from "@/lib/video/elevenlabs";

/**
 * Captions from the footage itself.
 *
 * Until now a caption was typed, or a pasted script spread evenly across the
 * cut, and the screen said plainly that the timings were a guess. This is the
 * real thing: the audio of the cut, transcribed with word-level timings, cut
 * into lines that break where somebody actually paused.
 *
 * Three decisions worth stating:
 *
 *   1. **The audio is extracted here, not uploaded whole.** A two-hour master
 *      is gigabytes of video; its mono 16 kHz audio is tens of megabytes.
 *      Sending the video would cost minutes of upload for nothing, because the
 *      transcriber only ever reads the audio.
 *   2. **It transcribes the *cut*, not the sources.** Timings have to line up
 *      with the finished timeline, so the trims are applied first. A
 *      transcript of the raw footage would be a transcript of material that is
 *      not in the video.
 *   3. **The language is detected.** This studio publishes in Cantonese,
 *      Mandarin and English, sometimes within one interview, and declaring a
 *      language would quietly mistranscribe the others. What came back is
 *      recorded so a person can see what it decided.
 */

/** A transcript that has not come back in forty minutes is not coming back. */
const EXTRACT_TIMEOUT_MS = 30 * 60_000;

export type TranscribeResult = {
  captions: number;
  languageCode: string;
  languageProbability: number;
  durationSecs: number;
};

export async function transcribeProject(
  projectId: string,
  options: { language: string; diarize?: boolean },
): Promise<TranscribeResult> {
  const [project] = await db
    .select()
    .from(videoProjects)
    .where(eq(videoProjects.id, projectId))
    .limit(1);
  if (!project) throw new Error(`video.transcribe: no project ${projectId}`);

  const dir = await mkdtemp(path.join(tmpdir(), "aura-transcribe-"));

  try {
    const items = await db
      .select({ i: timelineItems, clip: videoClips, file: files })
      .from(timelineItems)
      .leftJoin(videoClips, eq(videoClips.id, timelineItems.clipId))
      .leftJoin(files, eq(files.id, videoClips.fileId))
      .where(eq(timelineItems.projectId, projectId))
      .orderBy(asc(timelineItems.ord));

    const withAudio = items.filter((i) => i.i.kind === "clip" && i.file?.storageKey);
    if (!withAudio.length) {
      throw new Error("There is no footage on the timeline to transcribe");
    }

    /*
     * One audio file for the whole cut, in timeline order and trimmed the way
     * the timeline trims it. Title cards contribute their hold as silence, so
     * a caption after a title card still lands where the words are.
     */
    const segments: string[] = [];
    let anySound = false;
    for (const [index, entry] of items.entries()) {
      const out = path.join(dir, `a-${String(index).padStart(3, "0")}.wav`);

      if (entry.i.kind === "title") {
        await run("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi",
          "-i", `anullsrc=channel_layout=mono:sample_rate=16000:d=${Math.max(0.2, entry.i.holdMs / 1000)}`,
          out,
        ]);
        segments.push(out);
        continue;
      }

      if (!entry.file?.storageKey) continue;

      const source = path.join(dir, `src-${index}${path.extname(entry.file.name) || ".mp4"}`);
      await download(entry.file.storageKey, source);

      const inSec = entry.i.inMs / 1000;
      const measured = await probe(source).catch(() => null);
      const outMs = entry.i.outMs ?? entry.clip?.durationMs ?? measured?.durationMs ?? null;
      const lengthSec = outMs === null ? null : Math.max(0.05, (outMs - entry.i.inMs) / 1000);

      /* A clip with no sound — b-roll, most stock footage — is silence of its
         own length, as a title card is. Asking FFmpeg for its audio failed the
         whole cut's transcription, which since transcription starts by itself
         when footage lands would have been the first thing anybody saw. */
      if (measured && !measured.hasAudio) {
        await run("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi",
          "-i", `anullsrc=channel_layout=mono:sample_rate=16000:d=${lengthSec ?? 0.2}`,
          out,
        ]);
        segments.push(out);
        await rm(source, { force: true });
        continue;
      }
      anySound = true;

      await run("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-ss", String(inSec),
        ...(lengthSec !== null ? ["-t", String(lengthSec)] : []),
        "-i", source,
        "-vn", "-ac", "1", "-ar", "16000",
        out,
      ]);
      segments.push(out);

      // The source is gigabytes and is not needed again.
      await rm(source, { force: true });
    }

    if (!segments.length) throw new Error("Nothing on the timeline produced any audio");
    // Not worth paying ElevenLabs to listen to silence.
    if (!anySound) throw new Error("None of the footage on the timeline has any sound to transcribe");

    const listPath = path.join(dir, "list.txt");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(listPath, segments.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n"), "utf8");

    const combined = path.join(dir, "cut.mp3");
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "concat", "-safe", "0", "-i", listPath,
      // Mono 64k MP3: speech, not music. A tenth the bytes of the WAV and no
      // difference a transcriber can hear.
      "-c:a", "libmp3lame", "-b:a", "64k", "-ac", "1", "-ar", "16000",
      combined,
    ]);

    const size = (await stat(combined)).size;
    if (size < 1000) throw new Error("The cut has no audible audio");

    const audio = new Blob([await readFile(combined)], { type: "audio/mpeg" });
    const transcript = await transcribe(audio, "cut.mp3", {
      diarize: options.diarize ?? true,
      // Detected, not declared. See the note at the top.
      languageCode: null,
    });

    const lines = toCaptionLines(transcript);
    if (!lines.length) throw new Error("Nothing was said, or nothing could be made out");

    /*
     * Replaces this language's captions, as the even-split does. Two sets of
     * captions in one language, one guessed and one real, is worse than
     * either: nobody would know which the render used.
     */
    await db
      .delete(captions)
      .where(and(eq(captions.projectId, projectId), eq(captions.language, options.language)));

    await db.insert(captions).values(
      lines.map((l, i) => ({
        id: newId("beat"),
        projectId,
        startMs: l.startMs,
        endMs: l.endMs,
        text: l.text,
        // What makes the word-by-word preset follow the voice instead of
        // guessing at it.
        words: l.words,
        language: options.language,
        ord: i,
      })),
    );

    await db
      .update(videoProjects)
      .set({ updatedAt: new Date() })
      .where(eq(videoProjects.id, projectId));

    return {
      captions: lines.length,
      languageCode: transcript.languageCode,
      languageProbability: transcript.languageProbability,
      durationSecs: transcript.durationSecs,
    };
  } catch (err) {
    if (err instanceof ElevenLabsUnconfigured) {
      throw new Error("No transcription key is configured on this deployment.");
    }
    throw err;
  } finally {
    // A failed transcription must not leave a master in /tmp: this box is also
    // the web server.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (c) => {
      if (stderr.length < 4000) stderr += String(c);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} did not finish in time`));
    }, EXTRACT_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`${cmd} could not start: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim().slice(0, 900)}`));
    });
  });
}

async function download(key: string, to: string) {
  const res = await getObject(key);
  if (!res.ok || !res.body) throw new Error(`Storage said ${res.status} for ${key}`);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(to));
}
