import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { audioTracks, files, users, videoClips, videoExports, videoGraphics, videoProjects, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { canReadFiles } from "@/lib/authz/rebac";
import { projectsVisibleTo } from "@/lib/projects/visible";
import { notProxy } from "@/lib/files/service";

/**
 * The other ways to look at the top of Files: by project, and by what a file
 * is (a picture, a video, anything else).
 *
 * Computed, never stored. A file already says what it is (`mime`), and a
 * project already says which files it uses — its clips, its renders, its
 * pictures, its voice-over all point into the store by id. So "organise Files
 * by project" is a join, not a migration and not a move: nothing is copied
 * into a project folder, a file used by two projects is in both, and a file
 * nobody's project uses is 未归类. Every read is the same `canReadFiles`
 * filter the folder listing uses, so no lens can show more than the folders
 * would.
 */

export type Lens = "all" | "projects" | "images" | "videos" | "docs";
export const LENSES: readonly Lens[] = ["all", "projects", "images", "videos", "docs"];

/** `?view=` as written in the URL, or the default. Anything else is the default
 * too: an old link with a typo lands on Files, not on an error. */
export function parseLens(raw: string | string[] | undefined): Lens {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && (LENSES as readonly string[]).includes(v) && v !== "all" ? (v as Lens) : "all";
}

type Row = { file: typeof files.$inferSelect; ownerName: string; ownerAvatar: string | null };

const rowFields = { file: files, ownerName: users.name, ownerAvatar: users.avatarUrl };

/**
 * Pictures, videos, or everything else, newest first.
 *
 * Unlike the top-level listing this includes the stock: a picture the
 * director fetched for a cutaway is exactly what somebody opening 图片 is
 * looking for, and it is most of the studio's pictures. The type comes from
 * the MIME type, with the stored kind for the few rows that have none.
 */
export async function listByType(viewer: Viewer, lens: "images" | "videos" | "docs", limit = 300): Promise<Row[]> {
  const isImage = sql`(${files.mime} like 'image/%' or (${files.mime} is null and ${files.kind} = 'image'))`;
  const isVideo = sql`(${files.mime} like 'video/%' or (${files.mime} is null and ${files.kind} = 'video'))`;
  const which = lens === "images" ? isImage : lens === "videos" ? isVideo : sql`not ${isImage} and not ${isVideo}`;
  return db
    .select(rowFields)
    .from(files)
    .innerJoin(users, eq(users.id, files.ownerId))
    .where(and(isNull(files.deletedAt), canReadFiles(viewer), notProxy(), which))
    .orderBy(desc(files.updatedAt))
    .limit(limit);
}

/** What a file is to a project, in the order a project card lists them. */
export type ProjectRole = "render" | "clip" | "graphic" | "audio";
const ROLE_ORDER: ProjectRole[] = ["render", "clip", "graphic", "audio"];

export type ProjectGroup = {
  id: string;
  title: string;
  /** The latest of the project's own edit, its cut's, and its newest file. */
  activeAt: string;
  files: { role: ProjectRole; row: Row }[];
  /** Files the project uses that this person may not open. Said as a number,
   * never named: the name of a file is part of the file. */
  hidden: number;
};

/**
 * Every project this person may see, each with the files it uses that they
 * may read, newest activity first; and below them the readable files no
 * project uses.
 *
 * Which files a project uses:
 *   成片 render  — its renders (`video_exports.file_id`, the subtitle sidecar)
 *                  and the cut's master (`video_projects.master_file_id`)
 *   素材 clip    — the bin (`video_clips.file_id`), picture-shots included
 *   配图 graphic — pictures on the timeline (`video_graphics.file_id`)
 *   配音 audio   — voice-over and music (`audio_tracks.file_id`)
 * A render's proxy is not one of them: it is a copy of the render.
 *
 * "Used by no project" is asked of every project in the studio, visible or
 * not — a clip in a private project somebody else started is not 未归类 just
 * because this person cannot see the project.
 */
export async function listByProject(
  viewer: Viewer,
  looseLimit = 120,
): Promise<{ projects: ProjectGroup[]; loose: Row[]; looseTotal: number }> {
  const projects = await db
    .select({
      id: workProjects.id,
      title: workProjects.title,
      videoProjectId: workProjects.videoProjectId,
      updatedAt: workProjects.updatedAt,
      cutUpdatedAt: videoProjects.updatedAt,
      masterFileId: videoProjects.masterFileId,
    })
    .from(workProjects)
    .leftJoin(videoProjects, eq(videoProjects.id, workProjects.videoProjectId))
    .where(and(eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), projectsVisibleTo(viewer)))
    .orderBy(desc(workProjects.updatedAt));

  const cutIds = projects.map((p) => p.videoProjectId).filter((x): x is string => Boolean(x));

  /* One read per kind of link, all at once. Each is keyed by the cut, which is
     what the media tables hang off. */
  const [clips, exportsRows, graphics, audio] = cutIds.length
    ? await Promise.all([
        db.select({ cut: videoClips.projectId, fileId: videoClips.fileId }).from(videoClips).where(inArray(videoClips.projectId, cutIds)),
        db
          .select({ cut: videoExports.projectId, fileId: videoExports.fileId, subtitleFileId: videoExports.subtitleFileId })
          .from(videoExports)
          .where(inArray(videoExports.projectId, cutIds))
          .orderBy(desc(videoExports.createdAt)),
        db
          .select({ cut: videoGraphics.projectId, fileId: videoGraphics.fileId })
          .from(videoGraphics)
          .where(and(inArray(videoGraphics.projectId, cutIds), sql`${videoGraphics.fileId} is not null`)),
        db
          .select({ cut: audioTracks.projectId, fileId: audioTracks.fileId })
          .from(audioTracks)
          .where(and(inArray(audioTracks.projectId, cutIds), sql`${audioTracks.fileId} is not null`)),
      ])
    : [[], [], [], []];

  /* cut → [role, fileId] in card order. A file that is both (a render that
     was dragged back into the bin) is listed once, under its first role. */
  const links = new Map<string, { role: ProjectRole; fileId: string }[]>();
  const add = (cut: string, role: ProjectRole, fileId: string | null | undefined) => {
    if (!fileId) return;
    const list = links.get(cut) ?? [];
    list.push({ role, fileId });
    links.set(cut, list);
  };
  for (const p of projects) if (p.videoProjectId) add(p.videoProjectId, "render", p.masterFileId);
  for (const e of exportsRows) {
    add(e.cut, "render", e.fileId);
    add(e.cut, "render", e.subtitleFileId);
  }
  for (const c of clips) add(c.cut, "clip", c.fileId);
  for (const g of graphics) add(g.cut, "graphic", g.fileId);
  for (const a of audio) add(a.cut, "audio", a.fileId);

  const linkedIds = [...new Set([...links.values()].flatMap((l) => l.map((x) => x.fileId)))];

  /* The readable, live ones among them — the only rows that leave the server. */
  const readable = linkedIds.length
    ? await db
        .select(rowFields)
        .from(files)
        .innerJoin(users, eq(users.id, files.ownerId))
        .where(and(inArray(files.id, linkedIds), isNull(files.deletedAt), canReadFiles(viewer), notProxy()))
    : [];
  const byId = new Map(readable.map((r) => [r.file.id, r]));

  /* Which of the unreadable links are real files at all (and not in the bin),
     so the "N more you cannot open" count is not inflated by a deleted render. */
  const unreadable = linkedIds.filter((id) => !byId.has(id));
  const liveUnreadable = unreadable.length
    ? new Set(
        (
          await db
            .select({ id: files.id })
            .from(files)
            .where(and(inArray(files.id, unreadable), isNull(files.deletedAt), notProxy()))
        ).map((r) => r.id),
      )
    : new Set<string>();

  const groups: ProjectGroup[] = projects.map((p) => {
    const seen = new Set<string>();
    const out: { role: ProjectRole; row: Row }[] = [];
    let hidden = 0;
    const own = (p.videoProjectId && links.get(p.videoProjectId)) || [];
    const ordered = [...own].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
    for (const l of ordered) {
      if (seen.has(l.fileId)) continue;
      seen.add(l.fileId);
      const row = byId.get(l.fileId);
      if (row) out.push({ role: l.role, row });
      else if (liveUnreadable.has(l.fileId)) hidden += 1;
    }
    const times = [p.updatedAt, p.cutUpdatedAt, ...out.map((f) => f.row.file.updatedAt)]
      .filter((d): d is Date => d instanceof Date)
      .map((d) => d.getTime());
    return { id: p.id, title: p.title, activeAt: new Date(Math.max(...times)).toISOString(), files: out, hidden };
  });
  groups.sort((a, b) => b.activeAt.localeCompare(a.activeAt));

  /* 未归类: readable, live, not a proxy, not the stock (which has its own
     folder, and would otherwise be forty licensed pictures nobody used), and
     pointed at by no project's media anywhere in the studio. */
  const unused = sql`not exists (select 1 from video_clips c where c.file_id = ${files.id})
    and not exists (select 1 from video_exports x where x.file_id = ${files.id} or x.subtitle_file_id = ${files.id})
    and not exists (select 1 from video_graphics g where g.file_id = ${files.id})
    and not exists (select 1 from audio_tracks a where a.file_id = ${files.id})
    and not exists (select 1 from video_projects v where v.master_file_id = ${files.id})`;
  const looseWhere = and(isNull(files.deletedAt), canReadFiles(viewer), notProxy(), sql`not ('stock' = any(${files.tags}))`, unused);
  const [loose, [{ n }]] = await Promise.all([
    db.select(rowFields).from(files).innerJoin(users, eq(users.id, files.ownerId)).where(looseWhere).orderBy(desc(files.updatedAt)).limit(looseLimit),
    db.select({ n: sql<number>`count(*)::int` }).from(files).where(looseWhere),
  ]);

  return { projects: groups, loose, looseTotal: n };
}
