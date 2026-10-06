import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { captions, files, jobs, videoClips, videoExports } from "@/lib/db/schema";
import { enqueue } from "@/lib/jobs/queue";
import { audit } from "@/lib/audit";
import { projectById } from "@/lib/video/service";
import type { Viewer } from "@/lib/auth/dal";
import type { CapcutOptions, CapcutResult } from "@/lib/video/capcut/export";

/**
 * Asking for a 剪映 draft, and reading back how it went.
 *
 * The job row is the record (`video.capcut`, `objectId` the project): its
 * status and progress are what the dialog shows, its result names the zip.
 * No table of its own, because there is nothing to keep that the job and the
 * file do not already hold. The nightly sweep removes succeeded jobs after
 * fourteen days (`lib/jobs/retention.ts`); the list here then forgets the
 * draft, and the zip itself stays in the requester's Files.
 */

const ASPECTS = ["16:9", "9:16", "1:1"] as const;

export type CapcutJob = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  error: string | null;
  aspect: string | null;
  app: "jianying" | "capcut" | null;
  fileId: string | null;
  name: string | null;
  sizeBytes: number | null;
  notes: string[];
  createdAt: Date;
  /** False once the zip has been deleted from Files. */
  available: boolean;
};

export async function requestCapcutExport(viewer: Viewer, projectId: string, raw: { app?: unknown; aspect?: unknown; captionLanguage?: unknown }) {
  // A draft is a copy of what anyone who can see the project can already play.
  const project = await projectById(viewer, projectId, "viewer");
  if (!project) throw new Error("Not found");
  const aspect = ASPECTS.find((a) => a === raw.aspect) ?? (await suggestedAspect(projectId, project.director));
  const captionLanguage = typeof raw.captionLanguage === "string" && /^[A-Za-z-]{2,16}$/.test(raw.captionLanguage) ? raw.captionLanguage : "zh-CN";
  const app = raw.app === "capcut" ? "capcut" : "jianying";
  const options: CapcutOptions = { app, aspect, captionLanguage };

  const job = await enqueue({
    tenantId: viewer.tenantId,
    type: "video.capcut",
    module: "video",
    objectType: "video_project",
    objectId: projectId,
    payload: { projectId, options },
    createdBy: viewer.id,
    // One at a time per project and shape: pressing twice makes one zip.
    dedupeKey: `capcut:${projectId}:${app}:${aspect}:${captionLanguage}`,
    priority: 2,
  });
  await audit(viewer, "video.capcut.request", { module: "video", objectType: "video_project", objectId: projectId, meta: { app, aspect, captionLanguage } });
  return job.id;
}

/** The last few drafts made of this project, newest first, and the shape to suggest for the next. */
export async function capcutState(viewer: Viewer, projectId: string): Promise<{ jobs: CapcutJob[]; aspect: (typeof ASPECTS)[number]; languages: string[] } | null> {
  const project = await projectById(viewer, projectId, "viewer");
  if (!project) return null;
  const rows = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.tenantId, viewer.tenantId), eq(jobs.type, "video.capcut"), eq(jobs.objectId, projectId)))
    .orderBy(desc(jobs.createdAt))
    .limit(5);
  const fileIds = rows.map((r) => (r.result as CapcutResult | null)?.fileId).filter((x): x is string => Boolean(x));
  const alive = fileIds.length
    ? new Set((await db.select({ id: files.id, deletedAt: files.deletedAt }).from(files).where(inArray(files.id, fileIds))).filter((f) => !f.deletedAt).map((f) => f.id))
    : new Set<string>();
  const langRows = await db.selectDistinct({ language: captions.language }).from(captions).where(eq(captions.projectId, projectId));
  return {
    aspect: await suggestedAspect(projectId, project.director),
    languages: langRows.map((l) => l.language),
    jobs: rows.map((r) => {
      const result = (r.status === "succeeded" ? r.result : null) as CapcutResult | null;
      const options = (r.payload as { options?: CapcutOptions } | null)?.options;
      return {
        id: r.id,
        status: r.status,
        progress: r.progress,
        // The worker's own words when they are not already the studio's language.
        error: r.status === "failed" || r.status === "queued" ? readable(r.error) : null,
        aspect: options?.aspect ?? null,
        app: options?.app ?? null,
        fileId: result?.fileId ?? null,
        name: result?.name ?? null,
        sizeBytes: result?.sizeBytes ?? null,
        notes: result?.notes ?? [],
        createdAt: r.createdAt,
        available: Boolean(result?.fileId && alive.has(result.fileId)),
      };
    }),
  };
}

function readable(error: string | null): string | null {
  if (!error) return null;
  return /[\u4e00-\u9fff]/.test(error) ? error : `导出没有完成：${error.slice(0, 300)}`;
}

/**
 * The canvas a draft should open on: what the director made it at, else the
 * last render's, else the shape of the first clip. A reel exported onto a
 * 16:9 canvas would open in 剪映 with the picture letterboxed, which reads as
 * broken.
 */
async function suggestedAspect(projectId: string, director: unknown): Promise<(typeof ASPECTS)[number]> {
  const fromDirector = (director as { aspect?: unknown } | null)?.aspect;
  const a = ASPECTS.find((x) => x === fromDirector);
  if (a) return a;
  const [last] = await db.select({ aspect: videoExports.aspect }).from(videoExports).where(eq(videoExports.projectId, projectId)).orderBy(desc(videoExports.createdAt)).limit(1);
  const b = ASPECTS.find((x) => x === last?.aspect);
  if (b) return b;
  const [clip] = await db.select({ w: videoClips.width, h: videoClips.height }).from(videoClips).where(eq(videoClips.projectId, projectId)).limit(1);
  if (clip?.w && clip?.h) return clip.h > clip.w * 1.1 ? "9:16" : Math.abs(clip.w - clip.h) < clip.w * 0.1 ? "1:1" : "16:9";
  return "16:9";
}
