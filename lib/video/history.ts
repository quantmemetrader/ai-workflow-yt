import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { audioTracks, captions, timelineItems, videoGraphics, videoProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { newId } from "@/lib/ids";
import { canEditProject } from "@/lib/video/access";

/**
 * Undo, for a module where every change is already saved.
 *
 * The editor writes straight to the database — which is right, because a cut
 * you made an hour ago should survive a closed laptop — but it left people
 * pressing the browser's Back button to take something back, landing on
 * another page with the change still made. Back is navigation. This is undo.
 *
 * It is a whole-project snapshot rather than a log of inverse operations, for
 * three reasons:
 *
 *   1. **The agent edits too.** "Cut the bit where I stumble" can rewrite the
 *      timeline, re-time forty captions and drop two graphics in one turn. An
 *      inverse-operation log would need an inverse for every tool; a snapshot
 *      takes the lot back in one step, which is also how a person thinks about
 *      it: *undo what it just did*.
 *   2. **It cannot drift.** A new action written next month is covered without
 *      anybody remembering to write its opposite.
 *   3. **It is small.** A long interview is a few hundred rows of text and
 *      integers — tens of kilobytes. The footage is untouched: a snapshot
 *      holds *references* to clips, never media.
 *
 * What it deliberately does not restore: the footage in the bin, and the
 * exports. Removing a clip is not an edit to take back silently, and an export
 * that has already been rendered is a file somebody may have sent.
 */
export type ProjectSnapshot = {
  /** Which project this belongs to, checked on the way back in. */
  projectId: string;
  takenAt: string;
  look: { captionPreset: string; accent: string; title: string };
  items: {
    clipId: string | null;
    kind: string;
    ord: number;
    inMs: number;
    outMs: number | null;
    text: string | null;
    holdMs: number;
    transition: string;
    transitionMs: number;
  }[];
  captions: {
    startMs: number;
    endMs: number;
    text: string;
    language: string;
    ord: number;
    words: { start: number; end: number; text: string }[] | null;
  }[];
  graphics: {
    kind: string;
    text: string;
    sub: string | null;
    startMs: number;
    endMs: number;
    fileId?: string | null;
    icon?: string | null;
    placement?: string;
    scale?: number;
    options?: Record<string, unknown>;
  }[];
  tracks: { id: string; startMs: number; gain: number; duckUnderSpeech: boolean }[];
};

async function mine(viewer: Viewer, projectId: string) {
  if (!(await canEditProject(viewer, projectId))) return null;
  const [project] = await db
    .select()
    .from(videoProjects)
    .where(and(eq(videoProjects.id, projectId), eq(videoProjects.tenantId, viewer.tenantId)))
    .limit(1);
  return project ?? null;
}

export async function snapshotProject(viewer: Viewer, projectId: string): Promise<ProjectSnapshot | null> {
  const project = await mine(viewer, projectId);
  if (!project) return null;

  const [items, cues, graphics, tracks] = await Promise.all([
    db.select().from(timelineItems).where(eq(timelineItems.projectId, projectId)).orderBy(asc(timelineItems.ord)),
    db.select().from(captions).where(eq(captions.projectId, projectId)).orderBy(asc(captions.startMs)),
    db.select().from(videoGraphics).where(eq(videoGraphics.projectId, projectId)).orderBy(asc(videoGraphics.startMs)),
    db.select().from(audioTracks).where(eq(audioTracks.projectId, projectId)),
  ]);

  return {
    projectId,
    takenAt: new Date().toISOString(),
    look: {
      captionPreset: project.captionPreset,
      accent: project.accent,
      title: project.title,
    },
    items: items.map((i) => ({
      clipId: i.clipId,
      kind: i.kind,
      ord: i.ord,
      inMs: i.inMs,
      outMs: i.outMs,
      text: i.text,
      holdMs: i.holdMs,
      transition: i.transition,
      transitionMs: i.transitionMs,
    })),
    captions: cues.map((c) => ({
      startMs: c.startMs,
      endMs: c.endMs,
      text: c.text,
      language: c.language,
      ord: c.ord,
      words: c.words ?? null,
    })),
    graphics: graphics.map((g) => ({
      kind: g.kind,
      text: g.text,
      sub: g.sub,
      startMs: g.startMs,
      endMs: g.endMs,
      /* A picture's file, an icon's name, a cutaway's clip: without these an
         undo put the row back and emptied it. */
      fileId: g.fileId,
      icon: g.icon,
      placement: g.placement,
      scale: g.scale,
      options: g.options,
    })),
    /* Tracks keep their ids: the row owns an uploaded file and a rendered
       voice-over, so it is moved back rather than made again. */
    tracks: tracks.map((t) => ({
      id: t.id,
      startMs: t.startMs,
      gain: t.gain,
      duckUnderSpeech: t.duckUnderSpeech,
    })),
  };
}

/**
 * Put a snapshot back.
 *
 * One transaction: a half-restored timeline is worse than the edit somebody
 * wanted undone. Rows are recreated rather than diffed, because the thing
 * being restored is the arrangement, and nothing outside the project points at
 * a timeline item or a caption by id.
 */
export async function restoreProject(
  viewer: Viewer,
  projectId: string,
  snapshot: ProjectSnapshot,
): Promise<boolean> {
  if (snapshot?.projectId !== projectId) return false;
  const project = await mine(viewer, projectId);
  if (!project) return false;

  await db.transaction(async (trx) => {
    await trx.delete(timelineItems).where(eq(timelineItems.projectId, projectId));
    if (snapshot.items.length) {
      await trx.insert(timelineItems).values(
        snapshot.items.map((i) => ({
          id: newId("beat"),
          projectId,
          clipId: i.clipId,
          kind: i.kind,
          ord: i.ord,
          inMs: i.inMs,
          outMs: i.outMs,
          text: i.text,
          holdMs: i.holdMs,
          transition: i.transition,
          transitionMs: i.transitionMs,
        })),
      );
    }

    await trx.delete(captions).where(eq(captions.projectId, projectId));
    if (snapshot.captions.length) {
      await trx.insert(captions).values(
        snapshot.captions.map((c) => ({
          /* Captions carry the same prefix the transcriber gives them. */
          id: newId("beat"),
          projectId,
          startMs: c.startMs,
          endMs: c.endMs,
          text: c.text,
          language: c.language,
          ord: c.ord,
          words: c.words ?? undefined,
        })),
      );
    }

    await trx.delete(videoGraphics).where(eq(videoGraphics.projectId, projectId));
    if (snapshot.graphics.length) {
      await trx.insert(videoGraphics).values(
        snapshot.graphics.map((g) => ({
          id: newId("gfx"),
          projectId,
          kind: g.kind,
          text: g.text,
          sub: g.sub,
          startMs: g.startMs,
          endMs: g.endMs,
          fileId: g.fileId ?? null,
          icon: g.icon ?? null,
          placement: g.placement ?? "center",
          scale: g.scale ?? 30,
          options: g.options ?? {},
        })),
      );
    }

    for (const track of snapshot.tracks) {
      await trx
        .update(audioTracks)
        .set({ startMs: track.startMs, gain: track.gain, duckUnderSpeech: track.duckUnderSpeech })
        .where(and(eq(audioTracks.id, track.id), eq(audioTracks.projectId, projectId)));
    }

    await trx
      .update(videoProjects)
      .set({
        captionPreset: snapshot.look.captionPreset,
        accent: snapshot.look.accent,
        title: snapshot.look.title,
        updatedAt: new Date(),
      })
      .where(eq(videoProjects.id, projectId));
  });

  return true;
}
