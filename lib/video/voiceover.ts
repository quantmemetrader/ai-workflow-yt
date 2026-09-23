import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { audioTracks, files, folders, videoProjects } from "@/lib/db/schema";
import { putObjectConfirmed, storageKey } from "@/lib/storage/r2";
import { grantOwner } from "@/lib/authz/rebac";
import { newId } from "@/lib/ids";
import { ElevenLabsUnconfigured, quota, speak } from "@/lib/video/elevenlabs";

/**
 * A voice-over, spoken and filed.
 *
 * Run by the worker. The result goes into the file store rather than staying
 * inside this module: a voice-over is something somebody will want to listen
 * to, share and comment on, and all of that runs on files with real owners and
 * real relations.
 *
 * The quota is read *before* synthesising. The account this key belongs to is
 * on the free tier — ten thousand characters a month — and finding that out
 * halfway through a read, as a failure, tells nobody anything useful. Asking
 * first means the message can say how much is left.
 */
export async function speakTrack(trackId: string): Promise<{ fileId: string; characters: number }> {
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

  // Claimed in the statement that checks it, so two workers cannot both speak
  // the same track and bill it twice.
  const claimed = await db
    .update(audioTracks)
    .set({ state: "speaking", error: null })
    .where(and(eq(audioTracks.id, trackId), eq(audioTracks.state, "pending")))
    .returning({ id: audioTracks.id });
  if (!claimed.length) throw new Error("That voice-over is already in hand");

  try {
    const left = await quota();
    const remaining = left.characterLimit - left.charactersUsed;
    if (remaining < text.length) {
      throw new Error(
        `This read is ${text.length} characters and the account has ${Math.max(0, remaining)} left this month` +
          (left.resetsAt ? `, until ${left.resetsAt.toISOString().slice(0, 10)}` : "") +
          ". Shorten it, or add credit.",
      );
    }

    const audio = await speak(track.voiceId, text);

    const ownerId = track.createdBy ?? project.ownerId;
    if (!ownerId) throw new Error("This voice-over has nobody to belong to");

    // Into the owner's home folder, so it is a file the Files screen lists
    // rather than one only this module can reach.
    const [home] = await db
      .select({ id: folders.id, path: folders.path })
      .from(folders)
      .where(and(eq(folders.ownerId, ownerId), isNull(folders.parentId), eq(folders.name, "__home")))
      .limit(1);

    const name = `${project.title} · ${track.label || "voice-over"}.mp3`;
    const fileId = newId("fil");
    const key = storageKey(track.tenantId, fileId, name);
    const stored = await putObjectConfirmed(key, audio, "audio/mpeg");

    await db.insert(files).values({
      id: fileId,
      tenantId: track.tenantId,
      folderId: home?.id ?? null,
      folderPath: home?.path ?? [],
      name,
      kind: "audio",
      mime: "audio/mpeg",
      sizeBytes: audio.byteLength,
      storageKey: key,
      checksum: stored.etag,
      ownerId,
      updatedBy: ownerId,
    });
    await grantOwner(ownerId, { type: "file", id: fileId });

    await db
      .update(audioTracks)
      .set({ fileId, state: "ready", error: null })
      .where(eq(audioTracks.id, trackId));

    await db
      .update(videoProjects)
      .set({ updatedAt: new Date() })
      .where(eq(videoProjects.id, project.id));

    return { fileId, characters: text.length };
  } catch (err) {
    const message =
      err instanceof ElevenLabsUnconfigured
        ? "No speech key is configured on this deployment."
        : err instanceof Error
          ? err.message
          : String(err);
    throw await failed(trackId, message);
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
