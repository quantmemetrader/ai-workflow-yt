import "server-only";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { audioTracks, captions, files, timelineItems, videoClips, videoExports, videoGraphics, videoProjects } from "@/lib/db/schema";
import { toSrt } from "@/lib/video/service";
import { asEntrance } from "@/lib/video/presets";
import type { BrollSpec, GraphicSpec } from "@/lib/video/graphics";
import type { RenderInput, TrackInput } from "@/lib/video/render";
import type { CutawaySpec } from "@/lib/video/layout";
import type { GraphicSpecV2 } from "@/lib/video/v2/types";
import type { DirectorV2Record } from "@/lib/video/v2/persist";
import { directorV2ForTenant } from "@/lib/video/v2/flag";
import { faceTrackForFile } from "@/lib/video/face";
import { localTake } from "@/lib/video/v2/cache";
import { captionsAss, furnitureStill, motionTake, v2RenderPlan, V2_PRESET, withImageExt } from "@/lib/video/v2/pipeline";
import { FURNITURE } from "@/lib/video/v2/render-plan";

/**
 * A director v2 video, read back from its rows for the export's renderer.
 *
 * The director writes a v2 video down as rows the editor can change — the
 * take's pieces on the timeline, the reel captions with their English, the
 * graphics and cutaways in `video_graphics` with their props in `options` —
 * and its framing, layout hints and render record on `video_projects.director.v2`.
 * This turns them back into the plan the lab renders (`lib/video/v2/pipeline.ts:v2RenderPlan`):
 * the take framed on the face per stretch, the cutaways in their layouts,
 * every graphic a Remotion motion clip, the furniture one still, the ASS
 * captions clear of the chin, the voice chain. So an edit made in the
 * editor after the director (a line of text, a graphic moved) is in the
 * next render, and a render from the editor is the director's render.
 *
 * `null` when the export is not a v2 one — no v2 record, not 9:16, the
 * tenant's flag off (the rollback), or a timeline that is no longer the one
 * take — and the caller renders it the v1 way, exactly as before.
 */

type ExportRow = typeof videoExports.$inferSelect;
type ProjectRow = typeof videoProjects.$inferSelect;
type GraphicRow = typeof videoGraphics.$inferSelect;

/** The keys `toRows` adds to a graphic's props when it writes them into `options`, taken off again. */
const ROW_KEYS = new Set(["zone", "v2", "asset", "credit", "planId"]);

const EXT_BY_MIME: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg", "video/mp4": ".mp4" };

export async function loadRenderInputV2(input: {
  e: ExportRow;
  project: ProjectRow;
  dir: string;
  download: (key: string, to: string) => Promise<void>;
  onProgress?: (pct: number) => Promise<void> | void;
}): Promise<{ plan: RenderInput; srt: string | null } | null> {
  const { e, project, dir, download } = input;
  const rec = (project.director as { v2?: DirectorV2Record["v2"] } | null)?.v2;
  const meta = rec?.version === 2 ? rec.render : undefined;
  if (!rec || !meta || e.aspect !== "9:16") return null;
  if (!(await directorV2ForTenant(e.tenantId))) return null;

  /* ---- the take --------------------------------------------------------- */
  const items = await db
    .select({ i: timelineItems, clip: videoClips })
    .from(timelineItems)
    .leftJoin(videoClips, eq(videoClips.id, timelineItems.clipId))
    .where(eq(timelineItems.projectId, e.projectId))
    .orderBy(asc(timelineItems.ord));
  if (!items.length) throw new Error("There is nothing on the timeline");
  if (items.some((x) => x.i.kind !== "clip" || !x.clip || x.clip.fileId !== meta.fileId)) {
    console.warn(`[render-v2] ${e.projectId}: the timeline is no longer the director's one take; rendering the v1 way`);
    return null;
  }
  const [take] = await db
    .select({ id: files.id, name: files.name, storageKey: files.storageKey, sizeBytes: files.sizeBytes })
    .from(files)
    .where(and(eq(files.id, meta.fileId), isNull(files.deletedAt)))
    .limit(1);
  if (!take?.storageKey) throw new Error("The take this video was cut from has been deleted");
  const raw = await localTake({ id: take.id, name: take.name, storageKey: take.storageKey, sizeBytes: take.sizeBytes === null ? null : Number(take.sizeBytes) }, download);
  await input.onProgress?.(5);
  const face = await faceTrackForFile(take.id, raw, { clipId: meta.clipId });
  const pieces = items.map((x) => {
    const outMs = x.i.outMs ?? x.clip!.durationMs;
    if (outMs === null || outMs === undefined) throw new Error("The length of the take is not known yet. Wait a moment and try again.");
    return { clipId: x.clip!.id, inMs: x.i.inMs, outMs };
  });

  /* ---- files the rows point at, pulled once each ------------------------ */
  const pulled = new Map<string, string | null>();
  const pull = async (fileId: string | null | undefined): Promise<string | null> => {
    if (!fileId || fileId.startsWith("local:")) return null;
    if (pulled.has(fileId)) return pulled.get(fileId)!;
    const [row] = await db
      .select({ key: files.storageKey, name: files.name, mime: files.mime })
      .from(files)
      .where(and(eq(files.id, fileId), isNull(files.deletedAt)))
      .limit(1);
    let local: string | null = null;
    if (row?.key) {
      const ext = EXT_BY_MIME[(row.mime ?? "").split(";")[0].trim()] ?? (path.extname(row.name) || ".bin");
      const dest = path.join(dir, `asset-${pulled.size}${ext}`);
      local = await download(row.key, dest).then(
        () => dest,
        (err) => {
          console.warn(`[render-v2] ${fileId} could not be fetched; left out:`, err instanceof Error ? err.message : err);
          return null;
        },
      );
      if (local && /^image\//.test(row.mime ?? "")) local = await withImageExt(local, row.mime ?? undefined);
    }
    pulled.set(fileId, local);
    return local;
  };

  /* ---- captions --------------------------------------------------------- */
  const captionRows = await db
    .select()
    .from(captions)
    .where(and(eq(captions.projectId, e.projectId), eq(captions.language, e.captionLanguage)))
    .orderBy(asc(captions.startMs));
  const srt = captionRows.length ? toSrt(captionRows.map((c) => ({ id: c.id, startMs: c.startMs, endMs: c.endMs, text: c.text, language: c.language }))) : null;
  if (srt) await writeFile(path.join(dir, "captions.srt"), srt, "utf8");
  let assFile: string | undefined;
  if (captionRows.length && e.burnCaptions === "burn") {
    const others = await db
      .select({ startMs: captions.startMs, text: captions.text })
      .from(captions)
      .where(and(eq(captions.projectId, e.projectId), sql`${captions.language} <> ${e.captionLanguage}`));
    const secondAt = new Map(others.map((o) => [o.startMs, o.text]));
    assFile = path.join(dir, "captions.ass");
    const ass = await captionsAss(
      captionRows.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text, words: c.words, keywords: c.keywords, second: secondAt.get(c.startMs) ?? null })),
      { accent: project.accent, chinY: meta.chinY, preset: project.captionPreset || meta.preset || V2_PRESET },
    );
    await writeFile(assFile, ass, "utf8");
  }

  /* ---- graphics: cutaways, furniture, motion, and what the editor added -- */
  const rows = await db.select().from(videoGraphics).where(eq(videoGraphics.projectId, e.projectId)).orderBy(asc(videoGraphics.startMs), asc(videoGraphics.ord));
  const clipFiles = await clipFileIds(rows.map((g) => String((g.options as Record<string, unknown> | null)?.clipId ?? "")).filter(Boolean));
  const read = readRows(rows, (clipId) => clipFiles.get(clipId));
  const cutaways: CutawaySpec[] = [];
  for (const c of read.cutaways) {
    const local = await pull(c.fileId);
    if (local) cutaways.push({ ...c.spec, asset: { ...c.spec.asset, localPath: local } });
  }
  await fillPictures(read.specs, pull);
  const specs = read.specs;
  const stills: GraphicSpec[] = [];
  for (const x of read.stills) {
    const local = await pull(x.fileId);
    if (local) stills.push({ ...x.spec, imagePath: local });
  }
  const brolls: BrollSpec[] = [];
  for (const x of read.brolls) {
    const local = await pull(x.fileId);
    if (local) brolls.push({ ...x.spec, path: local });
  }
  await input.onProgress?.(8);

  const furniture = await furnitureStill(specs.filter((g) => FURNITURE.has(g.kind)), {
    accent: project.accent,
    dir,
    placement: (kind) => {
      const row = rows.find((r) => r.kind === kind);
      return row ? { placement: row.placement, scale: row.scale } : undefined;
    },
  });
  const motion = await motionTake(specs, { accent: project.accent, dir }, { log: (l) => console.log(`[render-v2 ${e.projectId}] ${l}`) });
  await input.onProgress?.(12);

  const { plan, skipped } = await v2RenderPlan({
    raw,
    pieces,
    cutZooms: rec.framing,
    renderHints: rec.renderHints,
    cutaways,
    face,
    motion: motion.clips,
    furniture,
    assFile,
    accent: project.accent,
    workDir: dir,
  });
  if (skipped.length) console.warn(`[render-v2] ${e.projectId}: ${skipped.length} cutaways left out: ${skipped.map((s) => `${s.id} (${s.reason})`).join(", ")}`);
  if (stills.length) plan.stills = stills;
  if (brolls.length) plan.brolls = brolls;
  const tracks = await editorTracks(e.projectId, dir, download);
  if (tracks.length) plan.tracks = tracks;
  return { plan, srt };
}

/* ------------------------------------------------------------ pure part */

/** A `video_graphics` row, as far as reading it back needs. */
export type RowLike = Pick<GraphicRow, "id" | "kind" | "text" | "sub" | "startMs" | "endMs" | "fileId" | "placement" | "scale" | "icon"> & { options: Record<string, unknown> | null };

/**
 * The rows back into what the layout wrote (pure): the cutaways as
 * `CutawaySpec`s (their file still to pull), every other graphic as a
 * `GraphicSpecV2` with its props out of `options` (pictures still to pull),
 * and what the editor added by hand — a picture, a cutaway from the bin —
 * as the v1 specs it has always been drawn with. Punch rows are left out:
 * the pushes are in the framing (`director.v2.framing`).
 */
export function readRows(rows: readonly RowLike[], clipFile: (clipId: string) => string | undefined): {
  cutaways: { spec: CutawaySpec; fileId: string | null }[];
  specs: GraphicSpecV2[];
  stills: { spec: Omit<GraphicSpec, "imagePath">; fileId: string | null }[];
  brolls: { spec: Omit<BrollSpec, "path">; fileId: string | null }[];
} {
  const out: ReturnType<typeof readRows> = { cutaways: [], specs: [], stills: [], brolls: [] };
  for (const g of rows) {
    if (g.endMs <= g.startMs || g.kind === "punch") continue;
    const o = (g.options ?? {}) as Record<string, unknown>;
    const clipId = String(o.clipId ?? "");
    if ((g.kind === "broll" || g.kind === "image") && typeof o.layout === "string") {
      const asset = (o.asset ?? {}) as CutawaySpec["asset"];
      const fileId = (g.kind === "image" ? g.fileId : String(o.fileId ?? "") || clipFile(clipId)) || asset.fileId || null;
      out.cutaways.push({
        fileId,
        spec: {
          id: String(o.planId ?? g.id),
          beatId: String(o.beatId ?? ""),
          sentenceId: "",
          startMs: g.startMs,
          endMs: g.endMs,
          sourceInMs: Number(o.sourceInMs ?? 0) || 0,
          layout: o.layout as CutawaySpec["layout"],
          cropX: Number(o.cropX ?? 0.5),
          still: g.kind === "image" || o.still === true,
          ...(typeof o.runId === "string" && o.runId ? { runId: o.runId } : {}),
          kind: g.kind === "image" ? "image" : "video",
          score: Number(o.score ?? 0),
          reasonZh: String(o.why ?? ""),
          label: g.text,
          asset,
          candidate: asset.candidate,
          credit: String(o.credit ?? ""),
        },
      });
      continue;
    }
    if (g.kind === "broll") {
      /* A cutaway the editor added from the bin: the v1 placement. */
      out.brolls.push({ fileId: clipFile(clipId) ?? null, spec: { startMs: g.startMs, endMs: g.endMs, sourceInMs: Math.max(0, Number(o.sourceInMs ?? 0) || 0), placement: g.placement || "full", scale: g.scale } });
      continue;
    }
    if (g.kind === "image") {
      /* A picture the editor added: drawn as a still, the v1 way. */
      out.stills.push({ fileId: g.fileId, spec: { kind: "image", text: g.text, sub: g.sub, startMs: g.startMs, endMs: g.endMs, imageMime: null, icon: g.icon, placement: g.placement, scale: g.scale, enter: asEntrance(o.enter) } });
      continue;
    }
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(JSON.parse(JSON.stringify(o)) as Record<string, unknown>)) if (!ROW_KEYS.has(k)) props[k] = v;
    if (g.text) props.text = g.text;
    if (g.sub !== null && g.sub !== undefined) props.sub = g.sub;
    const zone = (typeof o.zone === "string" ? o.zone : "T") as GraphicSpecV2["zone"];
    out.specs.push({ id: String(o.planId ?? g.id), kind: g.kind, startMs: g.startMs, endMs: g.endMs, zone, props });
  }
  return out;
}

/** Every picture a graphic shows (its logo, a headline's image, a group card's logos), pulled and pointed at. */
export async function fillPictures(specs: readonly GraphicSpecV2[], pull: (fileId: string | null | undefined) => Promise<string | null>): Promise<void> {
  for (const g of specs) {
    const p = g.props;
    for (const ref of [p.logo, p.image, ...(Array.isArray(p.group) ? (p.group as { logo?: unknown }[]).map((m) => m.logo) : [])]) {
      const a = (ref as { asset?: { fileId?: string; localPath?: string | null } } | null | undefined)?.asset;
      if (a) a.localPath = await pull(a.fileId);
    }
  }
}

/** The file behind each bin clip. */
async function clipFileIds(clipIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(clipIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const rows = await db.select({ id: videoClips.id, fileId: videoClips.fileId }).from(videoClips).where(inArray(videoClips.id, ids));
  return new Map(rows.filter((r) => r.fileId).map((r) => [r.id, r.fileId as string]));
}

/** Music and voice-over the editor laid under the cut, as the v1 loader reads them. */
async function editorTracks(projectId: string, dir: string, download: (key: string, to: string) => Promise<void>): Promise<TrackInput[]> {
  const tracks = await db
    .select({ t: audioTracks, key: files.storageKey })
    .from(audioTracks)
    .leftJoin(files, eq(files.id, audioTracks.fileId))
    .where(and(eq(audioTracks.projectId, projectId), eq(audioTracks.state, "ready")));
  const out: TrackInput[] = [];
  for (const [i, entry] of tracks.entries()) {
    if (!entry.key) continue;
    const local = path.join(dir, `audio-${i}${path.extname(entry.key) || ".mp3"}`);
    await download(entry.key, local);
    out.push({ path: local, startMs: entry.t.startMs, gain: entry.t.gain, duck: entry.t.duckUnderSpeech, speech: entry.t.kind === "voiceover" && !entry.t.duckUnderSpeech });
  }
  return out;
}
