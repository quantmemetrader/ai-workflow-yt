import "server-only";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  videoProjects,
} from "@/lib/db/schema";
import { getObject, putObjectConfirmed, storageKey } from "@/lib/storage/r2";
import { grantOwner } from "@/lib/authz/rebac";
import { newId } from "@/lib/ids";
import { posterFromLocal, rememberPoster } from "@/lib/files/poster";
import { toSrt } from "@/lib/video/service";
import { canKaraoke, toAss } from "@/lib/video/ass";
import { asTransition, captionPreset, type TransitionKind } from "@/lib/video/presets";
import {
  brollFilter,
  graphicsAvailable,
  overlayFilter,
  punchFilter,
  renderGraphics,
  type BrollSpec,
  type GraphicSpec,
  type PunchSpec,
} from "@/lib/video/graphics";
import { asEntrance } from "@/lib/video/presets";

/**
 * The renderer. FFmpeg on this box, run by the worker, never by a request.
 *
 * What it does, in order: pull each cut's source out of storage, trim it,
 * normalise every cut to one size and frame rate, concatenate them, burn or
 * ship the captions, and put the result back in the file store as a real file
 * with real permissions.
 *
 * Four things worth knowing:
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
    const items = await db
      .select({ i: timelineItems, clip: videoClips, file: files })
      .from(timelineItems)
      .leftJoin(videoClips, eq(videoClips.id, timelineItems.clipId))
      .leftJoin(files, eq(files.id, videoClips.fileId))
      .where(eq(timelineItems.projectId, e.projectId))
      .orderBy(asc(timelineItems.ord));

    if (!items.length) throw new Error("There is nothing on the timeline");

    /*
     * One pass, not three.
     *
     * The first renderer wrote every cut to its own file, stitched those
     * through `xfade` when a dissolve was asked for, and then encoded the
     * lot a third time under the graphics and the captions. Three 1080p
     * encodes of the same picture, on a box that shares its cores with two
     * other services, was eighteen minutes for a fourteen-cut minute of
     * video before a single title had been drawn.
     *
     * Now every cut is its own input, opened with `-ss`/`-t` so the demuxer
     * reads only that cut's window, the cuts are joined by `concat` (or
     * `xfade` where a transition was asked for), and the punch-ins, graphics,
     * cutaways and captions go on the same graph. The picture is encoded
     * exactly once.
     *
     * The cuts are NOT `trim` filters on one shared input. `concat` consumes
     * its inputs in order, so while it reads the first cut the split feeding
     * the others has to buffer every frame they will eventually need: a
     * 4-minute 1080x1920 timeline is ~25GB of raw frames, and a 22-cut export
     * took 63GB and was killed by the kernel. Seeking per input costs one
     * demuxer per cut and holds nothing.
     */
    /** Local path per source file: downloaded once, seeked into many times. */
    const sourcePath = new Map<string, string>();
    /** One entry per cut — the same file appears once for each cut taken from it. */
    const inputs: { path: string; ss: number; t: number }[] = [];
    const sourceHasAudio = new Map<string, boolean>();
    const cuts: { v: string; a: string; lengthMs: number; join: Join }[] = [];
    const pre: string[] = [];
    let totalMs = 0;

    for (const [index, entry] of items.entries()) {
      const arrive: Join =
        cuts.length === 0
          ? { kind: "cut", ms: 0 }
          : { kind: asTransition(entry.i.transition), ms: Math.max(80, Math.min(4000, entry.i.transitionMs)) };
      const n = cuts.length;

      if (entry.i.kind === "title") {
        const hold = Math.max(200, entry.i.holdMs);
        const safe = (entry.i.text ?? "").replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\u2019").slice(0, 200);
        pre.push(
          `color=c=0x111111:s=${size.w}x${size.h}:r=${FPS}:d=${(hold / 1000).toFixed(3)},` +
            `drawtext=text='${safe}':fontcolor=white:fontsize=${Math.round(size.w / 22)}:x=(w-text_w)/2:y=(h-text_h)/2:line_spacing=12,` +
            `format=yuv420p,setsar=1[c${n}v]`,
          `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${(hold / 1000).toFixed(3)},asetpts=PTS-STARTPTS[c${n}a]`,
        );
        cuts.push({ v: `[c${n}v]`, a: `[c${n}a]`, lengthMs: hold, join: arrive });
        totalMs += hold;
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
        sourceHasAudio.set(entry.file.storageKey, await hasAudio(local));
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

      const inSec = entry.i.inMs / 1000;
      const outMs = entry.i.outMs ?? entry.clip.durationMs ?? null;
      if (outMs === null) throw new Error(`The length of ${entry.file.name} is not known yet. Wait a moment and try again.`);
      const outSec = Math.max(inSec + 0.05, outMs / 1000);
      const lengthMs = Math.round((outSec - inSec) * 1000);

      // The window is cut at the demuxer by `-ss`/`-t` in buildArgs, so this
      // input carries only the cut's own frames and starts near zero; the
      // setpts still zeroes the residue left by seeking to a keyframe.
      const k = inputs.length;
      inputs.push({ path: local, ss: inSec, t: outSec - inSec });

      pre.push(
        `[${k}:v]setpts=PTS-STARTPTS,` +
          `scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2:color=black,` +
          `fps=${FPS},setsar=1,format=yuv420p[c${n}v]`,
        sourceHasAudio.get(entry.file.storageKey)
          ? `[${k}:a]asetpts=PTS-STARTPTS,` +
              `aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[c${n}a]`
          : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${(lengthMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS[c${n}a]`,
      );
      cuts.push({ v: `[c${n}v]`, a: `[c${n}a]`, lengthMs, join: arrive });
      totalMs += lengthMs;

      await db
        .update(videoExports)
        .set({ progress: Math.round(((index + 1) / items.length) * 10) })
        .where(eq(videoExports.id, exportId));
    }

    if (!cuts.length) throw new Error("Every cut's source file is missing");

    /* The join: one concat when nothing dissolves, a fold of xfade and
       acrossfade where something does. A dissolve overlaps its two cuts, so
       the film is shorter than the sum of its parts by what overlapped. */
    const { filters: joinFilters, video: joinedV, audio: joinedA, overlapMs } = joinCuts(cuts);
    pre.push(...joinFilters);
    totalMs = Math.max(0, totalMs - overlapMs);
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

    let srtPath: string | null = null;
    if (srt) {
      srtPath = path.join(dir, "captions.srt");
      await writeFile(srtPath, srt, "utf8");
    }

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
          .select({ id: files.id, key: files.storageKey, name: files.name })
          .from(files)
          .where(and(inArray(files.id, pictureIds), isNull(files.deletedAt)))
      : [];

    const pictureFiles = new Map<string, string>();
    for (const [i, picture] of pictures.entries()) {
      if (!picture.key) continue;
      const local = path.join(dir, `picture-${i}${path.extname(picture.name) || ".png"}`);
      // A picture that will not download is left out of the render rather
      // than failing it: the video is worth more than one missing still.
      const got = await download(picture.key, local).then(() => true, () => false);
      if (got) pictureFiles.set(picture.id, local);
      else console.warn(`[render] picture ${picture.id} could not be fetched; skipped`);
    }

    const specs: GraphicSpec[] = graphicRows
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

    let graphicFiles: string[] = [];
    if (specs.length) {
      if (!(await graphicsAvailable())) {
        // Say so rather than silently shipping a video without the titles
        // somebody put on the timeline.
        throw new Error("This machine cannot draw graphics: run `npm install` in remotion/.");
      }
      await db.update(videoExports).set({ progress: 15 }).where(eq(videoExports.id, exportId));
      graphicFiles = await renderGraphics(specs, { width: size.w, height: size.h, accent: project.accent, dir });
    }

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

    const usable: { path: string; startMs: number; gain: number; duck: boolean }[] = [];
    for (const [i, entry] of tracks.entries()) {
      if (!entry.key) continue;
      const local = path.join(dir, `audio-${i}${path.extname(entry.key) || ".mp3"}`);
      await download(entry.key, local);
      usable.push({
        path: local,
        startMs: entry.t.startMs,
        gain: entry.t.gain,
        duck: entry.t.duckUnderSpeech,
      });
    }

    const master = path.join(dir, "master.mp4");
    const finalArgs = buildArgs({
      inputs,
      pre,
      joinedV,
      joinedA,
      assPath,
      graphicFiles,
      graphicSpecs: specs,
      brolls,
      accent: project.accent,
      punches,
      tracks: usable,
      size,
      out: master,
    });
    await db
      .update(videoExports)
      .set({ progress: 20, command: `ffmpeg ${finalArgs.join(" ")}`.slice(0, 4000) })
      .where(eq(videoExports.id, exportId));

    // The one encode. Progress is read from FFmpeg itself, so the bar on
    // screen is the picture's own clock and not a guess.
    let lastWritten = 0;
    await runFfmpeg(finalArgs, async (doneMs) => {
      const pct = 20 + Math.min(70, Math.round((doneMs / Math.max(1, totalMs)) * 70));
      if (pct - lastWritten >= 3) {
        lastWritten = pct;
        await db.update(videoExports).set({ progress: pct }).where(eq(videoExports.id, exportId)).catch(() => {});
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
    const proxyFileId = await makeProxy({
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
    if (srt && assPath === null) {
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

    await db
      .update(videoProjects)
      .set({ masterFileId: fileId, updatedAt: new Date() })
      .where(eq(videoProjects.id, e.projectId));

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

/* ------------------------------------------------------------- ffmpeg */

/** How one cut arrives from the one before it. */
export type Join = { kind: TransitionKind; ms: number };

/** Whether a source carries a sound track at all. A clip without one still
 * needs silence on the join, or concat drops sound from everything after it. */
async function hasAudio(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file]);
    let out = "";
    child.stdout.on("data", (c) => (out += String(c)));
    child.on("error", () => resolve(false));
    child.on("close", () => resolve(out.includes("audio")));
  });
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

/**
 * One FFmpeg command for the whole film.
 *
 * The inputs are in a fixed order because the filter graph refers to them by
 * number: the sources first, each once, then a still per graphic, then a
 * trimmed cutaway per b-roll, then each audio track.
 *
 * The video chain is, in order: the cuts joined, the picture pushed in where
 * a punch asks, the graphics laid over it oldest first, the cutaways over
 * those, then the captions. Captions last means captions on top.
 */
function buildArgs(input: {
  /** One per cut: the source file and the window to read from it. */
  inputs: { path: string; ss: number; t: number }[];
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
  tracks: { path: string; startMs: number; gain: number; duck: boolean }[];
  size: { w: number; h: number };
  out: string;
}): string[] {
  const { inputs, pre, joinedV, joinedA, assPath, graphicFiles, graphicSpecs, brolls, punches, tracks, size, out } = input;

  const args: string[] = ["-y"];
  // `-ss`/`-t` ahead of `-i` cuts at the demuxer, so each input decodes only
  // its own window. Doing it here rather than with `trim` in the graph is what
  // keeps memory flat as the cut count climbs.
  for (const inp of inputs) args.push("-ss", inp.ss.toFixed(3), "-t", inp.t.toFixed(3), "-i", inp.path);
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
  for (const t of tracks) args.push("-i", t.path);

  const stillOffset = inputs.length;
  const brollOffset = stillOffset + graphicFiles.length;
  const audioOffset = brollOffset + brolls.length;

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

  const overlays = overlayFilter(graphicSpecs, { width: size.w, height: size.h, firstInput: stillOffset, from: videoLabel, out: "[vout]" });
  if (overlays) {
    video.push(overlays.filter);
    videoLabel = "[vout]";
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
      const straight = tracks.map((t, i) => (t.duck ? null : `[a${i}]`)).filter(Boolean) as string[];
      audio.push(`${duckers.join("")}amix=inputs=${duckers.length}:normalize=0[bed]`);
      audio.push(`${audioLabel}asplit=2[spk][key]`);
      audio.push(`[bed][key]sidechaincompress=threshold=0.05:ratio=8:attack=20:release=400[bedducked]`);
      audio.push(`[spk][bedducked]${straight.join("")}amix=inputs=${2 + straight.length}:duration=first:normalize=0[aout]`);
    } else {
      audio.push(`${labels.join("")}amix=inputs=${labels.length}:duration=first:normalize=0[aout]`);
    }
    audioLabel = "[aout]";
  }

  /* Speech at a broadcast level: the editor's cut sits around -15 dB where
     the raw take sat at -28, and a phone in a noisy room is where the video
     is watched. One pass, applied to the whole mix so the bed ducks with it. */
  audio.push(`${audioLabel}loudnorm=I=-16:TP=-1.5:LRA=11[anorm]`);
  audioLabel = "[anorm]";

  args.push("-filter_complex", [...video, ...audio].join(";"));
  args.push("-map", videoLabel, "-map", audioLabel);
  args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-threads", "0");
  args.push("-c:a", "aac", "-b:a", "192k", "-ar", "48000");
  args.push("-movflags", "+faststart", out);
  return args;
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
 * it. The short edge goes to 480 whichever edge that is, so 16:9, 9:16 and 1:1
 * all keep their shape, and `-2` holds the other edge to the source's ratio
 * and to an even number, which H.264 requires.
 *
 * It returns the new file's id, and throws rather than reporting a failure:
 * the one caller decides what a missing proxy means, and the answer is
 * nothing.
 */
async function makeProxy(input: {
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
  const { master, dir, name, tenantId, ownerId, folderId, folderPath, durationMs } = input;
  const out = path.join(dir, "proxy.mp4");

  await runFfmpeg([
    "-y",
    "-i",
    master,
    // Quoted because the ratio test contains the commas and colons the filter
    // parser splits on. The master is 1080 on its long edge in every aspect
    // this renders, so this only ever scales down.
    "-vf",
    "scale='if(gt(iw,ih),-2,480)':'if(gt(iw,ih),480,-2)'",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    // A keyframe every two seconds. x264 would place one every 250 frames —
    // over eight — and a player can only resume at one, so that is how far a
    // dropped scrubber can land from where it was dropped. Measured cost: 6%
    // of the file, on the one thing this proxy exists to make good.
    "-g",
    String(FPS * 2),
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-ac",
    "2",
    "-ar",
    "48000",
    // The index at the front, so the browser can play and seek from the first
    // range request instead of fetching the tail to find out how.
    "-movflags",
    "+faststart",
    out,
  ]);

  const stats = await stat(out);
  const fileId = newId("fil");
  const key = storageKey(tenantId, fileId, name);
  const stored = await putObjectConfirmed(key, await readFile(out), "video/mp4");

  await db.insert(files).values({
    id: fileId,
    tenantId,
    folderId,
    folderPath,
    name,
    kind: "video",
    mime: "video/mp4",
    sizeBytes: stats.size,
    storageKey: key,
    checksum: stored.etag,
    durationMs,
    ownerId,
    updatedBy: ownerId,
  });
  await grantOwner(ownerId, { type: "file", id: fileId });
  /* Its own still, from the master rather than from the proxy: the frame is
     cheaper to take at full size than the difference is worth arguing about,
     and a video in Files with no poster makes the thumbnail route queue a job
     that downloads this file again to draw one. */
  await posterFromLocal(master, key)
    .then((posterKey) => rememberPoster(fileId, posterKey))
    .catch((err) => console.warn(`[render] no poster for proxy ${fileId}:`, err instanceof Error ? err.message : err));

  return fileId;
}

/** Streamed to disk, not buffered: a master is measured in gigabytes. */
async function download(key: string, to: string) {
  const res = await getObject(key);
  if (!res.ok || !res.body) throw new Error(`Storage said ${res.status} for ${key}`);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(to));
}
