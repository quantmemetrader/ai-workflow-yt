import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  audioTracks,
  captions,
  files,
  folders,
  timelineItems,
  videoClips,
  videoExports,
  videoGraphics,
  videoProjects, relationTuples } from "@/lib/db/schema";
import { getObject, putObjectConfirmed, storageKey } from "@/lib/storage/r2";
import { grantOwner } from "@/lib/authz/rebac";
import { newId } from "@/lib/ids";
import { posterFromLocal, rememberPoster } from "@/lib/files/poster";
import { makeProxyFile } from "@/lib/video/proxy";
import { toSrt } from "@/lib/video/service";
import { canKaraoke, toAss } from "@/lib/video/ass";
import { asTransition, captionPreset, type TransitionKind } from "@/lib/video/presets";
import {
  brollFilter,
  cutawayFilter,
  framingChain,
  furnitureFilter,
  graphicsAvailable,
  makeMasks,
  motionFilter,
  normalise,
  overlayFilter,
  punchFilter,
  pushChain,
  renderGraphics,
  type BrollSpec,
  type CutawayInput,
  type GraphicSpec,
  type HostInsert,
  type MotionInput,
  type MotionPart,
  type PunchSpec,
} from "@/lib/video/graphics";
import { asEntrance } from "@/lib/video/presets";
import type { RenderPlan } from "@/lib/video/v2/types";

/**
 * The renderer. FFmpeg on this box, run by the worker, never by a request.
 *
 * What it does, in order: pull each cut's source out of storage, trim it,
 * normalise every cut to one size and frame rate, concatenate them, burn or
 * ship the captions, and put the result back in the file store as a real file
 * with real permissions.
 *
 * Since director v2 it is two halves with a seam you can see:
 *
 *   - `loadRenderInput()` reads the database and the object store and comes
 *     back with a `RenderInput`: local files, numbers, nothing else. The
 *     export's progress row is updated as it downloads.
 *   - `renderTimeline(plan, out)` takes that and makes an mp4. It writes only
 *     under its work directory and reads nothing from the database, so the
 *     lab (`scripts/dv2/test-render.ts`) can render a plan it wrote itself,
 *     and a render that came out wrong can be replayed from its plan.
 *
 * `renderExport()` is the worker's entry and is the two halves plus the
 * store step, exactly as before. A v1 project produces the same ffmpeg
 * command it did before the split — the lab checks that argument for
 * argument — because the old path is not the one being changed.
 *
 * Four things worth knowing, unchanged:
 *
 *   1. **Every cut is re-encoded to a common format before concatenation.**
 *      FFmpeg's concat demuxer needs identical streams, and a studio's footage
 *      is never identical. This costs a pass and is the reason the output is
 *      reliable rather than usually-fine.
 *   2. **The temporary directory is removed in a `finally`.** A failed render
 *      that leaves a 4 GB master in /tmp fills the box, and a full box takes
 *      the whole product down, not just this module.
 *   3. **The exact command is stored on the export row.** A render that came
 *      out wrong is a question about what was actually run.
 *   4. **A title card is drawn, not fetched.** `drawtext` over a colour source,
 *      so a project needs no stock asset and no font upload to hold together.
 */

/** 1080p on the long edge, in each aspect the channels take. */
const SIZES: Record<string, { w: number; h: number }> = {
  "16:9": { w: 1920, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
};

const FPS = 30;
/** The bundled fonts, shared by Remotion and libass. */
const FONTS_DIR = path.join(process.cwd(), "remotion", "public", "fonts");
/** A render that has not finished in an hour is not going to. */
const RENDER_TIMEOUT_MS = 60 * 60_000;

/* ------------------------------------------------------------ the plan */

/** How one cut arrives from the one before it. */
export type Join = { kind: TransitionKind; ms: number };

/**
 * One cut of the film as the renderer takes it: the plan's cut (`file`,
 * `zoom`, `anchor`, `push`) plus what the v1 path needs to stay itself — a
 * transition in, or a drawn title card instead of footage.
 */
export type RenderCut = RenderPlan["cuts"][number] & {
  /**
   * A push's clock is the cut's own source clock, the same as `inMs`/`outMs`;
   * `rampMs` is how long the zoom takes to arrive (default: the whole window,
   * the slow push; a snap sets 167 ms, five frames). `to` is absolute.
   */
  push?: { fromMs: number; toMs: number; to: number; rampMs?: number };
  /** The face box's height as a share of the frame, for the `run` circle's crop. */
  faceHeight?: number;
  /** v1: the transition into this cut (default a hard cut). */
  join?: Join;
  /** v1: a drawn title card; `inMs` 0 and `outMs` the hold, no file. */
  title?: { text: string };
  /**
   * The cut contributes silence, not its own sound: the footage under a
   * generated narration (`options.mute`, `lib/video/narrate.ts`).
   */
  mute?: boolean;
  /** Where the anchor's y lands in the output (a share of the height); see `Framing.eyeOut`. */
  eyeOut?: number;
  /**
   * The cut continues the one before it on the same source with no edit in
   * between — only the framing changes (a card comes up and the host is
   * reframed under it). Its sound joins the previous cut's without the
   * 12 ms fades, which would otherwise dip the voice mid-word.
   */
  seam?: boolean;
};

/** `speech`: a voice-over, which keys the ducking the way filmed speech does. */
export type TrackInput = { path: string; startMs: number; gain: number; duck: boolean; speech?: boolean };

/**
 * What `renderTimeline` renders. A `RenderPlan` (the v2 contract in
 * `lib/video/v2/types.ts`) is one of these with nothing extra; the extra
 * fields carry the v1 editor's layers so the worker's existing projects go
 * through the same function unchanged.
 */
/**
 * One cutaway as the renderer takes it: the plan's, plus — for `split` —
 * where the host under the band is framed when §1's numbers do not fit the
 * presenter. §1 puts the host at 1.12 with the eye line at y ≈ 1150, which
 * lands a face whose eyes are 0.13 of the frame above its chin (蒸馏) with
 * the chin at y ≈ 1430, under the caption line; the planner that knows the
 * face track and the caption's top sets these so the chin clears it
 * (`hostEyeY = (captionTop − 40)/H − (chinY − eyeY)·hostZoom`).
 */
export type RenderCutaway = RenderPlan["cutaways"][number] & {
  /** `split`: the host's zoom under the band (default `LAYOUT.splitHostZoom`, 1.12). */
  hostZoom?: number;
  /** `split`: where the host's eye line lands, as a share of the height (default `LAYOUT.splitEyeY`, 1150/1920). */
  hostEyeY?: number;
};

export type RenderInput = Omit<RenderPlan, "cuts" | "cutaways"> & {
  cuts: RenderCut[];
  cutaways: RenderCutaway[];
  /** `v1` keeps the old command byte for byte: no framing, no fades, TP −1.5. Default `v2`. */
  mode?: "v1" | "v2";
  accent?: string;
  /** Where intermediates go (masks, stills). Default: beside the output. */
  workDir?: string;
  /** v1: editor graphics drawn as Remotion stills and faded on. */
  stills?: GraphicSpec[];
  /** v1: cutaways in the old placements (`pip`, corners, `full` at a scale). */
  brolls?: BrollSpec[];
  /** v1: whole-video punch-ins. */
  punches?: PunchSpec[];
  /** Music and voice-over tracks from the editor. */
  tracks?: TrackInput[];
};

export type RenderProgress = { phase: "graphics" | "encode"; totalMs: number; doneMs?: number; command?: string };

/* ----------------------------------------------------------- worker */

/**
 * An export is seen by whoever can see its project.
 *
 * The file list and every download go through relation tuples on the file
 * itself, never through the project — so a render that only granted its
 * requester was invisible to everyone else in Files, even when the project
 * was shared with the whole studio. The studio noticed when a second owner
 * could not find a finished cut. Whatever audience the project holds
 * (the studio, a team) is copied onto the file; the requester keeps `owner`.
 * Written directly rather than through `share()`, which needs a signed-in
 * granter holding the relation, and the worker is nobody.
 */
async function inheritProjectAudience(projectId: string, fileId: string, grantedBy: string) {
  const audience = await db
    .select({ relation: relationTuples.relation, subjectType: relationTuples.subjectType, subjectId: relationTuples.subjectId })
    .from(relationTuples)
    .where(and(eq(relationTuples.objectType, "project"), eq(relationTuples.objectId, projectId), sql`${relationTuples.subjectType} in ('tenant','team')`));
  if (!audience.length) return;
  await db
    .insert(relationTuples)
    .values(audience.map((a) => ({ id: newId("tup"), objectType: "file" as const, objectId: fileId, relation: a.relation, subjectType: a.subjectType, subjectId: a.subjectId, grantedBy })))
    .onConflictDoNothing();
}

/**
 * FFmpeg was stopped from outside, not by a fault in the render: the worker
 * was restarted under it (a deploy, a pm2 reload). The job is worth running
 * again as it was; nothing about the design needs to change.
 */
export class RenderInterrupted extends Error {
  readonly interrupted = true;
  constructor() {
    super("The render was interrupted by a restart of the worker. It starts again by itself.");
    this.name = "RenderInterrupted";
  }
}

export function isInterrupted(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { interrupted?: boolean }).interrupted === true;
}

export async function renderExport(exportId: string): Promise<{ fileId: string; durationMs: number }> {
  const [row] = await db
    .select({ e: videoExports, project: videoProjects })
    .from(videoExports)
    .innerJoin(videoProjects, eq(videoProjects.id, videoExports.projectId))
    .where(eq(videoExports.id, exportId))
    .limit(1);
  if (!row) throw new Error(`video.export: no export ${exportId}`);

  const { e, project } = row;
  const size = SIZES[e.aspect] ?? SIZES["16:9"];

  // Claimed in the statement that checks it. A row still marked "rendering"
  // is taken too: the queue hands a job to one worker at a time, so the only
  // way to arrive here on a rendering row is a worker that died under it,
  // and refusing then left the export at 20% for ever.
  const claimed = await db
    .update(videoExports)
    .set({ state: "rendering", startedAt: new Date(), progress: 0, error: null })
    .where(and(eq(videoExports.id, exportId), inArray(videoExports.state, ["queued", "rendering"])))
    .returning({ id: videoExports.id });
  if (!claimed.length) throw new Error("That render is already in hand");

  const dir = await mkdtemp(path.join(tmpdir(), "aura-render-"));

  try {
    const setProgress = (progress: number) =>
      db.update(videoExports).set({ progress }).where(eq(videoExports.id, exportId)).then(() => {}, () => {});

    const { plan, srt } = await loadRenderInput({ e, project, size, dir, onProgress: setProgress });

    const master = path.join(dir, "master.mp4");
    let lastWritten = 0;
    const { durationMs: totalMs } = await renderTimeline(plan, master, async (p) => {
      if (p.phase === "graphics") {
        await setProgress(15);
        return;
      }
      if (p.command !== undefined) {
        await db
          .update(videoExports)
          .set({ progress: 20, command: p.command.slice(0, 4000) })
          .where(eq(videoExports.id, exportId));
        return;
      }
      // The one encode. Progress is read from FFmpeg itself, so the bar on
      // screen is the picture's own clock and not a guess.
      const pct = 20 + Math.min(70, Math.round(((p.doneMs ?? 0) / Math.max(1, p.totalMs)) * 70));
      if (pct - lastWritten >= 3) {
        lastWritten = pct;
        await setProgress(pct);
      }
    });

    await db.update(videoExports).set({ progress: 90 }).where(eq(videoExports.id, exportId));

    // Into the file store, as a real file: the export is something people will
    // want to share, comment on and publish, and all of that runs on files.
    const stats = await stat(master);

    /*
     * Somebody has to own the result. Whoever asked for it, or failing that
     * whoever owns the project. An export with no owner would be a file
     * nobody can open, which is a worse outcome than refusing to make it.
     */
    const ownerId = e.requestedBy ?? project.ownerId;
    if (!ownerId) throw new Error("This render has nobody to belong to");

    /*
     * Into the owner's home folder, not nowhere. A file with a null folder is
     * a file the Files screen never lists, which would make an export
     * something you can only reach from this module.
     */
    const [home] = await db
      .select({ id: folders.id, path: folders.path })
      .from(folders)
      .where(and(eq(folders.ownerId, ownerId), isNull(folders.parentId), eq(folders.name, "__home")))
      .limit(1);

    const name = `${project.title} · ${e.aspect}.mp4`;
    const fileId = newId("fil");
    const key = storageKey(e.tenantId, fileId, name);
    const { readFile } = await import("node:fs/promises");
    const stored = await putObjectConfirmed(key, await readFile(master), "video/mp4");

    await db.insert(files).values({
      id: fileId,
      tenantId: e.tenantId,
      folderId: home?.id ?? null,
      folderPath: home?.path ?? [],
      name,
      kind: "video",
      mime: "video/mp4",
      sizeBytes: stats.size,
      storageKey: key,
      checksum: stored.etag,
      durationMs: totalMs || null,
      ownerId,
      updatedBy: ownerId,
    });
    // Without this the file exists and nobody can read it: the file list and
    // every download go through the relation, not through `ownerId`.
    await grantOwner(ownerId, { type: "file", id: fileId });
    await inheritProjectAudience(e.projectId, fileId, ownerId).catch(() => {});
    // Its thumbnail, from the master still on disk: a finished video with a
    // grey rectangle beside it in Files reads as a broken one.
    await posterFromLocal(master, key)
      .then((posterKey) => rememberPoster(fileId, posterKey))
      .catch((err) => console.warn(`[render] no poster for ${fileId}:`, err instanceof Error ? err.message : err));

    /*
     * A small copy to watch, beside the master.
     *
     * The preview player streams the rendered file itself: ~4 Mbps, 111MB for
     * a four-minute 9:16 cut, pulled out of R2 by a browser in Hong Kong. The
     * bytes are fine; the seeks are not. Every scrub is a fresh range request
     * over that round trip, and a studio watching its own cut felt it as the
     * picture "stopping sometimes". This is the same film at 480p, about a
     * twentieth of the bytes, which the browser can hold and seek inside.
     *
     * It is a convenience and the master is the deliverable, so it is wrapped
     * the way the poster above is: a proxy that will not encode leaves the
     * export finished and the screen playing the master, which is exactly
     * where this started.
     */
    const proxyFileId = await makeProxy({ projectId: e.projectId,
      master,
      dir,
      name: `${project.title} · ${e.aspect} · 预览 480p.mp4`,
      tenantId: e.tenantId,
      ownerId,
      folderId: home?.id ?? null,
      folderPath: home?.path ?? [],
      durationMs: totalMs || null,
    }).catch((err) => {
      console.warn(`[render] no preview proxy for ${fileId}:`, err instanceof Error ? err.message : err);
      return null;
    });

    /* A sidecar only when the captions were not burned in: two copies of the
       same words, one of them already on the picture, is a file nobody wants
       and a caption track YouTube would show on top of the burned one. */
    let subtitleFileId: string | null = null;
    if (srt && !plan.assFile) {
      subtitleFileId = newId("fil");
      const srtName = `${project.title} · ${e.captionLanguage}.srt`;
      const srtKey = storageKey(e.tenantId, subtitleFileId, srtName);
      const storedSrt = await putObjectConfirmed(srtKey, srt, "text/plain; charset=utf-8");
      await db.insert(files).values({
        id: subtitleFileId,
        tenantId: e.tenantId,
        folderId: home?.id ?? null,
        folderPath: home?.path ?? [],
        name: srtName,
        kind: "other",
        mime: "text/plain",
        sizeBytes: Buffer.byteLength(srt),
        storageKey: srtKey,
        checksum: storedSrt.etag,
        ownerId,
        updatedBy: ownerId,
      });
      await grantOwner(ownerId, { type: "file", id: subtitleFileId });
      await inheritProjectAudience(e.projectId, subtitleFileId, ownerId).catch(() => {});
    }

    await db
      .update(videoExports)
      .set({
        state: "done",
        progress: 100,
        fileId,
        subtitleFileId,
        proxyFileId,
        durationMs: totalMs || null,
        sizeBytes: stats.size,
        finishedAt: new Date(),
      })
      .where(eq(videoExports.id, exportId));

    /* A render is not an edit of the cut, so `updatedAt` is left alone —
       the screen reads it against the last render to know whether what is on
       the timeline has been rendered yet, and a render that touched it would
       report itself out of date the moment it finished. */
    await db
      .update(videoProjects)
      .set({ masterFileId: fileId })
      .where(eq(videoProjects.id, e.projectId));

    if (e.replaces) await supersede(e.replaces, e.tenantId, ownerId);

    return { fileId, durationMs: totalMs };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A worker restarted under the encoder is not a failed export: the job
    // goes back in the queue and the row says so, rather than showing red
    // for the minute until the next worker takes it.
    await db
      .update(videoExports)
      .set(
        isInterrupted(err)
          ? { state: "queued", progress: 0, error: null, startedAt: null }
          : { state: "failed", error: message.slice(0, 4000), finishedAt: new Date() },
      )
      .where(eq(videoExports.id, exportId));
    throw err;
  } finally {
    // A failed render must not leave a master behind: this box is also the
    // web server.
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ------------------------------------------------------------- loading */

type ExportRow = typeof videoExports.$inferSelect;
type ProjectRow = typeof videoProjects.$inferSelect;

/**
 * Everything a render reads, read: the timeline, the captions, the graphics,
 * the cutaways, the tracks, and every file they point at pulled next to each
 * other on local disk. The result is a `RenderInput` in `v1` mode — the
 * editor's own layers, exactly as the renderer always drew them. The v2
 * director builds its plan elsewhere (`lib/video/v2/persist.ts` and the lab)
 * and hands it to `renderTimeline` directly.
 */
export async function loadRenderInput(input: {
  e: ExportRow;
  project: ProjectRow;
  size: { w: number; h: number };
  dir: string;
  onProgress?: (pct: number) => Promise<void> | void;
}): Promise<{ plan: RenderInput; srt: string | null }> {
  const { e, project, size, dir } = input;
  const items = await db
    .select({ i: timelineItems, clip: videoClips, file: files })
    .from(timelineItems)
    .leftJoin(videoClips, eq(videoClips.id, timelineItems.clipId))
    .leftJoin(files, eq(files.id, videoClips.fileId))
    .where(eq(timelineItems.projectId, e.projectId))
    .orderBy(asc(timelineItems.ord));

  if (!items.length) throw new Error("There is nothing on the timeline");

  /** Local path per source file: downloaded once, seeked into many times. */
  const sourcePath = new Map<string, string>();
  const cuts: RenderCut[] = [];

  for (const [index, entry] of items.entries()) {
    const join: Join =
      cuts.length === 0
        ? { kind: "cut", ms: 0 }
        : { kind: asTransition(entry.i.transition), ms: Math.max(80, Math.min(4000, entry.i.transitionMs)) };

    if (entry.i.kind === "title") {
      const hold = Math.max(200, entry.i.holdMs);
      cuts.push({ clipId: "", file: "", inMs: 0, outMs: hold, zoom: 1, anchor: [0.5, 0.42], join, title: { text: entry.i.text ?? "" } });
      continue;
    }

    if (!entry.clip || !entry.file?.storageKey) {
      // A cut whose source has been deleted is skipped rather than failing
      // the whole render: the log says so and the rest of the cut survives.
      continue;
    }

    let local = sourcePath.get(entry.file.storageKey);
    if (local === undefined) {
      local = path.join(dir, `src-${sourcePath.size}${path.extname(entry.file.name) || ".mp4"}`);
      await download(entry.file.storageKey, local);
      sourcePath.set(entry.file.storageKey, local);
    }

    /*
     * A cut that starts past the end of its own footage.
     *
     * Said here, naming the cut, the time and the file, rather than
     * surfacing minutes later as a filter that produced nothing.
     */
    const sourceMs = entry.clip.durationMs ?? null;
    if (sourceMs !== null && entry.i.inMs >= sourceMs) {
      throw new Error(
        `Cut ${index + 1} starts at ${(entry.i.inMs / 1000).toFixed(1)}s, past the end of ` +
          `${entry.file.name} (${(sourceMs / 1000).toFixed(1)}s). Trim it, or take it off the timeline.`,
      );
    }

    const outMs = entry.i.outMs ?? entry.clip.durationMs ?? null;
    if (outMs === null) throw new Error(`The length of ${entry.file.name} is not known yet. Wait a moment and try again.`);

    /* A cut marked `mute` (the footage under a generated narration,
       `lib/video/narrate.ts`) contributes silence, not its own sound. */
    const mute = Boolean((entry.i.options as { mute?: unknown } | null)?.mute);
    cuts.push({ clipId: entry.clip.id, file: local, inMs: entry.i.inMs, outMs, zoom: 1, anchor: [0.5, 0.42], join, ...(mute ? { mute } : {}) });
    await input.onProgress?.(Math.round(((index + 1) / items.length) * 10));
  }

  if (!cuts.length) throw new Error("Every cut's source file is missing");

  const captionRows = await db
    .select()
    .from(captions)
    .where(and(eq(captions.projectId, e.projectId), eq(captions.language, e.captionLanguage)))
    .orderBy(asc(captions.startMs));

  const srt = captionRows.length
    ? toSrt(
        captionRows.map((c) => ({
          id: c.id,
          startMs: c.startMs,
          endMs: c.endMs,
          text: c.text,
          language: c.language,
        })),
      )
    : null;

  if (srt) await writeFile(path.join(dir, "captions.srt"), srt, "utf8");

  /*
   * The captions the renderer actually draws, as ASS.
   *
   * The SRT above is still written, because a sidecar file is what somebody
   * uploads to YouTube alongside the video. What gets *burned in* is this:
   * the project's chosen preset, with its one treatment, its margins and —
   * when the transcriber measured them — its word timings.
   */
  let assPath: string | null = null;
  if (captionRows.length && e.burnCaptions === "burn") {
    /* The other language's lines, for the bilingual preset: matched to the
       main line by its start, which is how the translation pass wrote them. */
    const wantsSecond = Boolean(captionPreset(project.captionPreset).style.second);
    const others = wantsSecond
      ? await db
          .select({ startMs: captions.startMs, text: captions.text })
          .from(captions)
          .where(and(eq(captions.projectId, e.projectId), sql`${captions.language} <> ${e.captionLanguage}`))
      : [];
    const secondAt = new Map(others.map((o) => [o.startMs, o.text]));

    const cues = captionRows.map((c) => ({
      startMs: c.startMs,
      endMs: c.endMs,
      text: c.text,
      words: c.words,
      keywords: c.keywords,
      second: secondAt.get(c.startMs) ?? null,
    }));

    // A preset that follows the voice, asked for on captions that were never
    // timed, would drift within a sentence. It falls back to the whole-line
    // preset rather than pretending.
    const wanted = project.captionPreset;
    const preset = captionPreset(wanted).style.karaoke && !canKaraoke(cues) ? "clean" : wanted;

    assPath = path.join(dir, "captions.ass");
    await writeFile(
      assPath,
      toAss(cues, { presetKey: preset, width: size.w, height: size.h, accent: project.accent }),
      "utf8",
    );
  }

  /*
   * Titles, lower thirds and end cards.
   *
   * Each is drawn once by Remotion as a transparent still and laid over the
   * picture by FFmpeg, which also does the fade and the slide. Rendering the
   * whole timeline through Chrome was the first design and cost thirteen
   * seconds a frame on this box; this costs about eleven seconds per
   * graphic, whatever the video's length.
   */
  const graphicRows = await db
    .select()
    .from(videoGraphics)
    .where(eq(videoGraphics.projectId, e.projectId))
    .orderBy(asc(videoGraphics.startMs));

  /* A picture graphic needs its bytes. They are pulled here, next to the
     footage, and the file is re-read from the store rather than trusted from
     the row: a graphic pointing at a file that has since been deleted draws
     nothing rather than failing the render. */
  const pictureIds = graphicRows.map((g) => g.fileId).filter((id): id is string => Boolean(id));
  const pictures = pictureIds.length
    ? await db
        .select({ id: files.id, key: files.storageKey, name: files.name, mime: files.mime })
        .from(files)
        .where(and(inArray(files.id, pictureIds), isNull(files.deletedAt)))
    : [];

  const pictureFiles = new Map<string, string>();
  const pictureMimes = new Map<string, string | null>();
  for (const [i, picture] of pictures.entries()) {
    if (!picture.key) continue;
    const local = path.join(dir, `picture-${i}${path.extname(picture.name) || ".png"}`);
    // A picture that will not download is left out of the render rather
    // than failing it: the video is worth more than one missing still.
    const got = await download(picture.key, local).then(() => true, () => false);
    if (got) {
      pictureFiles.set(picture.id, local);
      pictureMimes.set(picture.id, picture.mime ?? null);
    }
    else console.warn(`[render] picture ${picture.id} could not be fetched; skipped`);
  }

  const stills: GraphicSpec[] = graphicRows
    .filter((g) => g.kind !== "broll" && g.kind !== "punch")
    .filter((g) => (g.kind === "image" ? pictureFiles.has(g.fileId ?? "") : g.text.trim()))
    .filter((g) => g.endMs > g.startMs)
    .map((g) => ({
      kind: g.kind as GraphicSpec["kind"],
      text: g.text,
      sub: g.sub,
      startMs: g.startMs,
      endMs: g.endMs,
      imagePath: g.fileId ? (pictureFiles.get(g.fileId) ?? null) : null,
      imageMime: g.fileId ? (pictureMimes.get(g.fileId) ?? null) : null,
      icon: g.icon,
      placement: g.placement,
      scale: g.scale,
      enter: asEntrance(g.options?.enter),
    }));

  /*
   * Cutaways: a clip from the bin over the picture, the speaker's sound
   * continuing underneath. The clip is pulled from storage next to the
   * footage; a cutaway whose clip has gone is dropped rather than failing
   * the render, the same rule a missing picture follows.
   */
  const brollRows = graphicRows.filter((g) => g.kind === "broll" && g.endMs > g.startMs);
  const brollClipIds = brollRows.map((g) => String(g.options?.clipId ?? "")).filter(Boolean);
  const brollClips = brollClipIds.length
    ? await db
        .select({ id: videoClips.id, key: files.storageKey, name: files.name, durationMs: videoClips.durationMs })
        .from(videoClips)
        .innerJoin(files, eq(files.id, videoClips.fileId))
        .where(and(inArray(videoClips.id, brollClipIds), isNull(files.deletedAt)))
    : [];
  const brollLocal = new Map<string, string>();
  for (const [i, clip] of brollClips.entries()) {
    if (!clip.key) continue;
    const local = path.join(dir, `broll-${i}${path.extname(clip.name) || ".mp4"}`);
    await download(clip.key, local).catch(() => null);
    brollLocal.set(clip.id, local);
  }
  const brolls: BrollSpec[] = brollRows
    .map((g) => {
      const clipId = String(g.options?.clipId ?? "");
      const local = brollLocal.get(clipId);
      const clip = brollClips.find((c) => c.id === clipId);
      if (!local || !clip) return null;
      const sourceInMs = Math.max(0, Number(g.options?.sourceInMs ?? 0) || 0);
      // Never past the end of the cutaway's own footage.
      const available = clip.durationMs ? clip.durationMs - sourceInMs : null;
      const length = available === null ? g.endMs - g.startMs : Math.min(g.endMs - g.startMs, available);
      if (length < 200) return null;
      return {
        path: local,
        startMs: g.startMs,
        endMs: g.startMs + length,
        sourceInMs,
        placement: g.placement || "full",
        scale: g.scale,
      };
    })
    .filter((b): b is BrollSpec => b !== null);

  /* Punch-ins: the picture, not an overlay. Sorted and de-overlapped here
     so the filter can sum them. */
  const punches: PunchSpec[] = graphicRows
    .filter((g) => g.kind === "punch" && g.endMs > g.startMs)
    .map((g) => ({ startMs: g.startMs, endMs: g.endMs, zoom: Number(g.options?.zoom ?? 1.15) || 1.15 }))
    .sort((a, b) => a.startMs - b.startMs)
    .filter((p, i, all) => i === 0 || p.startMs >= all[i - 1].endMs);

  /*
   * Voice-over and music, if there are any.
   *
   * Mixed in a second pass rather than into every segment: a track is laid
   * against the *timeline*, not against one cut, and doing it per segment
   * would mean slicing each track at every edit point for no gain.
   */
  const tracks = await db
    .select({ t: audioTracks, key: files.storageKey })
    .from(audioTracks)
    .leftJoin(files, eq(files.id, audioTracks.fileId))
    .where(and(eq(audioTracks.projectId, e.projectId), eq(audioTracks.state, "ready")));

  const usable: TrackInput[] = [];
  for (const [i, entry] of tracks.entries()) {
    if (!entry.key) continue;
    const local = path.join(dir, `audio-${i}${path.extname(entry.key) || ".mp3"}`);
    await download(entry.key, local);
    usable.push({
      path: local,
      startMs: entry.t.startMs,
      gain: entry.t.gain,
      duck: entry.t.duckUnderSpeech,
      // A voice-over is speech: music that ducks under speech ducks under it.
      speech: entry.t.kind === "voiceover" && !entry.t.duckUnderSpeech,
    });
  }

  const plan: RenderInput = {
    width: size.w,
    height: size.h,
    fps: 30,
    mode: "v1",
    accent: project.accent,
    workDir: dir,
    cuts,
    cutaways: [],
    motion: [],
    assFile: assPath ?? undefined,
    audio: { voiceChain: false, cutFadeMs: 12 },
    stills,
    brolls,
    punches,
    tracks: usable,
  };
  return { plan, srt };
}

/* ----------------------------------------------------------- rendering */

/**
 * Render a plan to an mp4. Pure in the sense that matters: it reads the
 * files the plan names, writes under its work directory and the output
 * path, and touches nothing else.
 *
 * The order of work: probe what needs probing (which sources carry sound,
 * how long each motion part is), draw what needs drawing once (the v1
 * stills, the v2 masks), assemble one ffmpeg command, run it with progress.
 */
export async function renderTimeline(
  plan: RenderInput,
  outFile: string,
  onProgress?: (p: RenderProgress) => Promise<void> | void,
  opts: { dryRun?: boolean } = {},
): Promise<{ durationMs: number; command: string; args: string[] }> {
  const size = { w: plan.width, h: plan.height };
  const dir = plan.workDir ?? path.dirname(outFile);
  const mode = plan.mode ?? "v2";
  if (!plan.cuts.length) throw new Error("There is nothing on the timeline");

  /* Which sources carry a sound track at all: a clip without one still
     needs silence on the join, or concat drops sound from everything after. */
  const sourceHasAudio = new Map<string, boolean>();
  for (const c of plan.cuts) {
    if (c.title || sourceHasAudio.has(c.file)) continue;
    sourceHasAudio.set(c.file, await hasAudio(c.file));
  }

  /* One input per cut (or per push segment), the per-cut chains, the join. */
  const inputs: { path: string; ss: number; t: number; audioOnly?: boolean }[] = [];
  const cuts: { v: string; a: string; lengthMs: number; join: Join }[] = [];
  const pre: string[] = [];
  /** Where each cut sits on the film, for the v2 host inserts. */
  const placed: { cut: RenderCut; startMs: number; lengthMs: number }[] = [];
  let totalMs = 0;
  /** Where the next cut lands on the film: the sum so far less every dissolve's overlap. */
  let filmMs = 0;
  const fade = mode === "v2" && plan.audio.cutFadeMs > 0 ? plan.audio.cutFadeMs / 1000 : 0;

  for (const cut of plan.cuts) {
    const arrive: Join = cuts.length === 0 ? { kind: "cut", ms: 0 } : (cut.join ?? { kind: "cut", ms: 0 });
    const n = cuts.length;

    if (cut.title) {
      const hold = Math.max(200, cut.outMs - cut.inMs);
      const safe = cut.title.text.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").slice(0, 200);
      pre.push(
        `color=c=0x111111:s=${size.w}x${size.h}:r=${FPS}:d=${(hold / 1000).toFixed(3)},` +
          `drawtext=text='${safe}':fontcolor=white:fontsize=${Math.round(size.w / 22)}:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=12,` +
          `format=yuv420p,setsar=1[c${n}v]`,
        `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${(hold / 1000).toFixed(3)},asetpts=PTS-STARTPTS[c${n}a]`,
      );
      cuts.push({ v: `[c${n}v]`, a: `[c${n}a]`, lengthMs: hold, join: arrive });
      filmMs += hold - overlapOf(arrive, cuts);
      totalMs += hold;
      continue;
    }

    const inSec = cut.inMs / 1000;
    const outSec = Math.max(inSec + 0.05, cut.outMs / 1000);
    const lengthMs = Math.round((outSec - inSec) * 1000);
    const framing = { zoom: cut.zoom, anchor: cut.anchor, ...(cut.eyeOut !== undefined ? { eyeOut: cut.eyeOut } : {}) };
    /* No fade on a seam's side: the sound runs straight through a reframe. */
    const nextCut = plan.cuts[plan.cuts.indexOf(cut) + 1];
    const edges = { in: !cut.seam, out: !nextCut?.seam };
    const tail = `fps=${FPS},setsar=1,format=yuv420p`;

    /*
     * v2: every cut is exactly as long as the plan says, to the frame and to
     * the sample.
     *
     * ffmpeg's input `-t` on its own leaves each cut's picture up to a frame
     * long — the frame that covers the seek point is kept, and the last one
     * runs past `-t` — and `concat` stretches the film by the longest stream
     * of every segment. Measured: 11 cuts came out 193 ms long, and the
     * 70–100 cuts of a v2 edit would come out well over a second long, with
     * every caption, cutaway and motion clip placed on the plan's clock
     * landing early by that much by the end. So the picture is cut to
     * floor(length × fps) frames and the sound to the length exactly: the
     * sound sets each segment's length, the picture is never longer than it,
     * and the frame it may be short is repeated by the encoder's constant
     * frame rate at the cut, where nobody sees a held frame. The plan's clock
     * and the film's are then the same clock. The v1 path keeps its own
     * command (and its 127 ms), byte for byte.
     */
    const exact = mode === "v2";
    const cutFrames = Math.floor((lengthMs * FPS) / 1000 + 1e-6);
    const frameTrim = (frames: number) => (exact ? `,trim=end_frame=${Math.max(1, frames)}` : "");
    /* A few frames of decode slack past the trim, so the trim always has
       the frames it counts to. */
    const slack = exact ? 3 / FPS : 0;

    /*
     * The push, as its own segment. The window is cut out of the cut, the
     * per-frame scale runs on those frames only, and the three pieces are
     * joined back; the audio is read once for the whole cut from a separate
     * demuxer so the segment seams never touch it. The frames are shared
     * out so the three pieces sum to the cut's own count.
     */
    const push = mode === "v2" && cut.push ? clampPush(cut.push, cut.inMs, cut.outMs) : null;
    if (push) {
      const bounds = [cut.inMs, push.fromMs, push.toMs, cut.outMs];
      const kept: { a: number; b: number; s: number }[] = [];
      for (let s = 0; s < 3; s++) if (bounds[s + 1] - bounds[s] >= 34) kept.push({ a: bounds[s], b: bounds[s + 1], s });
      const segs: string[] = [];
      let assigned = 0;
      kept.forEach(({ a, b, s }, idx) => {
        const last = idx === kept.length - 1;
        const frames = last ? Math.max(1, cutFrames - assigned) : Math.floor(((b - a) * FPS) / 1000 + 1e-6);
        assigned += frames;
        const k = inputs.length;
        inputs.push({ path: cut.file, ss: a / 1000, t: (b - a) / 1000 + slack });
        const chain = s === 1 ? pushChain(framing, push.to, (push.rampMs ?? push.toMs - push.fromMs) / 1000, { width: size.w, height: size.h }) : framingChain(framing, { width: size.w, height: size.h });
        pre.push(`[${k}:v]setpts=PTS-STARTPTS,${normalise(size.w, size.h)}${chain}${tail}${frameTrim(frames)}[c${n}s${s}]`);
        segs.push(`[c${n}s${s}]`);
      });
      pre.push(segs.length === 1 ? `${segs[0]}null[c${n}v]` : `${segs.join("")}concat=n=${segs.length}:v=1:a=0[c${n}v]`);
      const ka = inputs.length;
      inputs.push({ path: cut.file, ss: inSec, t: outSec - inSec, audioOnly: true });
      pre.push(audioChain(ka, (sourceHasAudio.get(cut.file) ?? false) && !cut.mute, lengthMs, fade, exact, `[c${n}a]`, edges));
    } else {
      // The window is cut at the demuxer by `-ss`/`-t` in buildArgs, so this
      // input carries only the cut's own frames and starts near zero; the
      // setpts still zeroes the residue left by seeking to a keyframe.
      const k = inputs.length;
      inputs.push({ path: cut.file, ss: inSec, t: outSec - inSec + slack });
      const chain = mode === "v2" ? framingChain(framing, { width: size.w, height: size.h }) : "";
      pre.push(`[${k}:v]setpts=PTS-STARTPTS,${normalise(size.w, size.h)}${chain}${tail}${frameTrim(cutFrames)}[c${n}v]`);
      pre.push(audioChain(k, (sourceHasAudio.get(cut.file) ?? false) && !cut.mute, lengthMs, fade, exact, `[c${n}a]`, edges));
    }
    cuts.push({ v: `[c${n}v]`, a: `[c${n}a]`, lengthMs, join: arrive });
    filmMs -= overlapOf(arrive, cuts);
    placed.push({ cut, startMs: filmMs, lengthMs });
    filmMs += lengthMs;
    totalMs += lengthMs;
  }

  /* The join: one concat when nothing dissolves, a fold of xfade and
     acrossfade where something does. A dissolve overlaps its two cuts, so
     the film is shorter than the sum of its parts by what overlapped. */
  const { filters: joinFilters, video: joinedV, audio: joinedA, overlapMs } = joinCuts(cuts);
  pre.push(...joinFilters);
  totalMs = Math.max(0, totalMs - overlapMs);

  /* v1 stills, drawn by Remotion. A dry run names the files without drawing
     them: it only wants the command. */
  const stills = plan.stills ?? [];
  let graphicFiles: string[] = [];
  if (stills.length) {
    if (opts.dryRun) graphicFiles = stills.map((_, i) => path.join(dir, `graphic-${i}.png`));
    else {
      if (!(await graphicsAvailable())) {
        // Say so rather than silently shipping a video without the titles
        // somebody put on the timeline.
        throw new Error("This machine cannot draw graphics: run `npm install` in remotion/.");
      }
      await onProgress?.({ phase: "graphics", totalMs });
      graphicFiles = await renderGraphics(stills, { width: size.w, height: size.h, accent: plan.accent ?? "#007be0", dir });
    }
  }

  /* v2 layers: the cutaways with their host inserts and masks, the motion
     parts with their lengths, the furniture. */
  const cutaways = mode === "v2" ? await prepareCutaways(plan, placed, dir) : [];
  const motion = mode === "v2" ? await prepareMotion(plan.motion ?? []) : [];

  const finalArgs = buildArgs({
    inputs,
    pre,
    joinedV,
    joinedA,
    assPath: plan.assFile ?? null,
    graphicFiles,
    graphicSpecs: stills,
    brolls: plan.brolls ?? [],
    accent: plan.accent,
    punches: plan.punches ?? [],
    tracks: plan.tracks ?? [],
    size,
    out: outFile,
    v2: mode === "v2" ? { cutaways, motion, furniture: plan.furniture ?? null, audio: plan.audio } : null,
  });

  /* The voice chain's loudness in two passes when asked for: the first
     measures the joined speech, the second normalises linearly against it,
     which lands on −16 LUFS where the one-pass mode drifts with the
     material. A measurement that fails leaves the one-pass filter in. Only
     when the voice is the whole mix: the measurement is of the speech alone,
     and a linear gain worked out from it would be wrong for a mix with a
     music bed or an editor's track under it — those keep the one-pass
     normaliser on the mix, as v1 does. */
  let args = finalArgs;
  const voiceIsTheMix = !(plan.tracks?.length) && !plan.audio.music && !(plan.audio.sfx?.length);
  if (mode === "v2" && plan.audio.voiceChain && voiceIsTheMix && !opts.dryRun) {
    const measured = await measureLoudness(inputs, pre, joinedA).catch((err) => {
      console.warn("[render] loudness measurement failed; one-pass loudnorm:", err instanceof Error ? err.message : err);
      return null;
    });
    if (measured) args = finalArgs.map((a) => a.replace(LOUDNORM_V2, `${LOUDNORM_V2}:${measured}`));
  }

  const command = `ffmpeg ${args.join(" ")}`;
  if (opts.dryRun) return { durationMs: totalMs, command, args };
  await onProgress?.({ phase: "encode", totalMs, doneMs: 0, command });
  await runFfmpeg(args, onProgress ? (doneMs) => onProgress({ phase: "encode", totalMs, doneMs }) : undefined);
  return { durationMs: totalMs, command, args };
}

/** A push clamped inside its cut; null when nothing of it is left. */
function clampPush(push: NonNullable<RenderCut["push"]>, inMs: number, outMs: number): NonNullable<RenderCut["push"]> | null {
  const fromMs = Math.max(inMs, Math.min(outMs, push.fromMs));
  const toMs = Math.max(fromMs, Math.min(outMs, push.toMs));
  if (toMs - fromMs < 100 || !(push.to > 1)) return null;
  return { ...push, fromMs, toMs };
}

/**
 * The per-cut audio chain, with the v2 12 ms fades when `fade` is set, and
 * — when `exact` — padded and trimmed to the cut's length to the sample, so
 * the sound is what sets the length of every segment of the join (see the
 * cut loop in `renderTimeline`), and the fade-out ends on the last sample.
 */
function audioChain(input: number, hasSound: boolean, lengthMs: number, fade: number, exact: boolean, label: string, edges: { in: boolean; out: boolean } = { in: true, out: true }): string {
  const len = (lengthMs / 1000).toFixed(3);
  if (!hasSound) return `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${len},asetpts=PTS-STARTPTS${label}`;
  const trim = exact ? `,apad,atrim=end=${len}` : "";
  const fadeIn = fade > 0 && edges.in ? `,afade=t=in:st=0:d=${fade.toFixed(3)}` : "";
  const fadeOut = fade > 0 && edges.out ? `,afade=t=out:st=${Math.max(0, lengthMs / 1000 - fade).toFixed(3)}:d=${fade.toFixed(3)}` : "";
  const fades = `${fadeIn}${fadeOut}`;
  return `[${input}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo${trim}${fades}${label}`;
}

/** How much a dissolve into this cut eats of the running length. */
function overlapOf(join: Join, cuts: { lengthMs: number }[]): number {
  if (join.kind === "cut" || cuts.length < 2) return 0;
  const prev = cuts[cuts.length - 2].lengthMs;
  const cur = cuts[cuts.length - 1].lengthMs;
  return Math.max(80, Math.min(join.ms, prev - 40, cur - 40));
}

/** A cutaway of the plan with what the renderer adds before it is an input. */
type PreparedCutaway = RenderCutaway & {
  hosts: { file: string; inMs: number; outMs: number; startMs: number; endMs: number; anchor: [number, number]; faceHeight: number }[];
  mask: string | null;
};

/**
 * The v2 cutaways with their host inserts: for each `split` window, and for
 * each `run` group, the pieces of the source under that window, found by
 * walking the placed cuts. A run group's circle rides on its last item so
 * the presenter holds still while the footage behind her changes and no
 * clip of the run is laid on after her.
 */
async function prepareCutaways(plan: RenderInput, placed: { cut: RenderCut; startMs: number; lengthMs: number }[], dir: string): Promise<PreparedCutaway[]> {
  const list = (plan.cutaways ?? []).filter((c) => c.endMs > c.startMs).sort((a, b) => a.startMs - b.startMs);
  if (!list.length) return [];
  const masks = list.some((c) => c.layout === "split" || c.layout === "run") ? await makeMasks({ width: plan.width, height: plan.height, dir }) : null;

  const piecesUnder = (startMs: number, endMs: number) => {
    const out: PreparedCutaway["hosts"] = [];
    for (const p of placed) {
      const a = Math.max(startMs, p.startMs);
      const b = Math.min(endMs, p.startMs + p.lengthMs);
      if (b - a < 34) continue;
      out.push({
        file: p.cut.file,
        inMs: p.cut.inMs + (a - p.startMs),
        outMs: p.cut.inMs + (b - p.startMs),
        startMs: a,
        endMs: b,
        anchor: p.cut.anchor,
        faceHeight: p.cut.faceHeight ?? 0.22,
      });
    }
    return out;
  };

  return list.map((c) => {
    if (c.layout === "split") return { ...c, hosts: piecesUnder(c.startMs, c.endMs), mask: masks?.rounded ?? null };
    if (c.layout === "run") {
      /* The circle rides on the group's LAST item: the chain lays the
         cutaways on in time order, so a circle drawn with the first clip
         would be painted over by the second clip's full-frame footage. */
      const group = c.runId ? list.filter((o) => o.layout === "run" && o.runId === c.runId) : [c];
      const last = group[group.length - 1] === c;
      const hosts = last ? piecesUnder(Math.min(...group.map((o) => o.startMs)), Math.max(...group.map((o) => o.endMs))) : [];
      return { ...c, hosts, mask: hosts.length ? (masks?.circle ?? null) : null };
    }
    return { ...c, layout: "full" as const, hosts: [], mask: null };
  });
}

/** A motion clip with each part's length measured, ready to be an input. */
type PreparedMotion = Omit<MotionInput, "parts"> & { parts: { full?: Omit<MotionPart, "input">; in?: Omit<MotionPart, "input">; hold?: Omit<MotionPart, "input">; out?: Omit<MotionPart, "input"> } };

async function prepareMotion(clips: RenderPlan["motion"]): Promise<PreparedMotion[]> {
  const out: PreparedMotion[] = [];
  for (const c of clips) {
    if (c.endMs <= c.startMs) continue;
    const parts: PreparedMotion["parts"] = {};
    for (const key of ["full", "in", "hold", "out"] as const) {
      const p = c.parts[key];
      if (!p) continue;
      const still = key === "hold" || /\.(png|jpe?g|webp)$/i.test(p);
      parts[key] = { path: p, still, durationMs: still ? 0 : await clipLengthMs(p) };
    }
    if (!parts.full && !parts.in && !parts.hold && !parts.out) continue;
    out.push({ id: c.id, startMs: c.startMs, endMs: c.endMs, x: c.x, y: c.y, w: c.w, h: c.h, parts });
  }
  return out;
}

/* ------------------------------------------------------------- ffmpeg */

/**
 * ffprobe's stdout, or "" when it will not start, fails, or does not answer
 * within the limit. A probe of a local file answers in well under a second;
 * one that has not answered in a minute is stuck on a broken file or a dead
 * mount, and a render that waits on it for ever is a worker that never
 * takes the next job.
 */
function probe(args: string[], timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", ["-v", "error", ...args], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (c) => (out += String(c)));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve("");
    }, timeoutMs);
    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out : "");
    });
  });
}

/** Whether a source carries a sound track at all. */
async function hasAudio(file: string): Promise<boolean> {
  const out = await probe(["-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file]);
  return out.includes("audio");
}

/**
 * A short clip's exact length in frames, as milliseconds. The container's
 * duration on a 12-frame WebM rounds; the packet count does not, and the
 * hold has to start on the frame after the entrance ends, not a frame early
 * (a flash of nothing) or late (two layers of the same card).
 */
async function clipLengthMs(file: string): Promise<number> {
  const text = await probe([
    "-select_streams", "v:0", "-count_packets",
    "-show_entries", "stream=nb_read_packets,r_frame_rate:format=duration", "-of", "json", file,
  ]);
  try {
    const parsed = JSON.parse(text) as { streams?: { nb_read_packets?: string; r_frame_rate?: string }[]; format?: { duration?: string } };
    const s = parsed.streams?.[0];
    const [num, den] = (s?.r_frame_rate ?? "30/1").split("/").map(Number);
    const fps = den ? num / den : 30;
    const packets = Number(s?.nb_read_packets);
    if (packets > 0 && fps > 0) return Math.round((packets / fps) * 1000);
    const seconds = Number(parsed.format?.duration);
    if (seconds > 0) return Math.round(seconds * 1000);
  } catch {
    /* fall through */
  }
  throw new Error(`could not measure ${path.basename(file)}`);
}

/**
 * Join the cuts, dissolving where somebody asked for it.
 *
 * With no transitions it is one `concat`. With any, the run is folded left to
 * right: a hard cut in the middle is a two-input `concat`, a dissolve is an
 * `xfade` whose offset is measured against the chain's own running length,
 * because every dissolve makes the film shorter than the sum of its parts.
 * Audio follows the picture: `acrossfade` under a dissolve, a plain join
 * under a cut; a dip through black fades the sound with it.
 */
function joinCuts(cuts: { v: string; a: string; lengthMs: number; join: Join }[]): {
  filters: string[];
  video: string;
  audio: string;
  overlapMs: number;
} {
  if (cuts.length === 1) return { filters: [], video: cuts[0].v, audio: cuts[0].a, overlapMs: 0 };

  if (cuts.every((c, i) => i === 0 || c.join.kind === "cut")) {
    return {
      filters: [`${cuts.map((c) => `${c.v}${c.a}`).join("")}concat=n=${cuts.length}:v=1:a=1[pv][pa]`],
      video: "[pv]",
      audio: "[pa]",
      overlapMs: 0,
    };
  }

  const filters: string[] = [];
  let v = cuts[0].v;
  let a = cuts[0].a;
  let runMs = cuts[0].lengthMs;
  let overlapMs = 0;

  for (let i = 1; i < cuts.length; i++) {
    const c = cuts[i];
    const nv = i === cuts.length - 1 ? "[pv]" : `[jv${i}]`;
    const na = i === cuts.length - 1 ? "[pa]" : `[ja${i}]`;
    if (c.join.kind === "cut") {
      filters.push(`${v}${a}${c.v}${c.a}concat=n=2:v=1:a=1${nv}${na}`);
      runMs += c.lengthMs;
    } else {
      /* Never longer than either side of the join, and never so long that it
         eats a short cut whole. */
      const ms = Math.max(80, Math.min(c.join.ms, runMs - 40, c.lengthMs - 40));
      const offset = Math.max(0, runMs - ms);
      const kind = c.join.kind === "dip" ? "fadeblack" : "fade";
      filters.push(`${v}${c.v}xfade=transition=${kind}:duration=${(ms / 1000).toFixed(3)}:offset=${(offset / 1000).toFixed(3)}${nv}`);
      filters.push(`${a}${c.a}acrossfade=d=${(ms / 1000).toFixed(3)}:c1=tri:c2=tri${na}`);
      runMs = runMs + c.lengthMs - ms;
      overlapMs += ms;
    }
    v = nv;
    a = na;
  }

  return { filters, video: "[pv]", audio: "[pa]", overlapMs };
}

/** The v2 voice chain (§1): highpass, gentle 3:1, de-ess, then the normaliser. */
const VOICE_CHAIN = "highpass=f=80,acompressor=threshold=-18dB:ratio=3:attack=10:release=120,deesser=i=0.4:m=0.5:f=0.5";
/**
 * §1 asks for a true peak of −1 dBTP on the delivered file. The AAC encode
 * overshoots the normaliser's own ceiling by a few tenths — measured −0.9
 * on the decode against a −1 target, and −1.0 or −0.9 from one render to
 * the next against −1.3 — so the filter aims half a decibel under and the
 * file lands at or below −1 with margin to spare. The integrated loudness
 * is set by the linear gain, not by the ceiling, so −16 LUFS holds.
 */
const LOUDNORM_V2 = "loudnorm=I=-16:TP=-1.5:LRA=11";

/**
 * One FFmpeg command for the whole film.
 *
 * The inputs are in a fixed order because the filter graph refers to them by
 * number: the sources first, each once, then a still per graphic, then a
 * trimmed cutaway per b-roll, then — for a v2 plan — the cutaways, the host
 * pieces under them, their masks, the motion parts and the furniture, and
 * last the audio tracks. A v1 plan has none of the middle, so its command
 * is what it always was.
 *
 * The video chain is, in order: the cuts joined, the picture pushed in where
 * a v1 punch asks, the v1 b-roll, the v2 cutaways, the v1 stills, the
 * motion clips, the furniture, then the captions. Captions last means
 * captions on top.
 */
function buildArgs(input: {
  /** One per cut: the source file and the window to read from it. */
  inputs: { path: string; ss: number; t: number; audioOnly?: boolean }[];
  /** Per-cut normalisation and the join, already written. */
  pre: string[];
  joinedV: string;
  joinedA: string;
  /** The ASS file, when captions are being burned in. */
  assPath: string | null;
  /** Rendered stills, in the same order as `specs`. */
  graphicFiles: string[];
  graphicSpecs: GraphicSpec[];
  brolls: BrollSpec[];
  accent?: string;
  punches: PunchSpec[];
  tracks: TrackInput[];
  size: { w: number; h: number };
  out: string;
  v2: { cutaways: PreparedCutaway[]; motion: PreparedMotion[]; furniture: string | null; audio: RenderPlan["audio"] } | null;
}): string[] {
  const { inputs, pre, joinedV, joinedA, assPath, graphicFiles, graphicSpecs, brolls, punches, tracks, size, out, v2 } = input;

  const args: string[] = ["-y"];
  // `-ss`/`-t` ahead of `-i` cuts at the demuxer, so each input decodes only
  // its own window. Doing it here rather than with `trim` in the graph is what
  // keeps memory flat as the cut count climbs.
  for (const inp of inputs) args.push("-ss", inp.ss.toFixed(3), "-t", inp.t.toFixed(3), ...(inp.audioOnly ? ["-vn"] : []), "-i", inp.path);
  // A still has no duration of its own: it is looped for exactly its window
  // and not a frame longer, and the filter moves it to its place on the film.
  for (const [i, file] of graphicFiles.entries()) {
    const spec = graphicSpecs[i];
    const seconds = Math.max(0.5, (spec.endMs - spec.startMs) / 1000) + 0.1;
    args.push("-loop", "1", "-framerate", String(FPS), "-t", seconds.toFixed(3), "-i", file);
  }
  // A cutaway is read from its own in point for exactly its window.
  for (const b of brolls) {
    args.push("-ss", (b.sourceInMs / 1000).toFixed(3), "-t", ((b.endMs - b.startMs) / 1000 + 0.1).toFixed(3), "-an", "-i", b.path);
  }

  const stillOffset = inputs.length;
  const brollOffset = stillOffset + graphicFiles.length;
  let next = brollOffset + brolls.length;

  /* ---- v2 inputs ---- */
  const cutawayInputs: CutawayInput[] = [];
  const motionInputs: MotionInput[] = [];
  let furnitureInput: number | null = null;
  if (v2) {
    for (const c of v2.cutaways) {
      const seconds = (c.endMs - c.startMs) / 1000 + 0.1;
      if (c.still) args.push("-loop", "1", "-framerate", String(FPS), "-t", seconds.toFixed(3), "-i", c.file);
      else args.push("-ss", (Math.max(0, c.sourceInMs) / 1000).toFixed(3), "-t", seconds.toFixed(3), "-an", "-i", c.file);
      const entry: CutawayInput = { ...c, input: next++, hosts: [] };
      const hosts: HostInsert[] = [];
      for (const h of c.hosts) {
        args.push("-ss", (h.inMs / 1000).toFixed(3), "-t", ((h.outMs - h.inMs) / 1000 + 0.05).toFixed(3), "-an", "-i", h.file);
        hosts.push({ input: next++, startMs: h.startMs, endMs: h.endMs, anchor: h.anchor, faceHeight: h.faceHeight });
      }
      entry.hosts = hosts;
      if (c.mask) {
        args.push("-i", c.mask);
        entry.maskInput = next++;
      }
      cutawayInputs.push(entry);
    }
    for (const m of v2.motion) {
      const parts: MotionInput["parts"] = {};
      for (const key of ["full", "in", "hold", "out"] as const) {
        const p = m.parts[key];
        if (!p) continue;
        /* The alpha plane survives only through libvpx; the native VP9
           decoder reports yuv420p and the card comes out on black. */
        if (p.still) args.push("-i", p.path);
        else args.push("-c:v", "libvpx-vp9", "-i", p.path);
        parts[key] = { ...p, input: next++ };
      }
      motionInputs.push({ ...m, parts });
    }
    if (v2.furniture) {
      args.push("-i", v2.furniture);
      furnitureInput = next++;
    }
  }

  const audioOffset = next;
  for (const t of tracks) args.push("-i", t.path);
  let musicInput: number | null = null;
  const sfxInputs: number[] = [];
  if (v2?.audio.music) {
    args.push("-stream_loop", "-1", "-i", v2.audio.music.file);
    musicInput = audioOffset + tracks.length;
  }
  for (const s of v2?.audio.sfx ?? []) {
    args.push("-i", s.file);
    sfxInputs.push(audioOffset + tracks.length + (musicInput === null ? 0 : 1) + sfxInputs.length);
  }

  /* ---- video ---- */
  const video: string[] = [...pre];
  let videoLabel = joinedV;

  const punched = punchFilter(punches, { width: size.w, height: size.h, from: videoLabel, out: "[vz]" });
  if (punched) {
    video.push(punched);
    videoLabel = "[vz]";
  }

  /* Cutaways go on before the graphics: a statement or a picture over a
     cutaway is the channel's own look, and a cutaway over a statement hid
     the claim it was there to illustrate. */
  const cutaways = brollFilter(brolls, { width: size.w, height: size.h, firstInput: brollOffset, from: videoLabel, out: "[vb]", accent: input.accent });
  if (cutaways) {
    video.push(cutaways);
    videoLabel = "[vb]";
  }

  const v2cut = cutawayFilter(cutawayInputs, { width: size.w, height: size.h, from: videoLabel, out: "[vc]" });
  if (v2cut) {
    video.push(v2cut);
    videoLabel = "[vc]";
  }

  const overlays = overlayFilter(graphicSpecs, { width: size.w, height: size.h, firstInput: stillOffset, from: videoLabel, out: "[vout]" });
  if (overlays) {
    video.push(overlays.filter);
    videoLabel = "[vout]";
  }

  const motion = motionFilter(motionInputs, { from: videoLabel, out: "[vm]" });
  if (motion) {
    video.push(motion);
    videoLabel = "[vm]";
  }

  if (furnitureInput !== null) {
    video.push(furnitureFilter(furnitureInput, { from: videoLabel, out: "[vf]" }));
    videoLabel = "[vf]";
  }

  if (assPath) {
    // Every path separator and colon has to be escaped for the filter parser.
    const escaped = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    // The fonts the compositions use, for libass too, so a caption and a
    // title set in Inter are set in the same Inter.
    const fonts = FONTS_DIR.replace(/\\/g, "/").replace(/:/g, "\\:");
    video.push(`${videoLabel}ass=${escaped}:fontsdir=${fonts}[vsub]`);
    videoLabel = "[vsub]";
  }

  /* ---- audio ---- */
  const audio: string[] = [];
  let audioLabel = joinedA;

  /* The voice chain first, on the speech alone, so the compressor and the
     de-esser never see a music bed. */
  if (v2?.audio.voiceChain) {
    audio.push(`${audioLabel}${VOICE_CHAIN}[voice]`);
    audioLabel = "[voice]";
  }

  if (tracks.length) {
    const labels: string[] = [audioLabel];
    tracks.forEach((t, i) => {
      const delay = Math.max(0, Math.round(t.startMs));
      audio.push(`[${audioOffset + i}:a]adelay=${delay}|${delay},volume=${t.gain.toFixed(3)}[a${i}]`);
      labels.push(`[a${i}]`);
    });

    if (tracks.some((t) => t.duck)) {
      // Everything that ducks is folded together, pushed under the footage's
      // own sound, and only then mixed back with it.
      const duckers = tracks.map((t, i) => (t.duck ? `[a${i}]` : null)).filter(Boolean) as string[];
      /* A voice-over is speech too. Under a narration the footage is muted
         (`options.mute`, lib/video/narrate.ts), so a key made of the footage
         alone is silence and the music never ducked under the voice. Each
         voice-over is split: one copy into the mix, one into the key. */
      const speech = tracks.map((t, i) => (!t.duck && t.speech ? i : -1)).filter((i) => i >= 0);
      for (const i of speech) audio.push(`[a${i}]asplit=2[a${i}m][a${i}k]`);
      const straight = tracks.map((t, i) => (t.duck ? null : speech.includes(i) ? `[a${i}m]` : `[a${i}]`)).filter(Boolean) as string[];
      audio.push(`${duckers.join("")}amix=inputs=${duckers.length}:normalize=0[bed]`);
      if (speech.length) {
        audio.push(`${audioLabel}asplit=2[spk][keyfoot]`);
        audio.push(`[keyfoot]${speech.map((i) => `[a${i}k]`).join("")}amix=inputs=${1 + speech.length}:duration=first:normalize=0[key]`);
      } else {
        audio.push(`${audioLabel}asplit=2[spk][key]`);
      }
      audio.push(`[bed][key]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[bedducked]`);
      audio.push(`[spk][bedducked]${straight.join("")}amix=inputs=${2 + straight.length}:duration=first:normalize=0[aout]`);
    } else {
      audio.push(`${labels.join("")}amix=inputs=${labels.length}:duration=first:normalize=0[aout]`);
    }
    audioLabel = "[aout]";
  }

  /* The optional v2 bed and stingers: the bed ducks under the voice through
     the same side-chain the editor's tracks use; a stinger is dropped in at
     its moment. Both are off for the channel (no music, no SFX) and cost
     nothing when absent. */
  if (musicInput !== null && v2?.audio.music) {
    audio.push(`[${musicInput}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${v2.audio.music.gainDb.toFixed(1)}dB[mus]`);
    audio.push(`${audioLabel}asplit=2[mspk][mkey]`);
    audio.push(`[mus][mkey]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[musducked]`);
    audio.push(`[mspk][musducked]amix=inputs=2:duration=first:normalize=0[amus]`);
    audioLabel = "[amus]";
  }
  if (sfxInputs.length && v2?.audio.sfx) {
    const labels = sfxInputs.map((inp, i) => {
      const s = v2.audio.sfx![i];
      const delay = Math.max(0, Math.round(s.atMs));
      audio.push(`[${inp}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=${delay}|${delay},volume=${s.gainDb.toFixed(1)}dB[sfx${i}]`);
      return `[sfx${i}]`;
    });
    audio.push(`${audioLabel}${labels.join("")}amix=inputs=${1 + labels.length}:duration=first:normalize=0[asfx]`);
    audioLabel = "[asfx]";
  }

  /* Speech at a broadcast level: the editor's cut sits around -15 dB where
     the raw take sat at -28, and a phone in a noisy room is where the video
     is watched. One pass, applied to the whole mix so the bed ducks with it.
     The v2 chain asks for a true peak of −1 (§1); the v1 path keeps −1.5. */
  audio.push(`${audioLabel}${v2?.audio.voiceChain ? LOUDNORM_V2 : "loudnorm=I=-16:TP=-1.5:LRA=11"}[anorm]`);
  audioLabel = "[anorm]";

  args.push("-filter_complex", [...video, ...audio].join(";"));
  args.push("-map", videoLabel, "-map", audioLabel);
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-threads", "0");
  args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000");
  args.push("-movflags", "+faststart", out);
  return args;
}

/**
 * The first pass of the two-pass normaliser: the joined speech through the
 * voice chain and `loudnorm` in measure mode, audio only, no encode. Returns
 * the `measured_*` options for the second pass, or throws.
 */
async function measureLoudness(
  inputs: { path: string; ss: number; t: number; audioOnly?: boolean }[],
  pre: string[],
  joinedA: string,
): Promise<string> {
  const args: string[] = ["-hide_banner", "-nostats", "-y"];
  for (const inp of inputs) args.push("-ss", inp.ss.toFixed(3), "-t", inp.t.toFixed(3), "-vn", "-i", inp.path);
  /* Only the audio side of the per-cut chains and the join: the video
     labels are never referenced, so ffmpeg decodes no picture. */
  const audioPre = pre.filter((f) => /^\[\d+:a\]|^anullsrc|concat=n=\d+:v=1:a=1|acrossfade/.test(f)).map((f) =>
    f.includes("concat=n=") ? f.replace(/\[c\d+v\]/g, "").replace(/\[jv\d+\]|\[pv\]/g, "").replace(/:v=1:a=1/, ":v=0:a=1") : f,
  );
  args.push("-filter_complex", `${[...audioPre].join(";")};${joinedA}${VOICE_CHAIN},${LOUDNORM_V2}:print_format=json[m]`, "-map", "[m]", "-f", "null", "-");
  const text = await new Promise<string>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    /* The summary is the last thing ffmpeg prints, so the tail is kept. */
    let err = "";
    child.stderr.on("data", (c) => {
      err = (err + String(c)).slice(-20000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("the loudness pass timed out"));
    }, 10 * 60_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(err);
      else reject(new Error(`ffmpeg exited ${code}: ${err.slice(-600)}`));
    });
  });
  const m = /\{[^{}]*"input_i"[^{}]*\}/.exec(text);
  if (!m) throw new Error("no loudnorm summary in the output");
  const j = JSON.parse(m[0]) as Record<string, string>;
  const num = (k: string) => {
    const v = Number(j[k]);
    if (!Number.isFinite(v)) throw new Error(`loudnorm gave no ${k}`);
    return v;
  };
  return `measured_I=${num("input_i").toFixed(2)}:measured_TP=${num("input_tp").toFixed(2)}:measured_LRA=${num("input_lra").toFixed(2)}:measured_thresh=${num("input_thresh").toFixed(2)}:offset=${num("target_offset").toFixed(2)}:linear=true`;
}

/**
 * Put the render this one replaced in the bin.
 *
 * Asked for when the render was queued and carried out here, when there is
 * something to replace it with: the old master, its proxy and its subtitle
 * sidecar are soft-deleted (the sweep clears the bytes after thirty days, so
 * a mistake is recoverable for a month) and the row goes, because a render
 * row pointing at a deleted file is a broken line in a list.
 *
 * Never fatal. The new file is already made and the studio is waiting for it;
 * a tidy-up that fails is a line in the log, not a failed render.
 */
async function supersede(exportId: string, tenantId: string, byUserId: string): Promise<void> {
  try {
    const [old] = await db
      .select()
      .from(videoExports)
      .where(and(eq(videoExports.id, exportId), eq(videoExports.tenantId, tenantId)))
      .limit(1);
    if (!old) return;

    const ids = [old.fileId, old.proxyFileId, old.subtitleFileId].filter((v): v is string => Boolean(v));
    if (ids.length) {
      await db
        .update(files)
        .set({ deletedAt: new Date(), deletedBy: byUserId })
        .where(and(inArray(files.id, ids), eq(files.tenantId, tenantId)));
    }
    await db.delete(videoExports).where(eq(videoExports.id, exportId));
  } catch (err) {
    console.warn(`[render] could not replace ${exportId}:`, err instanceof Error ? err.message : err);
  }
}

/**
 * Run FFmpeg, and say how far it has got.
 *
 * `-progress pipe:1` writes `out_time_us=` lines as it encodes; those become
 * the export's progress figure, so the bar on screen is the encoder's own
 * clock rather than an estimate.
 */
function runFfmpeg(args: string[], onProgress?: (doneMs: number) => Promise<void> | void): Promise<void> {
  return new Promise((resolve, reject) => {
    /*
     * No `ulimit -v` here, deliberately.
     *
     * A ceiling was tried and it broke rendering outright. `ulimit -v` caps
     * the virtual address space, and a graph with twenty-odd decoders reserves
     * far more address space than it ever touches — 3.7GB resident against
     * well over 12GB reserved. The allocation failed and ffmpeg wedged at zero
     * CPU instead of erroring, which is worse than no ceiling at all.
     *
     * What actually bounds memory is the graph: cuts are seeked at the demuxer
     * (`-ss`/`-t` per input) instead of trimmed off one shared input, so
     * nothing has to be buffered while `concat` works through its inputs, and
     * usage stays flat whatever the length or cut count. If a hard cap is
     * wanted later it has to be a cgroup limit on resident memory
     * (`systemd-run -p MemoryMax=`), not an address-space limit.
     */
    const child = spawn(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-nostats", ...(onProgress ? ["-progress", "pipe:1"] : []), ...args],
      { stdio: ["ignore", onProgress ? "pipe" : "ignore", "pipe"] },
    );

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      // Bounded: a broken input can produce megabytes of the same line, and
      // this ends up in a database column.
      if (stderr.length < 8000) stderr += String(chunk);
    });

    let buffer = "";
    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        const m = /^out_time_us=(\d+)/.exec(line);
        if (m && onProgress) void onProgress(Math.round(Number(m[1]) / 1000));
      }
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("The render did not finish within an hour"));
    }, RENDER_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`FFmpeg could not start: ${err.message}`));
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      // 255 is FFmpeg's own answer to SIGTERM/SIGINT; a null code with a
      // signal is the same thing arriving harder. Neither is a render fault.
      else if (code === 255 || (code === null && signal)) reject(new RenderInterrupted());
      else reject(new Error(`FFmpeg exited ${code}: ${stderr.trim().slice(0, 1500)}`));
    });
  });
}

/**
 * The 480p copy of a finished master, stored as a file of its own.
 *
 * A second, cheap pass over the master **already on local disk**: no filter
 * graph, no download, no fonts — a straight transcode, measured at 2.2s for
 * 66s of 1080x1920 film on this box, against minutes for the render that made
 * it.
 *
 * The encode, the file row and its permissions all live in
 * `lib/video/proxy.ts` now, because uploaded source clips need exactly the
 * same thing and for a stronger reason — a master off a camera is bigger than
 * anything this renders, and sometimes in a codec the browser cannot decode
 * at all. This is the thin part that is particular to an export: who gets to
 * see it. It still throws rather than reporting a failure, because the one
 * caller decides what a missing proxy means, and the answer is nothing.
 */
async function makeProxy(input: {
  projectId: string;
  /** The finished master, still in the render's temp directory. */
  master: string;
  dir: string;
  name: string;
  tenantId: string;
  ownerId: string;
  folderId: string | null;
  folderPath: string[];
  durationMs: number | null;
}): Promise<string> {
  return makeProxyFile({
    source: input.master,
    dir: input.dir,
    name: input.name,
    tenantId: input.tenantId,
    ownerId: input.ownerId,
    folderId: input.folderId,
    folderPath: input.folderPath,
    durationMs: input.durationMs,
    // Marks the row as a copy, so a backfill does not queue a proxy of it.
    tags: ["proxy"],
    // Swallowed, as it always was here: an export is already visible to the
    // project's audience, so a proxy nobody else can read is a slow preview
    // for them, not a broken one.
    audience: (fileId) => inheritProjectAudience(input.projectId, fileId, input.ownerId).catch(() => {}),
  });
}

/** Streamed to disk, not buffered: a master is measured in gigabytes. */
async function download(key: string, to: string) {
  const res = await getObject(key);
  if (!res.ok || !res.body) throw new Error(`Storage said ${res.status} for ${key}`);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(to));
}
