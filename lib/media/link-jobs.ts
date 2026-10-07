import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { enqueue } from "@/lib/jobs/queue";
import { visibleProject } from "@/lib/projects/service";
import { projectById } from "@/lib/video/service";
import { LINK_PLATFORM_LABEL, linksIn, platformOf, type LinkImportResult, type LinkPlatform } from "@/lib/media/link-import";

/**
 * Link imports as queue jobs (`media.importLink`), for the import box and
 * the assistant alike.
 *
 * On the worker rather than in the request, like every other media job: a
 * B站 explainer took 160 s to come down in testing, and a download that dies
 * with the page — or with a deploy — is a download somebody has to notice
 * never finished. A job survives both, retries a timeout on its own, and
 * leaves its reason on the row when it gives up.
 */

export type LinkTarget = { workProjectId: string | null; videoProjectId: string | null };

/**
 * The project a link is imported into, from whichever id the screen has:
 * a studio project (wp_…, the Files tab) or its cut (prj_…, the editor).
 * Null when this person may not put files there.
 */
export async function linkTarget(viewer: Viewer, projectId: string): Promise<LinkTarget | null> {
  if (projectId.startsWith("wp_")) {
    const wp = await visibleProject(viewer, projectId);
    if (!wp) return null;
    /* The cut only when this person may edit it; the file still lands in the project's 素材 box. */
    const cut = wp.videoProjectId && viewer.modules.includes("video") ? await projectById(viewer, wp.videoProjectId) : null;
    return { workProjectId: wp.id, videoProjectId: cut?.id ?? null };
  }
  if (!viewer.modules.includes("video")) return null;
  const cut = await projectById(viewer, projectId);
  if (!cut) return null;
  const [wp] = await db
    .select({ id: workProjects.id })
    .from(workProjects)
    .where(and(eq(workProjects.videoProjectId, cut.id), eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt)))
    .limit(1);
  return { workProjectId: wp?.id ?? null, videoProjectId: cut.id };
}

export type QueuedLink = { jobId: string; url: string; platform: LinkPlatform; label: string };

/** One job per link in the text, at most ten. A link already being imported into the same place is the job already running. */
export async function queueLinkImports(viewer: Viewer, text: string, target: LinkTarget, onBehalfOf?: string | null): Promise<QueuedLink[]> {
  const urls = linksIn(text);
  const out: QueuedLink[] = [];
  for (const url of urls) {
    const job = await enqueue({
      tenantId: viewer.tenantId,
      type: "media.importLink",
      module: "video",
      payload: { url, workProjectId: target.workProjectId, videoProjectId: target.videoProjectId },
      objectType: target.videoProjectId ? "video_project" : "work_project",
      objectId: target.videoProjectId ?? target.workProjectId ?? undefined,
      createdBy: viewer.id,
      onBehalfOf: onBehalfOf ?? null,
      /* Ahead of posters and proxies (6 and 5): somebody is watching the bar. */
      priority: 7,
      dedupeKey: `link:${target.videoProjectId ?? target.workProjectId ?? viewer.id}:${url}`,
    });
    const platform = platformOf(url);
    out.push({ jobId: job.id, url, platform, label: LINK_PLATFORM_LABEL[platform] });
  }
  return out;
}

export type LinkJobState = {
  jobId: string;
  url: string;
  state: "queued" | "running" | "done" | "failed";
  /** 0–1. */
  progress: number;
  /** The Chinese sentence the importer failed with, as it should be shown. */
  error: string | null;
  /** Set once done. */
  result: LinkImportResult | null;
  /** A failure that the queue will try again by itself. */
  retrying: boolean;
};

/** Where this person's link imports stand. Only their own jobs, in this studio. */
export async function linkJobStates(viewer: Viewer, jobIds: string[]): Promise<LinkJobState[]> {
  const ids = jobIds.filter((id) => typeof id === "string" && /^job_[0-9a-z]{10,40}$/i.test(id)).slice(0, 20);
  if (!ids.length) return [];
  const rows = await db
    .select({ id: jobs.id, status: jobs.status, progress: jobs.progress, error: jobs.error, result: jobs.result, payload: jobs.payload })
    .from(jobs)
    .where(and(inArray(jobs.id, ids), eq(jobs.tenantId, viewer.tenantId), eq(jobs.createdBy, viewer.id), eq(jobs.type, "media.importLink")));
  return rows.map((r) => {
    const status = String(r.status);
    const state: LinkJobState["state"] = status === "succeeded" ? "done" : status === "failed" || status === "cancelled" ? "failed" : status === "running" ? "running" : "queued";
    /* A queued job with an error is a failed attempt waiting for its retry. */
    const retrying = state === "queued" && Boolean(r.error);
    return {
      jobId: r.id,
      url: String((r.payload as { url?: unknown } | null)?.url ?? ""),
      state,
      progress: state === "done" ? 1 : Math.max(0, Math.min(1, Number(r.progress) || 0)),
      error: r.error ? r.error.slice(0, 300) : null,
      result: state === "done" ? (r.result as LinkImportResult) : null,
      retrying,
    };
  });
}
