"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { files, videoClips, videoProjects, workProjects } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { projectForPage } from "@/lib/projects/page-data";
import { isHostFootage, syncScriptFromFootage } from "@/lib/script/from-footage";
import { queueClipScript } from "@/lib/video/clip-script";
import { requestDirector } from "@/lib/video/service";

async function ctx(projectId: unknown) {
  const viewer = await getViewer();
  if (!viewer || typeof projectId !== "string" || !/^wp_[0-9a-z]+$/.test(projectId)) return null;
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const p = await projectForPage(viewer, projectId, zh);
  if (!p || p.linkOnly === "view" || p.status === "archived") return null;
  const [w] = await db.select({ videoProjectId: workProjects.videoProjectId }).from(workProjects).where(eq(workProjects.id, projectId)).limit(1);
  return w?.videoProjectId ? { viewer, zh, videoProjectId: w.videoProjectId } : null;
}

/** 按脚本重新剪: the director cuts the footage to exactly what is in the script now (lib/video/director.ts). */
export async function recutFromScriptAction(projectId: unknown): Promise<{ ok: true } | { error: string }> {
  const c = await ctx(projectId);
  if (!c) return { error: "Not allowed" };
  if (!c.viewer.modules.includes("video")) return { error: c.zh ? "你没有剪辑的权限" : "You cannot edit videos" };
  const [v] = await db.select({ director: videoProjects.director }).from(videoProjects).where(eq(videoProjects.id, c.videoProjectId)).limit(1);
  const d = (v?.director ?? {}) as { brief?: string; aspect?: string; language?: string; pace?: string; state?: string };
  if (d.state === "queued" || d.state === "running") return { error: c.zh ? "剪辑师正在剪这条，等这一版剪完再来" : "The editor is already cutting this one" };
  try {
    await requestDirector(c.viewer, c.videoProjectId, {
      brief: d.brief?.trim() || (c.zh ? "按脚本剪：脚本里的话全部保留，删掉的剪掉，去掉停顿。" : "Cut to the script: keep every line in it, drop what was deleted, remove the pauses."),
      aspect: d.aspect ?? "9:16",
      render: true,
      language: d.language ?? null,
      pace: d.pace ?? null,
      narrate: "off",
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath(`/projects/${projectId}`, "layout");
  return { ok: true };
}

/** 把视频里说的话写进脚本: for footage that came in before this existed, or a clip whose transcription was skipped. */
export async function scriptFromFootageAction(projectId: unknown): Promise<{ ok: true; queued: number; changed: boolean } | { error: string }> {
  const c = await ctx(projectId);
  if (!c) return { error: "Not allowed" };
  const rows = await db
    .select({ id: videoClips.id, fileId: videoClips.fileId, durationMs: videoClips.durationMs, transcript: videoClips.transcript, name: files.name })
    .from(videoClips)
    .innerJoin(files, eq(files.id, videoClips.fileId))
    .where(and(eq(videoClips.projectId, c.videoProjectId), isNull(files.deletedAt)));
  const waiting = rows.filter((r) => !(r.transcript && r.transcript.fileId === r.fileId) && isHostFootage(r.name, r.durationMs, [{ text: "x".repeat(20), startMs: 0, endMs: 1 }]));
  for (const r of waiting) await queueClipScript(c.viewer, r.id);
  const s = waiting.length ? { changed: false } : await syncScriptFromFootage(c.viewer, projectId as string);
  revalidatePath(`/projects/${projectId}/script`);
  return { ok: true, queued: waiting.length, changed: s.changed };
}

