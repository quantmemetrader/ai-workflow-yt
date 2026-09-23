import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, tx } from "@/lib/db/client";
import {
  audioTracks,
  captions,
  files,
  jobs,
  scripts,
  timelineItems,
  users,
  videoClips,
  videoExports,
  videoGraphics,
  videoProjects,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { canReadFiles } from "@/lib/authz/rebac";
import { assertCanEdit, canReadProjects, projectRelation, visibilityFor, type Visibility } from "@/lib/video/access";
import { atLeast } from "@/lib/authz/rebac";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { enqueue } from "@/lib/jobs/queue";
import { asEntrance, asTransition, CAPTION_PRESETS, isGraphicKind } from "@/lib/video/presets";
import { presignDownload } from "@/lib/storage/r2";
import { probe } from "@/lib/files/poster";
import { isIconName, isPlacement } from "@/lib/video/icons";
import type { DirectorState } from "@/lib/video/director";

/**
 * Video Edit (spec §4.5), as an assembly module.
 *
 * Reshaped on 19 September after the client pointed at one of their own
 * interviews as the reference: real footage, cut down, captioned and titled.
 * Nothing here generates video, so nothing here waits on Vertex AI,
 * ElevenLabs or Azure. FFmpeg on the box does the work, queued as a job like
 * every other outbound thing (§6).
 *
 * Everything reads the media bin through `canReadFiles`, so a project can only
 * ever contain footage its owner may actually open, and the render job re-does
 * that check before it downloads a byte.
 */

export const ASPECTS = ["16:9", "9:16", "1:1"] as const;
export type Aspect = (typeof ASPECTS)[number];

export function isAspect(v: unknown): v is Aspect {
  return typeof v === "string" && (ASPECTS as readonly string[]).includes(v);
}

export type ClipRow = {
  id: string;
  fileId: string;
  /**
   * The small copy the editor plays instead of the master, when one exists
   * (`lib/video/proxy.ts`). Null for footage uploaded before proxies did, and
   * for anything whose proxy has since been trashed — the player falls back
   * to the master, which is how it worked for everybody until now.
   */
  proxyFileId: string | null;
  label: string;
  name: string;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  /** The shape of the sound, ~600 points 0..1. Null until measured. */
  peaks: number[] | null;
  peaksError: string | null;
};

export type ItemRow = {
  id: string;
  kind: string;
  clipId: string | null;
  clipLabel: string | null;
  ord: number;
  inMs: number;
  outMs: number | null;
  text: string | null;
  holdMs: number;
  /** How this cut arrives from the one before it, and over how long. */
  transition: "cut" | "dissolve" | "dip";
  transitionMs: number;
  /** How long this item runs on the timeline, once trimmed. */
  lengthMs: number;
};

export type CaptionRow = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  language: string;
};

export type ExportRow = {
  id: string;
  aspect: string;
  burnCaptions: string;
  captionLanguage: string;
  state: string;
  progress: number;
  fileId: string | null;
  subtitleFileId: string | null;
  durationMs: number | null;
  sizeBytes: number | null;
  error: string | null;
  requestedByName: string | null;
  createdAt: Date;
  finishedAt: Date | null;
};

export type ProjectRow = {
  id: string;
  title: string;
  notes: string;
  scriptId: string | null;
  /** The linked script's title, so the screen can name it. */
  scriptTitle: string | null;
  /** Where "make the video" has got to, when it has been asked for. */
  director: DirectorState;
  masterFileId: string | null;
  ownerName: string | null;
  updatedAt: Date;
  /** The look, chosen once for the whole video. */
  captionPreset: string;
  accent: string;
  clipCount: number;
  itemCount: number;
  /** The cut's length, from the items. */
  durationMs: number;
  /** What the card shows: the render when there is one, else the first clip. */
  posterFileId: string | null;
  createdAt: Date;
  /** private, shared with someone, or with everyone in the studio. */
  visibility: Visibility;
  /** What the viewer holds: owner (theirs, or an admin), editor, viewer. */
  relation: "owner" | "editor" | "commenter" | "viewer";
};

/* -------------------------------------------------------------- projects */

export async function listProjects(viewer: Viewer): Promise<ProjectRow[]> {
  const rows = await db
    .select({ p: videoProjects, ownerName: users.name, scriptTitle: scripts.title })
    .from(videoProjects)
    .leftJoin(users, eq(users.id, videoProjects.ownerId))
    .leftJoin(scripts, eq(scripts.id, videoProjects.scriptId))
    .where(and(eq(videoProjects.tenantId, viewer.tenantId), isNull(videoProjects.deletedAt), canReadProjects(viewer)))
    .orderBy(desc(videoProjects.updatedAt))
    .limit(100);

  if (!rows.length) return [];
  const ids = rows.map((r) => r.p.id);

  const [clipCounts, items] = await Promise.all([
    db
      .select({ projectId: videoClips.projectId, n: sql<number>`count(*)::int` })
      .from(videoClips)
      .where(inArray(videoClips.projectId, ids))
      .groupBy(videoClips.projectId),
    db
      .select({
        projectId: timelineItems.projectId,
        kind: timelineItems.kind,
        inMs: timelineItems.inMs,
        outMs: timelineItems.outMs,
        holdMs: timelineItems.holdMs,
        clipDuration: videoClips.durationMs,
      })
      .from(timelineItems)
      .leftJoin(videoClips, eq(videoClips.id, timelineItems.clipId))
      .where(inArray(timelineItems.projectId, ids)),
  ]);

  const clipsBy = new Map(clipCounts.map((c) => [c.projectId, c.n]));
  const visibility = await visibilityFor(viewer, ids);
  const shared = viewer.isAdmin
    ? new Map<string, ProjectRow["relation"]>()
    : new Map(
        await Promise.all(
          rows
            .filter((r) => r.p.ownerId !== viewer.id)
            .map(async (r) => [r.p.id, ((await projectRelation(viewer, r.p.id)) ?? "viewer") as ProjectRow["relation"]] as const),
        ),
      );
  // The first clip of each project, for the card's picture when nothing has
  // been rendered yet. One query for the list, not one per card.
  const firstClips = ids.length
    ? await db.execute<{ project_id: string; file_id: string }>(sql`
        select distinct on (project_id) project_id, file_id
          from video_clips
         where project_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
         order by project_id, added_at asc
      `)
    : { rows: [] as { project_id: string; file_id: string }[] };
  const firstClipBy = new Map(firstClips.rows.map((r) => [r.project_id, r.file_id]));
  const lengthBy = new Map<string, { n: number; ms: number }>();
  for (const i of items) {
    const cur = lengthBy.get(i.projectId) ?? { n: 0, ms: 0 };
    cur.n += 1;
    cur.ms += itemLength(i);
    lengthBy.set(i.projectId, cur);
  }

  return rows.map((r) => ({
    id: r.p.id,
    title: r.p.title,
    notes: r.p.notes,
    scriptId: r.p.scriptId,
    scriptTitle: r.scriptTitle ?? null,
    director: (r.p.director ?? {}) as DirectorState,
    masterFileId: r.p.masterFileId,
    ownerName: r.ownerName,
    updatedAt: r.p.updatedAt,
    captionPreset: r.p.captionPreset,
    accent: r.p.accent,
    clipCount: clipsBy.get(r.p.id) ?? 0,
    itemCount: lengthBy.get(r.p.id)?.n ?? 0,
    durationMs: lengthBy.get(r.p.id)?.ms ?? 0,
    posterFileId: r.p.masterFileId ?? firstClipBy.get(r.p.id) ?? null,
    createdAt: r.p.createdAt,
    visibility: visibility.get(r.p.id) ?? "private",
    relation: viewer.isAdmin || r.p.ownerId === viewer.id ? "owner" : (shared.get(r.p.id) ?? "viewer"),
  }));
}

function itemLength(i: {
  kind: string;
  inMs: number;
  outMs: number | null;
  holdMs: number;
  clipDuration: number | null;
}): number {
  if (i.kind === "title") return Math.max(200, i.holdMs);
  const end = i.outMs ?? i.clipDuration ?? 0;
  return Math.max(0, end - i.inMs);
}

export async function projectById(viewer: Viewer, projectId: string, need: "viewer" | "editor" = "editor") {
  if (typeof projectId !== "string" || !projectId || projectId.length > 64) return null;
  /* Private until shared (lib/video/access.ts). Everything that changes a
     project comes through here, so the default is the edit check; the few
     reads ask for "viewer". */
  if (!atLeast(await projectRelation(viewer, projectId), need)) return null;
  const [row] = await db
    .select()
    .from(videoProjects)
    .where(
      and(
        eq(videoProjects.id, projectId),
        eq(videoProjects.tenantId, viewer.tenantId),
        isNull(videoProjects.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createProject(viewer: Viewer, title: string, scriptId: string | null) {
  const name = title.trim();
  if (!name) throw new Error("A project needs a title");
  const id = newId("prj");
  await db.insert(videoProjects).values({
    id,
    tenantId: viewer.tenantId,
    title: name,
    scriptId,
    ownerId: viewer.id,
  });
  await audit(viewer, "video.project.create", { module: "video", objectType: "video_project", objectId: id });
  return id;
}

export async function updateProject(viewer: Viewer, projectId: string, input: { title?: string; notes?: string }) {
  await assertCanEdit(viewer, projectId);
  await db
    .update(videoProjects)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim().slice(0, 300) } : {}),
      ...(input.notes !== undefined ? { notes: input.notes.slice(0, 8000) } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(videoProjects.id, projectId), eq(videoProjects.tenantId, viewer.tenantId)));
}

export async function deleteProject(viewer: Viewer, projectId: string) {
  if ((await projectRelation(viewer, projectId)) !== "owner") throw new Error("Only the project's owner or an admin can delete it");
  await db
    .update(videoProjects)
    .set({ deletedAt: new Date() })
    .where(and(eq(videoProjects.id, projectId), eq(videoProjects.tenantId, viewer.tenantId)));
  await audit(viewer, "video.project.delete", { module: "video", objectId: projectId });
}

/* ------------------------------------------------------------- media bin */

/** The footage this person could add: video files they may actually read. */
export async function availableFootage(viewer: Viewer) {
  const rows = await db
    .select({
      id: files.id,
      name: files.name,
      kind: files.kind,
      sizeBytes: files.sizeBytes,
      durationMs: files.durationMs,
    })
    .from(files)
    .where(
      and(
        eq(files.tenantId, viewer.tenantId),
        isNull(files.deletedAt),
        inArray(files.kind, ["video", "audio"]),
        // Confirmed uploads only: a row whose bytes never arrived is not footage.
        sql`${files.checksum} is not null`,
        canReadFiles(viewer),
      ),
    )
    .orderBy(desc(files.updatedAt))
    .limit(200);
  return rows;
}

/** Pictures this person could put on a video. Same permission filter as the
 * footage list: a graphic is not a way to see somebody else's files. */
export async function availablePictures(viewer: Viewer) {
  return db
    .select({ id: files.id, name: files.name })
    .from(files)
    .where(
      and(
        eq(files.tenantId, viewer.tenantId),
        isNull(files.deletedAt),
        eq(files.kind, "image"),
        canReadFiles(viewer),
      ),
    )
    .orderBy(desc(files.updatedAt))
    .limit(120);
}

export async function listClips(viewer: Viewer, projectId: string): Promise<ClipRow[]> {
  /* The master's preview copy, joined rather than read from the pointer: a
     proxy that has been trashed must not be handed to the player, which would
     ask for it and get a 404 instead of falling back to the master. */
  const proxy = alias(files, "proxy_file");
  const rows = await db
    .select({ c: videoClips, name: files.name, proxyFileId: proxy.id })
    .from(videoClips)
    .innerJoin(videoProjects, eq(videoProjects.id, videoClips.projectId))
    .leftJoin(files, eq(files.id, videoClips.fileId))
    .leftJoin(proxy, and(eq(proxy.id, files.proxyFileId), isNull(proxy.deletedAt)))
    .where(and(eq(videoClips.projectId, projectId), eq(videoProjects.tenantId, viewer.tenantId)))
    .orderBy(asc(videoClips.addedAt));

  return rows.map((r) => ({
    id: r.c.id,
    fileId: r.c.fileId,
    proxyFileId: r.proxyFileId ?? null,
    label: r.c.label || (r.name ?? ""),
    name: r.name ?? "",
    durationMs: r.c.durationMs,
    width: r.c.width,
    height: r.c.height,
    peaks: r.c.peaks,
    peaksError: r.c.peaksError,
  }));
}

/**
 * Add footage to the bin.
 *
 * The file is re-checked against `canReadFiles` here rather than trusted from
 * the list that produced it: the list is a screen, and a screen is not a
 * permission.
 */
export async function addClip(viewer: Viewer, projectId: string, fileId: string) {
  const project = await projectById(viewer, projectId);
  if (!project) throw new Error("That project does not exist");

  const [file] = await db
    .select({ id: files.id, name: files.name, durationMs: files.durationMs, storageKey: files.storageKey, checksum: files.checksum })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt), canReadFiles(viewer)))
    .limit(1);
  if (!file) throw new Error("That file does not exist, or you may not open it");
  /* The checksum is written by the confirm step once the object is really in
     storage. A row without one is an upload that never arrived, and a clip
     made from it is a block that cannot play. */
  if (!file.storageKey || !file.checksum) throw new Error(`"${file.name}" never finished uploading, so it cannot be cut. Upload it again.`);

  /*
   * The length now, not when the worker gets to it.
   *
   * A clip added while the single worker is inside a ten-minute render sat
   * at "unknown length" for ten minutes: a zero-width block on the timeline
   * that would not play, with nothing on screen to say why. ffprobe reads a
   * faststart MP4's header over the signed URL in well under a second, so it
   * is tried here with a short deadline; the worker's peaks job remains the
   * fallback for the files it cannot read in time, and the screen says
   * "measuring" until one of them lands.
   */
  let durationMs = file.durationMs ?? null;
  if (durationMs === null) {
    durationMs = await Promise.race([
      presignDownload(file.storageKey!, { expiresIn: 600 })
        .then((url) => probe(url))
        .then((m) => m.durationMs)
        .catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
    ]);
    if (durationMs) {
      await db.update(files).set({ durationMs }).where(eq(files.id, file.id));
    }
  }

  const id = newId("shot");
  await db.insert(videoClips).values({
    id,
    projectId,
    fileId,
    label: file.name,
    durationMs,
  });

  /* Measure the sound now, so the waveform is drawn by the time somebody
     opens the timeline rather than the first time they try to trim. */
  await enqueue({
    tenantId: viewer.tenantId,
    type: "video.peaks",
    module: "video",
    payload: { clipId: id },
    objectType: "video_project",
    objectId: projectId,
    createdBy: viewer.id,
    dedupeKey: `video:peaks:${id}`,
    priority: 6,
  });

  await touch(viewer, projectId);
  return id;
}

export async function removeClip(viewer: Viewer, clipId: string) {
  const [row] = await db
    .select({ projectId: videoClips.projectId, tenantId: videoProjects.tenantId })
    .from(videoClips)
    .innerJoin(videoProjects, eq(videoProjects.id, videoClips.projectId))
    .where(eq(videoClips.id, clipId))
    .limit(1);
  if (!row || row.tenantId !== viewer.tenantId) throw new Error("Not found");
  await assertCanEdit(viewer, row.projectId);

  /* The timeline items cascade in the database; the cutaways that point at
     this clip by id in their options do not, and a cutaway with no clip is a
     block the render skips and the screen cannot explain. */
  await db
    .delete(videoGraphics)
    .where(and(eq(videoGraphics.projectId, row.projectId), eq(videoGraphics.kind, "broll"), sql`${videoGraphics.options} ->> 'clipId' = ${clipId}`));
  await db.delete(videoClips).where(eq(videoClips.id, clipId));
  await touch(viewer, row.projectId);
}

/* -------------------------------------------------------------- timeline */

export async function listTimeline(viewer: Viewer, projectId: string): Promise<ItemRow[]> {
  const rows = await db
    .select({ i: timelineItems, label: videoClips.label, clipDuration: videoClips.durationMs })
    .from(timelineItems)
    .innerJoin(videoProjects, eq(videoProjects.id, timelineItems.projectId))
    .leftJoin(videoClips, eq(videoClips.id, timelineItems.clipId))
    .where(and(eq(timelineItems.projectId, projectId), eq(videoProjects.tenantId, viewer.tenantId)))
    .orderBy(asc(timelineItems.ord));

  return rows.map((r) => ({
    id: r.i.id,
    kind: r.i.kind,
    clipId: r.i.clipId,
    clipLabel: r.label,
    ord: r.i.ord,
    inMs: r.i.inMs,
    outMs: r.i.outMs,
    text: r.i.text,
    holdMs: r.i.holdMs,
    transition: asTransition(r.i.transition),
    transitionMs: r.i.transitionMs,
    lengthMs: itemLength({
      kind: r.i.kind,
      inMs: r.i.inMs,
      outMs: r.i.outMs,
      holdMs: r.i.holdMs,
      clipDuration: r.clipDuration,
    }),
  }));
}

export async function addTimelineItem(
  viewer: Viewer,
  projectId: string,
  input: { kind: "clip" | "title"; clipId?: string | null; text?: string | null },
) {
  const project = await projectById(viewer, projectId);
  if (!project) throw new Error("That project does not exist");

  const [last] = await db
    .select({ ord: timelineItems.ord })
    .from(timelineItems)
    .where(eq(timelineItems.projectId, projectId))
    .orderBy(desc(timelineItems.ord))
    .limit(1);

  const id = newId("beat");
  await db.insert(timelineItems).values({
    id,
    projectId,
    kind: input.kind,
    clipId: input.kind === "clip" ? (input.clipId ?? null) : null,
    text: input.kind === "title" ? (input.text ?? "") : null,
    ord: (last?.ord ?? 0) + 10,
  });
  await touch(viewer, projectId);

  if (input.kind === "clip") {
    // Never lets a failure here cost the person the clip they just placed.
    await autoTranscribe(viewer, project, "timeline").catch((err) =>
      console.error("[video] auto-transcribe not queued", err),
    );
  }
  return id;
}

/**
 * Captions start themselves when the first footage lands.
 *
 * Nobody should have to press Transcribe for the obvious first step. But a
 * transcription *replaces* the language's captions, so it is only ever started
 * automatically on a cut that has none: the second clip dropped on a cut
 * somebody has already corrected must not throw their corrections away. After
 * that the button is how it runs again.
 *
 * Held back ninety seconds, so a handful of clips dropped one after another
 * is one transcription of all of them rather than one of the first. The key is
 * the button's own, so pressing it meanwhile does not queue a second.
 * `auto` tells the worker to look again before it starts (`scripts/worker.ts`).
 */
const AUTO_TRANSCRIBE_DELAY_MS = 90_000;

async function autoTranscribe(
  viewer: Viewer,
  project: { id: string; director: unknown },
  reason: string,
) {
  const [anyCaption] = await db
    .select({ id: captions.id })
    .from(captions)
    .where(eq(captions.projectId, project.id))
    .limit(1);
  if (anyCaption) return null;

  const language = (project.director as DirectorState | null)?.language || "zh-HK";
  const job = await enqueue({
    tenantId: viewer.tenantId,
    type: "video.transcribe",
    module: "video",
    payload: { projectId: project.id, language, diarize: true, auto: true },
    objectType: "video_project",
    objectId: project.id,
    createdBy: viewer.id,
    dedupeKey: `transcribe:${project.id}:${language}`,
    priority: 2,
    runAfter: new Date(Date.now() + AUTO_TRANSCRIBE_DELAY_MS),
  });

  await audit(viewer, "video.transcribe.auto", {
    module: "video",
    objectType: "video_project",
    objectId: project.id,
    meta: { language, reason, jobId: job.id },
  });
  return job.id;
}

/**
 * Cut one clip in two at a point inside it.
 *
 * The gesture every editor has, and the one this module had no way to make:
 * you could shorten a cut from either end, but there was no way to take a
 * piece out of the middle without deleting it and adding two more with
 * timecodes typed by hand.
 *
 * `ord` is spaced by ten precisely so this works — the new half slots in at
 * `ord + 1` with nothing to renumber, and two splits of the same clip still
 * land in order.
 *
 * `atMs` is a position in the *source*, not on the timeline, because that is
 * what the item's own `inMs` and `outMs` are. The screen does the conversion;
 * doing it here would mean this function needed to know the whole timeline.
 */
export async function splitTimelineItem(viewer: Viewer, itemId: string, atMs: number) {
  const [row] = await db
    .select({ item: timelineItems, tenantId: videoProjects.tenantId })
    .from(timelineItems)
    .innerJoin(videoProjects, eq(videoProjects.id, timelineItems.projectId))
    .where(eq(timelineItems.id, itemId))
    .limit(1);
  if (!row || row.tenantId !== viewer.tenantId) throw new Error("Not found");
  await assertCanEdit(viewer, row.item.projectId);

  const item = row.item;
  if (item.kind !== "clip") throw new Error("A title card has nothing to split");

  const [clip] = item.clipId
    ? await db.select().from(videoClips).where(eq(videoClips.id, item.clipId)).limit(1)
    : [];
  const endMs = item.outMs ?? clip?.durationMs ?? null;
  if (endMs === null) throw new Error("This clip's length is not known yet, so it cannot be split");

  const at = Math.round(atMs);
  // Half a second either side: a split that leaves a two-frame sliver is a
  // mistake, not an edit.
  if (at <= item.inMs + 500 || at >= endMs - 500) {
    throw new Error("Move the playhead further into the clip before splitting");
  }

  const secondId = newId("beat");
  await tx(async (trx) => {
    await trx.update(timelineItems).set({ outMs: at }).where(eq(timelineItems.id, itemId));
    await trx.insert(timelineItems).values({
      id: secondId,
      projectId: item.projectId,
      kind: "clip",
      clipId: item.clipId,
      text: null,
      inMs: at,
      outMs: endMs,
      holdMs: item.holdMs,
      // Between this item and whatever came after it. `ord` steps by ten, so
      // there is always room.
      ord: item.ord + 1,
    });
  });

  await touch(viewer, item.projectId);
  await audit(viewer, "video.split", {
    objectType: "video_project",
    objectId: item.projectId,
    module: "video",
    meta: { atMs: at },
  });
  return secondId;
}

export async function updateTimelineItem(
  viewer: Viewer,
  itemId: string,
  input: {
    inMs?: number;
    outMs?: number | null;
    text?: string;
    holdMs?: number;
    transition?: string;
    transitionMs?: number;
  },
) {
  const [row] = await db
    .select({ projectId: timelineItems.projectId, tenantId: videoProjects.tenantId })
    .from(timelineItems)
    .innerJoin(videoProjects, eq(videoProjects.id, timelineItems.projectId))
    .where(eq(timelineItems.id, itemId))
    .limit(1);
  if (!row || row.tenantId !== viewer.tenantId) throw new Error("Not found");
  await assertCanEdit(viewer, row.projectId);

  await db
    .update(timelineItems)
    .set({
      ...(input.inMs !== undefined ? { inMs: Math.max(0, Math.round(input.inMs)) } : {}),
      ...(input.outMs !== undefined ? { outMs: input.outMs === null ? null : Math.max(0, Math.round(input.outMs)) } : {}),
      ...(input.text !== undefined ? { text: input.text.slice(0, 500) } : {}),
      ...(input.holdMs !== undefined ? { holdMs: Math.max(200, Math.round(input.holdMs)) } : {}),
      ...(input.transition !== undefined ? { transition: asTransition(input.transition) } : {}),
      /* Bounded here rather than only in the renderer: a 30-second dissolve
         stored on a 2-second cut is a number somebody has to explain later. */
      ...(input.transitionMs !== undefined
        ? { transitionMs: Math.max(80, Math.min(4000, Math.round(input.transitionMs))) }
        : {}),
    })
    .where(eq(timelineItems.id, itemId));
  await touch(viewer, row.projectId);
}

/** Move a cut up or down. `ord` is spaced by ten so a move is one write. */
export async function moveTimelineItem(viewer: Viewer, itemId: string, direction: "up" | "down") {
  const [row] = await db
    .select({ item: timelineItems, tenantId: videoProjects.tenantId })
    .from(timelineItems)
    .innerJoin(videoProjects, eq(videoProjects.id, timelineItems.projectId))
    .where(eq(timelineItems.id, itemId))
    .limit(1);
  if (!row || row.tenantId !== viewer.tenantId) throw new Error("Not found");
  await assertCanEdit(viewer, row.item.projectId);

  const siblings = await db
    .select({ id: timelineItems.id, ord: timelineItems.ord })
    .from(timelineItems)
    .where(eq(timelineItems.projectId, row.item.projectId))
    .orderBy(asc(timelineItems.ord));

  const at = siblings.findIndex((s) => s.id === itemId);
  const swapWith = direction === "up" ? siblings[at - 1] : siblings[at + 1];
  if (!swapWith) return;

  await db.update(timelineItems).set({ ord: swapWith.ord }).where(eq(timelineItems.id, itemId));
  await db.update(timelineItems).set({ ord: row.item.ord }).where(eq(timelineItems.id, swapWith.id));
  await touch(viewer, row.item.projectId);
}

export async function removeTimelineItem(viewer: Viewer, itemId: string) {
  const [row] = await db
    .select({ projectId: timelineItems.projectId, tenantId: videoProjects.tenantId })
    .from(timelineItems)
    .innerJoin(videoProjects, eq(videoProjects.id, timelineItems.projectId))
    .where(eq(timelineItems.id, itemId))
    .limit(1);
  if (!row || row.tenantId !== viewer.tenantId) throw new Error("Not found");
  await assertCanEdit(viewer, row.projectId);
  await db.delete(timelineItems).where(eq(timelineItems.id, itemId));
  await touch(viewer, row.projectId);
}

/* -------------------------------------------------------------- captions */

export async function listCaptions(viewer: Viewer, projectId: string, language?: string): Promise<CaptionRow[]> {
  const rows = await db
    .select({ c: captions })
    .from(captions)
    .innerJoin(videoProjects, eq(videoProjects.id, captions.projectId))
    .where(
      and(
        eq(captions.projectId, projectId),
        eq(videoProjects.tenantId, viewer.tenantId),
        language ? eq(captions.language, language) : undefined,
      ),
    )
    .orderBy(asc(captions.startMs), asc(captions.language));

  return rows.map((r) => ({
    id: r.c.id,
    startMs: r.c.startMs,
    endMs: r.c.endMs,
    text: r.c.text,
    language: r.c.language,
  }));
}

export async function addCaption(
  viewer: Viewer,
  projectId: string,
  input: { startMs: number; endMs: number; text: string; language: string },
) {
  const project = await projectById(viewer, projectId);
  if (!project) throw new Error("That project does not exist");
  if (input.endMs <= input.startMs) throw new Error("It ends before it starts");

  const id = newId("beat");
  await db.insert(captions).values({
    id,
    projectId,
    startMs: Math.max(0, Math.round(input.startMs)),
    endMs: Math.round(input.endMs),
    text: input.text.slice(0, 500),
    language: input.language,
  });
  await touch(viewer, projectId);
  return id;
}

export async function updateCaption(
  viewer: Viewer,
  captionId: string,
  input: { startMs?: number; endMs?: number; text?: string },
) {
  const [row] = await db
    .select({ projectId: captions.projectId, tenantId: videoProjects.tenantId })
    .from(captions)
    .innerJoin(videoProjects, eq(videoProjects.id, captions.projectId))
    .where(eq(captions.id, captionId))
    .limit(1);
  if (!row || row.tenantId !== viewer.tenantId) throw new Error("Not found");
  await assertCanEdit(viewer, row.projectId);

  await db
    .update(captions)
    .set({
      ...(input.startMs !== undefined ? { startMs: Math.max(0, Math.round(input.startMs)) } : {}),
      ...(input.endMs !== undefined ? { endMs: Math.round(input.endMs) } : {}),
      ...(input.text !== undefined ? { text: input.text.slice(0, 500) } : {}),
    })
    .where(eq(captions.id, captionId));
  await touch(viewer, row.projectId);
}

export async function removeCaption(viewer: Viewer, captionId: string) {
  const [row] = await db
    .select({ projectId: captions.projectId, tenantId: videoProjects.tenantId })
    .from(captions)
    .innerJoin(videoProjects, eq(videoProjects.id, captions.projectId))
    .where(eq(captions.id, captionId))
    .limit(1);
  if (!row || row.tenantId !== viewer.tenantId) throw new Error("Not found");
  await assertCanEdit(viewer, row.projectId);
  await db.delete(captions).where(eq(captions.id, captionId));
  await touch(viewer, row.projectId);
}

/**
 * Captions from the script's beats, timed evenly across the cut.
 *
 * A starting point, not a transcript: it says so on the screen. Real timings
 * come from somebody watching it, or from speech-to-text once the studio picks
 * a provider. Splitting the cut evenly is honest about being a guess in a way
 * that inventing plausible timings would not be.
 */
export async function captionsFromText(
  viewer: Viewer,
  projectId: string,
  text: string,
  language: string,
  totalMs: number,
) {
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 400);
  if (!lines.length) throw new Error("There is nothing to split into captions");
  if (totalMs <= 0) throw new Error("Put something on the timeline first, so there is a length to spread them over");

  const each = Math.floor(totalMs / lines.length);
  const rows = lines.map((line, i) => ({
    id: newId("beat"),
    projectId,
    startMs: i * each,
    endMs: (i + 1) * each,
    text: line.slice(0, 500),
    language,
    ord: i,
  }));

  await db.delete(captions).where(and(eq(captions.projectId, projectId), eq(captions.language, language)));
  await db.insert(captions).values(rows);
  await touch(viewer, projectId);
  await audit(viewer, "video.captions.split", {
    module: "video",
    objectId: projectId,
    meta: { lines: lines.length, language },
  });
  return rows.length;
}

/* --------------------------------------------------------------- exports */

/* ------------------------------------------------------------- graphics */

export type GraphicRow = {
  id: string;
  kind: string;
  text: string;
  sub: string | null;
  startMs: number;
  endMs: number;
  /** A picture from the store, for an `image` graphic. */
  fileId: string | null;
  /** That picture's type. The preview needs it to know whether the picture
   * is set on a white card, which is decided by `cardBehindPicture`. */
  fileMime: string | null;
  /** Which icon, for an `icon` graphic. */
  icon: string | null;
  placement: string;
  /** Share of the frame's height, 5–90. */
  scale: number;
  /** Entrance, cutaway clip, punch zoom: what each kind reads. */
  options: Record<string, unknown>;
};

export async function listGraphics(viewer: Viewer, projectId: string): Promise<GraphicRow[]> {
  const project = await projectById(viewer, projectId, "viewer");
  if (!project) return [];
  const rows = await db
    .select({ g: videoGraphics, mime: files.mime })
    .from(videoGraphics)
    .leftJoin(files, eq(files.id, videoGraphics.fileId))
    .where(eq(videoGraphics.projectId, projectId))
    .orderBy(asc(videoGraphics.startMs), asc(videoGraphics.ord));
  return rows.map(({ g, mime }) => ({
    id: g.id,
    kind: g.kind,
    text: g.text,
    sub: g.sub,
    startMs: g.startMs,
    endMs: g.endMs,
    fileId: g.fileId,
    fileMime: mime ?? null,
    icon: g.icon,
    placement: g.placement,
    scale: g.scale,
    options: g.options ?? {},
  }));
}

/**
 * Put a graphic on the picture.
 *
 * Bounded here rather than in the screen: a title nobody can read in the time
 * it is up is not a title, and a graphic that outlives the cut is drawn over
 * nothing. Half a second is the floor because the fade in alone is a fifth of
 * one.
 */
export async function addGraphic(
  viewer: Viewer,
  projectId: string,
  input: {
    kind: string;
    text: string;
    sub?: string | null;
    startMs: number;
    endMs: number;
    /** A picture from the file store, for an `image`. Checked against what
     * this person may open — a graphic is not a way to read somebody else's
     * files by putting them on a timeline. */
    fileId?: string | null;
    icon?: string | null;
    placement?: string | null;
    scale?: number | null;
    /** How it arrives. */
    enter?: string | null;
    /** For a cutaway: which clip in the bin, and where in it to start. */
    clipId?: string | null;
    sourceInMs?: number | null;
    /** For a punch-in: how far. 1.1 to 1.5. */
    zoom?: number | null;
  },
) {
  const project = await projectById(viewer, projectId);
  if (!project) throw new Error("That project does not exist");

  const kind = isGraphicKind(input.kind) ? input.kind : "lower-third";
  let text = String(input.text ?? "").trim().slice(0, 160);
  /* A picture, an icon, a cutaway and a punch-in are the graphic; the words
     are optional on all four. Everything else is words, and words it must
     have. */
  if (!text && !["image", "icon", "broll", "punch"].includes(kind)) throw new Error("A graphic needs something to say");

  const options: Record<string, unknown> = { enter: asEntrance(input.enter) };
  if (kind === "broll") {
    const wanted = typeof input.clipId === "string" ? input.clipId : "";
    const [clip] = wanted
      ? await db
          .select({ id: videoClips.id, label: videoClips.label, durationMs: videoClips.durationMs })
          .from(videoClips)
          .where(and(eq(videoClips.id, wanted), eq(videoClips.projectId, projectId)))
          .limit(1)
      : [];
    if (!clip) throw new Error("Which clip? A cutaway needs a clip from this project's bin.");
    const sourceInMs = Math.max(0, Math.round(input.sourceInMs ?? 0));
    if (clip.durationMs && sourceInMs >= clip.durationMs - 500) throw new Error("That start is past the end of the clip");
    options.clipId = clip.id;
    options.sourceInMs = sourceInMs;
    if (!text) text = clip.label || "cutaway";
  }
  if (kind === "punch") {
    options.zoom = Math.max(1.05, Math.min(1.6, Number(input.zoom ?? 1.15) || 1.15));
    if (!text) text = "punch in";
    // Never two at once: the filter sums the factors.
    const overlapping = await db
      .select({ id: videoGraphics.id })
      .from(videoGraphics)
      .where(
        and(
          eq(videoGraphics.projectId, projectId),
          eq(videoGraphics.kind, "punch"),
          sql`${videoGraphics.startMs} < ${Math.round(input.endMs)} and ${videoGraphics.endMs} > ${Math.round(input.startMs)}`,
        ),
      )
      .limit(1);
    if (overlapping.length) throw new Error("There is already a punch-in over that moment");
  }

  let fileId: string | null = null;
  if (kind === "image") {
    const wanted = typeof input.fileId === "string" ? input.fileId : "";
    if (!wanted) throw new Error("Which picture? Pick one from Files.");
    const [picture] = await db
      .select({ id: files.id, kind: files.kind })
      .from(files)
      .where(
        and(
          eq(files.id, wanted),
          eq(files.tenantId, viewer.tenantId),
          isNull(files.deletedAt),
          canReadFiles(viewer),
        ),
      )
      .limit(1);
    if (!picture) throw new Error("That picture does not exist, or you may not open it");
    if (picture.kind !== "image") throw new Error("That file is not a picture");
    fileId = picture.id;
  }

  const icon = kind === "icon" ? (isIconName(input.icon) ? input.icon : "check") : null;
  const placement = isPlacement(input.placement) ? input.placement : kind === "icon" ? "top-right" : kind === "broll" ? "full" : "center";
  const scale = Math.max(5, Math.min(90, Math.round(input.scale ?? (kind === "icon" ? 18 : kind === "broll" ? 34 : 40))));

  const startMs = Math.max(0, Math.round(input.startMs));
  const endMs = Math.max(startMs + 500, Math.round(input.endMs));

  const id = newId("gfx");
  await db.insert(videoGraphics).values({
    id,
    projectId,
    kind,
    text,
    sub: input.sub ? String(input.sub).trim().slice(0, 120) : null,
    startMs,
    endMs,
    fileId,
    icon,
    placement,
    scale,
    options,
  });

  await touch(viewer, projectId);
  await audit(viewer, "video.graphic.add", {
    objectType: "video_project",
    objectId: projectId,
    module: "video",
    meta: { kind, text },
  });
  return id;
}

export async function updateGraphic(
  viewer: Viewer,
  graphicId: string,
  input: {
    kind?: string;
    text?: string;
    sub?: string | null;
    startMs?: number;
    endMs?: number;
    enter?: string;
    placement?: string;
    scale?: number;
    zoom?: number;
    sourceInMs?: number;
  },
) {
  const [row] = await db.select().from(videoGraphics).where(eq(videoGraphics.id, graphicId)).limit(1);
  if (!row) throw new Error("That graphic does not exist");
  const project = await projectById(viewer, row.projectId);
  if (!project) throw new Error("Not allowed");

  const startMs = input.startMs === undefined ? row.startMs : Math.max(0, Math.round(input.startMs));
  const endMs = input.endMs === undefined ? row.endMs : Math.round(input.endMs);

  const options: Record<string, unknown> = { ...(row.options ?? {}) };
  if (input.enter !== undefined) options.enter = asEntrance(input.enter);
  if (input.zoom !== undefined && row.kind === "punch") options.zoom = Math.max(1.05, Math.min(1.6, Number(input.zoom) || 1.15));
  if (input.sourceInMs !== undefined && row.kind === "broll") options.sourceInMs = Math.max(0, Math.round(input.sourceInMs));

  await db
    .update(videoGraphics)
    .set({
      ...(input.kind !== undefined && isGraphicKind(input.kind) ? { kind: input.kind } : {}),
      ...(input.text !== undefined ? { text: String(input.text).trim().slice(0, 160) } : {}),
      ...(input.sub !== undefined ? { sub: input.sub ? String(input.sub).trim().slice(0, 120) : null } : {}),
      ...(input.placement !== undefined && isPlacement(input.placement) ? { placement: input.placement } : {}),
      ...(input.scale !== undefined ? { scale: Math.max(5, Math.min(90, Math.round(input.scale))) } : {}),
      startMs,
      endMs: Math.max(startMs + 500, endMs),
      options,
    })
    .where(eq(videoGraphics.id, graphicId));

  await touch(viewer, row.projectId);
}

export async function removeGraphic(viewer: Viewer, graphicId: string) {
  const [row] = await db.select().from(videoGraphics).where(eq(videoGraphics.id, graphicId)).limit(1);
  if (!row) return;
  const project = await projectById(viewer, row.projectId);
  if (!project) throw new Error("Not allowed");

  await db.delete(videoGraphics).where(eq(videoGraphics.id, graphicId));
  await touch(viewer, row.projectId);
  await audit(viewer, "video.graphic.remove", {
    objectType: "video_project",
    objectId: row.projectId,
    module: "video",
  });
}

/**
 * The caption style and the one loud colour, for the whole project.
 *
 * Per project rather than per caption, deliberately: a video whose captions
 * change style between sentences is exactly what the house rules exist to
 * prevent, and storing it per line would make that a two-click mistake.
 */
export async function setLook(
  viewer: Viewer,
  projectId: string,
  input: { captionPreset?: string; accent?: string },
) {
  const project = await projectById(viewer, projectId);
  if (!project) throw new Error("That project does not exist");

  const preset =
    input.captionPreset && CAPTION_PRESETS.some((p) => p.key === input.captionPreset)
      ? input.captionPreset
      : undefined;
  // A colour we cannot parse is a colour the renderer would draw as white.
  const accent = input.accent && /^#[0-9a-f]{6}$/i.test(input.accent.trim()) ? input.accent.trim() : undefined;
  if (!preset && !accent) return;

  await db
    .update(videoProjects)
    .set({ ...(preset ? { captionPreset: preset } : {}), ...(accent ? { accent } : {}), updatedAt: new Date() })
    .where(eq(videoProjects.id, projectId));

  await audit(viewer, "video.look", {
    objectType: "video_project",
    objectId: projectId,
    module: "video",
    meta: { preset, accent },
  });
}

export async function listExports(viewer: Viewer, projectId: string): Promise<ExportRow[]> {
  const rows = await db
    .select({ e: videoExports, byName: users.name })
    .from(videoExports)
    .leftJoin(users, eq(users.id, videoExports.requestedBy))
    .where(and(eq(videoExports.projectId, projectId), eq(videoExports.tenantId, viewer.tenantId)))
    .orderBy(desc(videoExports.createdAt))
    .limit(40);

  return rows.map((r) => ({
    id: r.e.id,
    aspect: r.e.aspect,
    burnCaptions: r.e.burnCaptions,
    captionLanguage: r.e.captionLanguage,
    state: r.e.state,
    progress: r.e.progress,
    fileId: r.e.fileId,
    subtitleFileId: r.e.subtitleFileId,
    durationMs: r.e.durationMs,
    sizeBytes: r.e.sizeBytes,
    error: r.e.error,
    requestedByName: r.byName,
    createdAt: r.e.createdAt,
    finishedAt: r.e.finishedAt,
  }));
}

/**
 * Queue a render.
 *
 * FFmpeg on a two-hour master is minutes of CPU, so it is a job and never a
 * request: a page that rendered on the request thread would hold a connection
 * open for the length of the film.
 */
export async function requestExport(
  viewer: Viewer,
  projectId: string,
  input: { aspect: Aspect; burnCaptions: boolean; captionLanguage: string; replaces?: string | null },
) {
  const project = await projectById(viewer, projectId);
  if (!project) throw new Error("That project does not exist");

  const items = await listTimeline(viewer, projectId);
  if (!items.length) throw new Error("There is nothing on the timeline to render");

  /* Only a finished render of this same cut may be replaced, and it is
     checked here rather than trusted from the screen: the id travels from a
     browser, and "replace" means "delete a file when this one lands". */
  let replaces: string | null = null;
  if (input.replaces) {
    const [old] = await db
      .select({ id: videoExports.id })
      .from(videoExports)
      .where(
        and(
          eq(videoExports.id, input.replaces),
          eq(videoExports.projectId, projectId),
          eq(videoExports.tenantId, viewer.tenantId),
          eq(videoExports.state, "done"),
        ),
      )
      .limit(1);
    replaces = old?.id ?? null;
  }

  const id = newId("rnd");
  await db.insert(videoExports).values({
    id,
    tenantId: viewer.tenantId,
    projectId,
    replaces,
    aspect: input.aspect,
    burnCaptions: input.burnCaptions ? "burn" : "sidecar",
    captionLanguage: input.captionLanguage,
    requestedBy: viewer.id,
  });

  await enqueue({
    tenantId: viewer.tenantId,
    type: "video.export",
    module: "video",
    payload: { exportId: id },
    createdBy: viewer.id,
    dedupeKey: `video-export:${id}`,
    priority: 2,
  });

  await audit(viewer, "video.export.request", {
    module: "video",
    objectType: "video_export",
    objectId: id,
    meta: { aspect: input.aspect },
  });
  return id;
}

/**
 * Ask for captions from the cut's own audio.
 *
 * A job, not a request: the audio has to be extracted from the footage,
 * concatenated in timeline order and uploaded, which is minutes on a long
 * interview. Deduped per project and language, so pressing the button twice
 * transcribes once.
 */
/**
 * Ask for a first cut.
 *
 * Queued, not awaited: it is a model call plus a rewrite of the timeline, and
 * a server action that takes half a minute is a screen that looks broken. The
 * same shape as transcription, and for the same reason.
 */
export async function requestAutoEdit(viewer: Viewer, projectId: string, language: string) {
  const project = await projectById(viewer, projectId);
  if (!project) throw new Error("That project does not exist");

  const [anyCaption] = await db
    .select({ id: captions.id })
    .from(captions)
    .where(and(eq(captions.projectId, projectId), eq(captions.language, language)))
    .limit(1);
  if (!anyCaption) {
    throw new Error("Transcribe the cut first — everything the first pass does is built on what was said.");
  }

  await enqueue({
    tenantId: viewer.tenantId,
    type: "video.autoedit",
    module: "video",
    payload: { projectId, language },
    objectType: "video_project",
    objectId: projectId,
    createdBy: viewer.id,
    // One at a time per project: two of these racing would write two timelines
    // over each other.
    dedupeKey: `video:autoedit:${projectId}`,
    priority: 3,
  });

  await audit(viewer, "video.autoedit.request", {
    objectType: "video_project",
    objectId: projectId,
    module: "video",
  });
}

/* -------------------------------------------------------------- director */

/**
 * Ask for the whole video.
 *
 * Writes the brief onto the project and queues the one job that does the
 * rest — transcribe, cut, design, render — so the screen has something to
 * show from the first second and the request itself returns at once.
 */
export async function requestDirector(
  viewer: Viewer,
  projectId: string,
  input: { brief: string; aspect?: string; render?: boolean; language?: string | null; pace?: string | null },
) {
  const project = await projectById(viewer, projectId);
  if (!project) throw new Error("That project does not exist");

  const [anyClip] = await db.select({ id: videoClips.id }).from(videoClips).where(eq(videoClips.projectId, projectId)).limit(1);
  if (!anyClip) throw new Error("Put some footage in the bin first: drop a clip on the editor.");

  const current = (project.director ?? {}) as DirectorState;
  if (current.state === "queued" || current.state === "running") {
    throw new Error("It is already making this video. Wait for it to finish, or undo afterwards.");
  }

  const director: DirectorState = {
    state: "queued",
    brief: input.brief.trim().slice(0, 4000),
    aspect: isAspect(input.aspect) ? input.aspect : "16:9",
    render: input.render !== false,
    language: input.language ?? undefined,
    pace: input.pace === "calm" || input.pace === "hype" ? input.pace : "channel",
    log: [],
  };
  await db.update(videoProjects).set({ director, updatedAt: new Date() }).where(eq(videoProjects.id, projectId));

  await enqueue({
    tenantId: viewer.tenantId,
    type: "video.direct",
    module: "video",
    payload: { projectId },
    objectType: "video_project",
    objectId: projectId,
    createdBy: viewer.id,
    dedupeKey: `video:direct:${projectId}`,
    priority: 3,
  });

  await audit(viewer, "video.direct.request", {
    objectType: "video_project",
    objectId: projectId,
    module: "video",
    meta: { aspect: director.aspect, render: director.render, brief: director.brief?.slice(0, 200) },
  });
}

/** Whether the director is at work on this project. */
export function directorRunning(director: DirectorState | null | undefined): boolean {
  return director?.state === "queued" || director?.state === "running";
}

/** Tie a script to the cut, or untie it. The director reads it as the shape the footage was shot to. */
export async function linkScript(viewer: Viewer, projectId: string, scriptId: string | null) {
  const project = await projectById(viewer, projectId);
  if (!project) throw new Error("That project does not exist");
  if (scriptId) {
    const [row] = await db
      .select({ id: scripts.id })
      .from(scripts)
      .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
      .limit(1);
    if (!row) throw new Error("That script does not exist");
  }
  await db.update(videoProjects).set({ scriptId, updatedAt: new Date() }).where(eq(videoProjects.id, projectId));
}

/** The scripts a project can be tied to, for the picker. */
export async function scriptsForPicker(viewer: Viewer) {
  if (!viewer.modules.includes("script")) return [];
  return db
    .select({ id: scripts.id, title: scripts.title, status: scripts.status })
    .from(scripts)
    .where(and(eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
    .orderBy(desc(scripts.updatedAt))
    .limit(60);
}

/**
 * A project for a script, from the Script screen's "Make the video".
 *
 * One per script: a second press opens the cut that exists rather than
 * starting another, the same rule the topic hand-off follows.
 */
export async function projectFromScript(viewer: Viewer, scriptId: string): Promise<string> {
  const [script] = await db
    .select({ id: scripts.id, title: scripts.title })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
    .limit(1);
  if (!script) throw new Error("That script does not exist");

  const [existing] = await db
    .select({ id: videoProjects.id })
    .from(videoProjects)
    .where(and(eq(videoProjects.scriptId, scriptId), eq(videoProjects.tenantId, viewer.tenantId), isNull(videoProjects.deletedAt)))
    .orderBy(desc(videoProjects.updatedAt))
    .limit(1);
  if (existing) return existing.id;

  return createProject(viewer, script.title, scriptId);
}

/** Whether a first cut is being made right now, for the screen to say so. */
export async function autoEditRunning(viewer: Viewer, projectId: string): Promise<boolean> {
  const project = await projectById(viewer, projectId, "viewer");
  if (!project) return false;
  const [row] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.tenantId, viewer.tenantId),
        eq(jobs.type, "video.autoedit"),
        eq(jobs.objectId, projectId),
        inArray(jobs.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function requestTranscription(
  viewer: Viewer,
  projectId: string,
  language: string,
  diarize: boolean,
) {
  const project = await projectById(viewer, projectId);
  if (!project) throw new Error("That project does not exist");

  const items = await listTimeline(viewer, projectId);
  if (!items.some((i) => i.kind === "clip")) {
    throw new Error("Put some footage on the timeline first, so there is audio to transcribe");
  }

  const job = await enqueue({
    tenantId: viewer.tenantId,
    type: "video.transcribe",
    module: "video",
    payload: { projectId, language, diarize },
    createdBy: viewer.id,
    dedupeKey: `transcribe:${projectId}:${language}`,
    priority: 2,
  });

  await audit(viewer, "video.transcribe.request", {
    module: "video",
    objectType: "video_project",
    objectId: projectId,
    meta: { language, diarize },
  });
  return job.id;
}

/** Whether a transcription for this project is still in hand, so the screen
 * can say so rather than looking as though the button did nothing. */
export async function transcriptionRunning(viewer: Viewer, projectId: string): Promise<boolean> {
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.tenantId, viewer.tenantId),
        eq(jobs.type, "video.transcribe"),
        inArray(jobs.status, ["queued", "running"]),
        sql`${jobs.payload} ->> 'projectId' = ${projectId}`,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

async function touch(viewer: Viewer, projectId: string) {
  await db
    .update(videoProjects)
    .set({ updatedAt: new Date() })
    .where(and(eq(videoProjects.id, projectId), eq(videoProjects.tenantId, viewer.tenantId)));
}

/** An SRT, from the caption rows. The same text the burn-in uses, so the two
 * cannot disagree. */
export function toSrt(rows: CaptionRow[]): string {
  return rows
    .map((c, i) => `${i + 1}\n${srtTime(c.startMs)} --> ${srtTime(c.endMs)}\n${c.text}\n`)
    .join("\n");
}

function srtTime(ms: number): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/* ----------------------------------------------------------------- audio */

export type AudioRow = {
  id: string;
  kind: string;
  label: string;
  fileId: string | null;
  fileName: string | null;
  startMs: number;
  durationMs: number | null;
  gain: number;
  duckUnderSpeech: boolean;
  text: string | null;
  voiceId: string | null;
  state: string;
  error: string | null;
};

export async function listAudio(viewer: Viewer, projectId: string): Promise<AudioRow[]> {
  const rows = await db
    .select({ a: audioTracks, fileName: files.name })
    .from(audioTracks)
    .leftJoin(files, eq(files.id, audioTracks.fileId))
    .where(and(eq(audioTracks.projectId, projectId), eq(audioTracks.tenantId, viewer.tenantId)))
    .orderBy(asc(audioTracks.kind), asc(audioTracks.startMs));

  return rows.map((r) => ({
    id: r.a.id,
    kind: r.a.kind,
    label: r.a.label || (r.fileName ?? ""),
    fileId: r.a.fileId,
    fileName: r.fileName,
    startMs: r.a.startMs,
    durationMs: r.a.durationMs,
    gain: r.a.gain,
    duckUnderSpeech: r.a.duckUnderSpeech,
    text: r.a.text,
    voiceId: r.a.voiceId,
    state: r.a.state,
    error: r.a.error,
  }));
}

/** Music, or any audio the studio already has, laid under the cut. */
export async function addMusic(viewer: Viewer, projectId: string, fileId: string, gain: number) {
  const project = await projectById(viewer, projectId);
  if (!project) throw new Error("That project does not exist");

  const [file] = await db
    .select({ id: files.id, name: files.name, durationMs: files.durationMs })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt), canReadFiles(viewer)))
    .limit(1);
  if (!file) throw new Error("That file does not exist, or you may not open it");

  const id = newId("rnd");
  await db.insert(audioTracks).values({
    id,
    tenantId: viewer.tenantId,
    projectId,
    kind: "music",
    label: file.name,
    fileId,
    durationMs: file.durationMs ?? null,
    // Music under speech wants to be well under it. Adjustable on the screen.
    gain: Number.isFinite(gain) ? Math.max(0, Math.min(2, gain)) : 0.15,
  });
  await touch(viewer, projectId);
  return id;
}

export async function updateTrack(
  viewer: Viewer,
  trackId: string,
  input: { gain?: number; startMs?: number; duckUnderSpeech?: boolean; label?: string },
) {
  const [track] = await db
    .select({ projectId: audioTracks.projectId })
    .from(audioTracks)
    .where(and(eq(audioTracks.id, trackId), eq(audioTracks.tenantId, viewer.tenantId)))
    .limit(1);
  if (!track) return;
  await assertCanEdit(viewer, track.projectId);
  await db
    .update(audioTracks)
    .set({
      ...(input.gain !== undefined ? { gain: Math.max(0, Math.min(2, input.gain)) } : {}),
      ...(input.startMs !== undefined ? { startMs: Math.max(0, Math.round(input.startMs)) } : {}),
      ...(input.duckUnderSpeech !== undefined ? { duckUnderSpeech: input.duckUnderSpeech } : {}),
      ...(input.label !== undefined ? { label: input.label.slice(0, 200) } : {}),
    })
    .where(and(eq(audioTracks.id, trackId), eq(audioTracks.tenantId, viewer.tenantId)));
}

export async function removeTrack(viewer: Viewer, trackId: string) {
  const [track] = await db
    .select({ projectId: audioTracks.projectId })
    .from(audioTracks)
    .where(and(eq(audioTracks.id, trackId), eq(audioTracks.tenantId, viewer.tenantId)))
    .limit(1);
  if (!track) return;
  await assertCanEdit(viewer, track.projectId);
  await db
    .delete(audioTracks)
    .where(and(eq(audioTracks.id, trackId), eq(audioTracks.tenantId, viewer.tenantId)));
}

/**
 * A voice-over, spoken by ElevenLabs.
 *
 * Queued, because synthesis of a long read is minutes and the result has to be
 * written into the file store. The row is created first, in `pending`, so the
 * screen has something to show while the worker is at it — the same shape the
 * upload flow uses.
 */
export async function requestVoiceOver(
  viewer: Viewer,
  projectId: string,
  input: { text: string; voiceId: string; label: string; startMs: number; gain: number },
) {
  const project = await projectById(viewer, projectId);
  if (!project) throw new Error("That project does not exist");

  const text = input.text.trim();
  if (!text) throw new Error("There is nothing to say");
  if (text.length > 5000) throw new Error("That is longer than one voice-over should be. Split it.");

  const id = newId("rnd");
  await db.insert(audioTracks).values({
    id,
    tenantId: viewer.tenantId,
    projectId,
    kind: "voiceover",
    label: input.label.slice(0, 200) || "Voice-over",
    text,
    voiceId: input.voiceId,
    startMs: Math.max(0, Math.round(input.startMs)),
    gain: Number.isFinite(input.gain) ? Math.max(0, Math.min(2, input.gain)) : 1,
    // Speech does not duck under speech.
    duckUnderSpeech: false,
    state: "pending",
  });

  await enqueue({
    tenantId: viewer.tenantId,
    type: "video.voiceover",
    module: "video",
    payload: { trackId: id },
    createdBy: viewer.id,
    dedupeKey: `voiceover:${id}`,
    priority: 3,
  });

  await audit(viewer, "video.voiceover.request", {
    module: "video",
    objectType: "audio_track",
    objectId: id,
    meta: { characters: text.length, voiceId: input.voiceId },
  });
  return id;
}
