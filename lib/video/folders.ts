import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { projectsVisibleTo } from "@/lib/projects/visible";
import { listProjectFiles } from "@/lib/projects/files";

/**
 * 所有视频's folders: one per project this person may see, newest first,
 * each with its cut and the films it produced — the AI renders and the final
 * cuts the team uploaded back (`lib/projects/files.ts`). Derived live, so a
 * project made a moment ago is already a folder here (Ryan, 29 Sep).
 */
export type VideoFolderFile = { id: string; name: string; role: "render" | "final"; durationMs: number | null; sizeBytes: number; mime: string | null; createdAt: string };
export type VideoFolder = { id: string; title: string; updatedAt: string; videoProjectId: string | null; files: VideoFolderFile[] };

export async function videoFolders(viewer: Viewer): Promise<VideoFolder[]> {
  const rows = await db
    .select({ id: workProjects.id, title: workProjects.title, updatedAt: workProjects.updatedAt, videoProjectId: workProjects.videoProjectId })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), projectsVisibleTo(viewer)))
    .orderBy(desc(workProjects.updatedAt))
    .limit(200);
  const files = await Promise.all(rows.map((r) => listProjectFiles(viewer, r.id).catch(() => [])));
  return rows.map((r, i) => ({
    id: r.id,
    title: r.title,
    updatedAt: r.updatedAt.toISOString(),
    videoProjectId: r.videoProjectId,
    files: files[i]
      .filter((f): f is typeof f & { role: "render" | "final" } => f.role === "render" || f.role === "final")
      .filter((f) => (f.mime ?? "").startsWith("video/") || /\.(mp4|mov|m4v|webm)$/i.test(f.name))
      .map((f) => ({ id: f.id, name: f.name, role: (f.role === "final" ? "final" : "render") as VideoFolderFile["role"], durationMs: f.durationMs, sizeBytes: f.sizeBytes, mime: f.mime, createdAt: f.createdAt })),
  }));
}
