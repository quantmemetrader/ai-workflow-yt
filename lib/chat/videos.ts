import "server-only";
import { and, eq, inArray, isNull, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, jobs, videoClips, videoExports, videoProjects, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { canReadFiles } from "@/lib/authz/rebac";
import { canReadProjects } from "@/lib/video/access";
import { projectsVisibleTo } from "@/lib/projects/visible";
import { aspectOf, type VideoCard, type VideoRefs } from "@/lib/chat/video-card";

/**
 * The video cards behind a list of messages, for one reader.
 *
 * Each message says what it names (`videoRefsOf`); this turns those ids into
 * cards in three reads for the whole list — the jobs, the renders, the
 * files — never one per message, and every one of them checked against
 * *this* reader:
 *
 *   — a render is drawn when its video project is one the reader may open
 *     (`canReadProjects`, the rule the editor and `/api/files` use);
 *   — a video file when the reader may read it as a file (`canReadFiles`),
 *     or it is footage in a project they may open;
 *   — "打开项目" only when that project is theirs to see
 *     (`projectsVisibleTo`).
 *
 * A message that names something the reader may not open simply carries no
 * card, the way an attachment they may not open is not listed: the message
 * still reads, and nothing about the thing leaks.
 */
export type VideoWant = { key: string } & VideoRefs;

export async function videoCardsFor(viewer: Viewer, wants: VideoWant[]): Promise<Map<string, VideoCard[]>> {
  const out = new Map<string, VideoCard[]>();
  const live = wants.filter((w) => w.exportIds.length || w.fileIds.length || w.jobIds.length);
  if (!live.length) return out;

  /* 1. Jobs first: the worker's older "渲染好了" lines name only their job,
        and the job row still knows which export it rendered. */
  const jobIds = [...new Set(live.flatMap((w) => w.jobIds))].slice(0, 100);
  const exportOfJob = new Map<string, string>();
  if (jobIds.length) {
    const rows = await db
      .select({ id: jobs.id, payload: jobs.payload, result: jobs.result })
      .from(jobs)
      .where(and(eq(jobs.tenantId, viewer.tenantId), inArray(jobs.id, jobIds), inArray(jobs.type, ["video.export", "video.direct"])));
    for (const r of rows) {
      const fromPayload = (r.payload as { exportId?: unknown } | null)?.exportId;
      const fromResult = (r.result as { exportId?: unknown } | null)?.exportId;
      const id = typeof fromPayload === "string" ? fromPayload : typeof fromResult === "string" ? fromResult : null;
      if (id) exportOfJob.set(r.id, id);
    }
  }

  const exportIds = [...new Set(live.flatMap((w) => [...w.exportIds, ...w.jobIds.map((j) => exportOfJob.get(j)).filter((v): v is string => Boolean(v))]))].slice(0, 200);
  const fileIds = [...new Set(live.flatMap((w) => w.fileIds))].slice(0, 200);

  /* 2. Renders: finished, with a file, in a video project the reader may
        open, and the project page they belong to when the reader may see it. */
  const renders = new Map<string, VideoCard>();
  if (exportIds.length) {
    const rows = await db
      .select({
        id: videoExports.id,
        aspect: videoExports.aspect,
        fileId: videoExports.fileId,
        proxyFileId: videoExports.proxyFileId,
        durationMs: videoExports.durationMs,
        sizeBytes: videoExports.sizeBytes,
        videoProjectId: videoExports.projectId,
        title: videoProjects.title,
        workId: workProjects.id,
        workTitle: workProjects.title,
      })
      .from(videoExports)
      .innerJoin(videoProjects, eq(videoProjects.id, videoExports.projectId))
      .leftJoin(workProjects, and(eq(workProjects.videoProjectId, videoProjects.id), isNull(workProjects.deletedAt), projectsVisibleTo(viewer)))
      .where(
        and(
          eq(videoExports.tenantId, viewer.tenantId),
          inArray(videoExports.id, exportIds),
          eq(videoExports.state, "done"),
          isNotNull(videoExports.fileId),
          isNull(videoProjects.deletedAt),
          canReadProjects(viewer),
        ),
      );
    for (const r of rows) {
      renders.set(r.id, {
        kind: "render",
        id: r.id,
        fileId: r.fileId!,
        proxyFileId: r.proxyFileId,
        title: r.workTitle ?? r.title,
        durationMs: r.durationMs,
        sizeBytes: r.sizeBytes,
        aspect: r.aspect,
        videoProjectId: r.videoProjectId,
        project: r.workId ? { id: r.workId, title: r.workTitle ?? r.title } : null,
        binned: false,
      });
    }
  }

  /* 3. Video files: readable as files, or footage in a project the reader
        may open — the same two doors `/api/files/[id]/download` has. */
  const videos = new Map<string, VideoCard>();
  if (fileIds.length) {
    /* The same door `fileInVisibleProject` (lib/video/access.ts) opens, as a
       predicate over the files table so one query answers for the batch. */
    const inProject = sql`exists (
      select 1 from ${videoProjects}
       where ${videoProjects.tenantId} = ${viewer.tenantId} and ${videoProjects.deletedAt} is null
         and ${canReadProjects(viewer)}
         and (exists (select 1 from ${videoClips} c where c.project_id = ${videoProjects.id} and c.file_id = ${files.id})
           or exists (select 1 from ${videoExports} e where e.project_id = ${videoProjects.id} and (e.file_id = ${files.id} or e.proxy_file_id = ${files.id}))))`;
    const rows = await db
      .select({
        id: files.id,
        name: files.name,
        proxyFileId: files.proxyFileId,
        durationMs: files.durationMs,
        sizeBytes: files.sizeBytes,
        width: files.width,
        height: files.height,
      })
      .from(files)
      .where(
        and(
          eq(files.tenantId, viewer.tenantId),
          inArray(files.id, fileIds),
          isNull(files.deletedAt),
          eq(files.kind, "video"),
          isNotNull(files.storageKey),
          isNotNull(files.checksum),
          or(canReadFiles(viewer), inProject),
        ),
      );
    if (rows.length) {
      /* Where each one is footage, for its "打开项目" and "在剪辑台打开":
         the newest project it sits in that the reader may see. */
      const homes = await db
        .select({ fileId: videoClips.fileId, videoProjectId: videoClips.projectId, workId: workProjects.id, workTitle: workProjects.title, addedAt: videoClips.addedAt })
        .from(videoClips)
        .innerJoin(videoProjects, and(eq(videoProjects.id, videoClips.projectId), isNull(videoProjects.deletedAt), canReadProjects(viewer)))
        .leftJoin(workProjects, and(eq(workProjects.videoProjectId, videoProjects.id), isNull(workProjects.deletedAt), projectsVisibleTo(viewer)))
        .where(
          inArray(
            videoClips.fileId,
            rows.map((r) => r.id),
          ),
        );
      const home = new Map<string, (typeof homes)[number]>();
      for (const h of homes) {
        const had = home.get(h.fileId);
        if (!had || h.addedAt > had.addedAt) home.set(h.fileId, h);
      }
      for (const r of rows) {
        const h = home.get(r.id);
        videos.set(r.id, {
          kind: "file",
          id: r.id,
          fileId: r.id,
          proxyFileId: r.proxyFileId,
          title: r.name,
          durationMs: r.durationMs,
          sizeBytes: r.sizeBytes,
          aspect: aspectOf(r.width, r.height),
          videoProjectId: h?.videoProjectId ?? null,
          project: h?.workId ? { id: h.workId, title: h.workTitle ?? "" } : null,
          binned: false,
        });
      }
    }
  }

  /* 4. Per message, in the order named; a render's own file is not drawn a
        second time as a plain file beside it. */
  for (const w of live) {
    const cards: VideoCard[] = [];
    const seenFiles = new Set<string>();
    const ids = [...w.exportIds, ...w.jobIds.map((j) => exportOfJob.get(j)).filter((v): v is string => Boolean(v))];
    for (const id of new Set(ids)) {
      const c = renders.get(id);
      if (c && !seenFiles.has(c.fileId)) {
        cards.push(c);
        seenFiles.add(c.fileId);
        if (c.proxyFileId) seenFiles.add(c.proxyFileId);
      }
    }
    for (const id of new Set(w.fileIds)) {
      const c = videos.get(id);
      if (c && !seenFiles.has(c.fileId)) {
        cards.push(c);
        seenFiles.add(c.fileId);
      }
    }
    if (cards.length) out.set(w.key, cards.slice(0, 6));
  }
  return out;
}
