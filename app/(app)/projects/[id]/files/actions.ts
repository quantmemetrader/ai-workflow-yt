"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, scripts } from "@/lib/db/schema";
import { getViewer, type Viewer } from "@/lib/auth/dal";
import { canReadFiles } from "@/lib/authz/rebac";
import { visibleProject } from "@/lib/projects/service";
import { isProjectFileRole, tagProjectFile, untagProjectFile, type ProjectFileRole } from "@/lib/projects/files";
import { renameFile, softDelete } from "@/lib/files/service";
import { addClipAction } from "@/app/(app)/video/actions";
import { clipLandedAction } from "@/app/(app)/projects/actions";

/**
 * The project files page's presses. Each re-reads the viewer and re-checks
 * the project is theirs to see (server actions are public endpoints); the
 * file itself is checked by the service each one calls — renaming or
 * deleting still needs edit access to that file.
 */

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;

async function projectOf(projectId: unknown): Promise<{ viewer: Viewer; project: NonNullable<Awaited<ReturnType<typeof visibleProject>>> } | { error: string }> {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "没有权限" };
  if (!isId(projectId)) return { error: "找不到了，可能已被删除" };
  const project = await visibleProject(viewer, projectId);
  if (!project) return { error: "找不到了，可能已被删除" };
  return { viewer, project };
}

const zhOf = (v: Viewer) => (v.locale ?? "zh-CN").startsWith("zh");

function refresh(projectId: string) {
  revalidatePath(`/projects/${projectId}`, "layout");
}

/** Put a reference in the script's sources (so 文案 reads it), or take it out. */
async function setScriptSource(viewer: Viewer, scriptId: string | null, fileId: string, on: boolean) {
  if (!scriptId) return;
  await db
    .update(scripts)
    .set({
      sourceFileIds: on
        ? sql`case when ${fileId} = any(${scripts.sourceFileIds}) then ${scripts.sourceFileIds} else array_append(${scripts.sourceFileIds}, ${fileId}) end`
        : sql`array_remove(${scripts.sourceFileIds}, ${fileId})`,
    })
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId)));
}

/**
 * A file just uploaded from the page: into the project's box, and on to
 * where it is used — a video in 素材 into the cut's bin (the editor sees it,
 * and 传完自动开始剪 counts it), a reference into the script's sources.
 */
export async function landProjectFileAction(projectId: unknown, fileId: unknown, role: unknown) {
  const ok = await projectOf(projectId);
  if ("error" in ok) return ok;
  const { viewer, project } = ok;
  const zh = zhOf(viewer);
  if (!isId(fileId) || !isProjectFileRole(role)) return { error: "找不到了，可能已被删除" };
  if (!(await tagProjectFile(viewer, project.id, fileId, role))) return { error: zh ? "找不到这个文件" : "That file was not found" };
  let note: string | null = null;
  if (role === "clip" && project.videoProjectId) {
    const [f] = await db.select({ mime: files.mime, kind: files.kind }).from(files).where(eq(files.id, fileId)).limit(1);
    if (f && (f.mime?.startsWith("video/") || f.kind === "video")) {
      const r = await addClipAction(project.videoProjectId, fileId);
      if ("error" in r && r.error) note = r.error;
      else await clipLandedAction(project.id).catch(() => null);
    }
  }
  if (role === "reference") await setScriptSource(viewer, project.scriptId, fileId, true);
  refresh(project.id);
  return note ? { note } : {};
}

/** 移到…: one box to another, for one file or a selection. */
export async function moveProjectFilesAction(projectId: unknown, fileIds: unknown, role: unknown) {
  const ok = await projectOf(projectId);
  if ("error" in ok) return ok;
  const { viewer, project } = ok;
  if (!Array.isArray(fileIds) || !fileIds.every(isId) || fileIds.length > 200 || !isProjectFileRole(role)) return { error: "找不到了，可能已被删除" };
  let moved = 0;
  for (const id of fileIds as string[]) {
    if (!(await tagProjectFile(viewer, project.id, id, role as ProjectFileRole))) continue;
    await setScriptSource(viewer, project.scriptId, id, role === "reference");
    moved += 1;
  }
  refresh(project.id);
  return { moved };
}

/** 移出项目: the project's tag comes off; the file stays in Files. */
export async function unlinkProjectFileAction(projectId: unknown, fileId: unknown) {
  const ok = await projectOf(projectId);
  if ("error" in ok) return ok;
  const { viewer, project } = ok;
  if (!isId(fileId)) return { error: "找不到了，可能已被删除" };
  await untagProjectFile(viewer, project.id, fileId);
  await setScriptSource(viewer, project.scriptId, fileId, false);
  refresh(project.id);
  return {};
}

export async function renameProjectFileAction(projectId: unknown, fileId: unknown, name: unknown) {
  const ok = await projectOf(projectId);
  if ("error" in ok) return ok;
  const { viewer, project } = ok;
  const zh = zhOf(viewer);
  if (!isId(fileId) || typeof name !== "string") return { error: "找不到了，可能已被删除" };
  try {
    const row = await renameFile(viewer, fileId, name.slice(0, 255));
    refresh(project.id);
    return { name: row.name };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    return { error: zh && /edit access/.test(msg) ? "你没有这个文件的编辑权限，请上传者改名" : msg || (zh ? "改名失败" : "Could not rename that") };
  }
}

/** 删除: to the trash (30 days), one file or a selection. */
export async function deleteProjectFilesAction(projectId: unknown, fileIds: unknown) {
  const ok = await projectOf(projectId);
  if ("error" in ok) return ok;
  const { viewer, project } = ok;
  const zh = zhOf(viewer);
  if (!Array.isArray(fileIds) || !fileIds.every(isId) || fileIds.length > 200) return { error: "找不到了，可能已被删除" };
  let deleted = 0;
  let refused = 0;
  for (const id of fileIds as string[]) {
    try {
      await softDelete(viewer, id);
      await setScriptSource(viewer, project.scriptId, id, false);
      deleted += 1;
    } catch {
      refused += 1;
    }
  }
  refresh(project.id);
  if (refused && !deleted) return { error: zh ? "你没有这些文件的编辑权限，请上传者删除" : "You need edit access to delete these" };
  return { deleted, refused };
}

/**
 * The words of a document for the preview window — what the store pulled
 * out of it on upload — for the kinds a browser cannot draw (Word, slides).
 */
export async function previewTextAction(projectId: unknown, fileId: unknown) {
  const ok = await projectOf(projectId);
  if ("error" in ok) return ok;
  const { viewer } = ok;
  if (!isId(fileId)) return { error: "找不到了，可能已被删除" };
  const [row] = await db
    .select({ text: files.text })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt), canReadFiles(viewer)))
    .limit(1);
  if (!row) return { error: "找不到了，可能已被删除" };
  return { text: (row.text ?? "").slice(0, 40000) };
}
