import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { audioTracks, files, folders, videoProjects } from "@/lib/db/schema";
import { getObject, putObjectConfirmed, storageKey } from "@/lib/storage/r2";
import { grantOwner } from "@/lib/authz/rebac";
import { newId } from "@/lib/ids";
import { quota } from "@/lib/video/elevenlabs";
import { narrate, TtsError } from "@/lib/video/tts";
import { parseVoiceId } from "@/lib/video/tts/voices";
import type { NarrationTimings, TimedSentence } from "@/lib/video/tts/types";

/**
 * A voice-over, spoken and filed.
 *
 * Run by the worker, and by the director in the same job when it narrates a
 * cut. The speech comes from `lib/video/tts` — the local engine for every
 * `kokoro:` voice, ElevenLabs only for a voice from its library — and the
 * result goes into the file store rather than staying inside this module: a
 * voice-over is something somebody will want to listen to, share and comment
 * on, and all of that runs on files with real owners and real relations.
 *
 * The timings go beside the audio in storage (`timings.json` under the same
 * file id), not into a new column: they are read by exactly two things (the
 * director cutting to the narration, which gets them straight from this
 * function, and "captions from this voice-over" in the editor), a new column
 * would need a migration before the code could deploy, and a file next to the
 * file it describes cannot drift from it.
 *
 * For an ElevenLabs voice the quota is still read *before* synthesising: that
 * account is a free tier, and finding out halfway through a read, as a
 * failure, tells nobody anything useful.
 */
export type Spoken = {
  fileId: string;
  characters: number;
  durationMs: number;
  sentences: TimedSentence[];
  engine: string;
};

export async function speakTrack(trackId: string): Promise<Spoken> {
  const [row] = await db
    .select({ track: audioTracks, project: videoProjects })
    .from(audioTracks)
    .innerJoin(videoProjects, eq(videoProjects.id, audioTracks.projectId))
    .where(eq(audioTracks.id, trackId))
    .limit(1);
  if (!row) throw new Error(`video.voiceover: no track ${trackId}`);

  const { track, project } = row;
  const text = (track.text ?? "").trim();
  if (!text) throw await failed(trackId, "There is nothing to say");
  if (!track.voiceId) throw await failed(trackId, "No voice was chosen");
  const voice = parseVoiceId(track.voiceId);
  if (!voice) throw await failed(trackId, `Not a voice this studio knows: ${track.voiceId}`);

  // Claimed in the statement that checks it, so two workers cannot both speak
  // the same track (and, on ElevenLabs, bill it twice).
  const claimed = await db
    .update(audioTracks)
    .set({ state: "speaking", error: null })
    .where(and(eq(audioTracks.id, trackId), eq(audioTracks.state, "pending")))
    .returning({ id: audioTracks.id });
  if (!claimed.length) throw new Error("That voice-over is already in hand");

  try {
    if (voice.provider === "elevenlabs") {
      const left = await quota();
      const remaining = left.characterLimit - left.charactersUsed;
      if (remaining < text.length) {
        throw new Error(
          `This read is ${text.length} characters and the ElevenLabs account has ${Math.max(0, remaining)} left this month` +
            (left.resetsAt ? `, until ${left.resetsAt.toISOString().slice(0, 10)}` : "") +
            ". Shorten it, choose one of the studio's own voices, or add credit.",
        );
      }
    }

    const spoken = await narrate({ text, voiceId: track.voiceId });
    console.log(
      `[voiceover ${trackId}] ${spoken.engine}: ${text.length} chars -> ${(spoken.durationMs / 1000).toFixed(1)}s of audio ` +
        `in ${(spoken.tookMs / 1000).toFixed(1)}s, ${spoken.sentences.length} sentences, levelled from ${spoken.inputLufs ?? "?"} LUFS`,
    );

    const ownerId = track.createdBy ?? project.ownerId;
    if (!ownerId) throw new Error("This voice-over has nobody to belong to");

    // Into the owner's home folder, so it is a file the Files screen lists
    // rather than one only this module can reach.
    const [home] = await db
      .select({ id: folders.id, path: folders.path })
      .from(folders)
      .where(and(eq(folders.ownerId, ownerId), isNull(folders.parentId), eq(folders.name, "__home")))
      .limit(1);

    const name = `${project.title} · ${track.label || "voice-over"}.mp3`.replace(/[\\/]/g, "-");
    const fileId = newId("fil");
    const key = storageKey(track.tenantId, fileId, name);
    const stored = await putObjectConfirmed(key, new Uint8Array(spoken.mp3), "audio/mpeg");

    const timings: NarrationTimings = {
      version: 1,
      voiceId: track.voiceId,
      engine: spoken.engine,
      durationMs: spoken.durationMs,
      sentences: spoken.sentences,
    };
    await putObjectConfirmed(timingsKey(key), JSON.stringify(timings), "application/json");

    await db.insert(files).values({
      id: fileId,
      tenantId: track.tenantId,
      folderId: home?.id ?? null,
      folderPath: home?.path ?? [],
      name,
      kind: "audio",
      mime: "audio/mpeg",
      sizeBytes: spoken.mp3.byteLength,
      storageKey: key,
      checksum: stored.etag,
      durationMs: spoken.durationMs,
      // What is said, so the voice-over is found by searching for its words.
      text: text.slice(0, 20_000),
      ownerId,
      updatedBy: ownerId,
    });
    await grantOwner(ownerId, { type: "file", id: fileId });

    await db
      .update(audioTracks)
      .set({ fileId, durationMs: spoken.durationMs, state: "ready", error: null })
      .where(eq(audioTracks.id, trackId));

    await db.update(videoProjects).set({ updatedAt: new Date() }).where(eq(videoProjects.id, project.id));

    return { fileId, characters: text.length, durationMs: spoken.durationMs, sentences: spoken.sentences, engine: spoken.engine };
  } catch (err) {
    const message = err instanceof TtsError || err instanceof Error ? err.message : String(err);
    throw await failed(trackId, message);
  }
}

/** Where a voice-over's timings live: beside the audio, under the same file id. */
export function timingsKey(audioKey: string): string {
  return audioKey.replace(/[^/]+$/, "timings.json");
}

/** A voice-over's timings, read back from storage; null when it has none. */
export async function trackTimings(storageKeyOfAudio: string): Promise<NarrationTimings | null> {
  try {
    const res = await getObject(timingsKey(storageKeyOfAudio));
    if (!res.ok) return null;
    const parsed = (await res.json()) as NarrationTimings;
    return parsed?.version === 1 && Array.isArray(parsed.sentences) ? parsed : null;
  } catch {
    return null;
  }
}

/** Mark it failed with the reason on the row, and hand back the error to throw. */
async function failed(trackId: string, message: string): Promise<Error> {
  await db
    .update(audioTracks)
    .set({ state: "failed", error: message.slice(0, 1000) })
    .where(eq(audioTracks.id, trackId));
  return new Error(message);
}
