"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { saveDoc } from "@/lib/files/doc-edit";
import { createDocument, renameFile } from "@/lib/files/service";
import { isLibModule, libraryFolder } from "@/lib/files/module-library";

/** Autosave from the document editor. */
export async function saveDocAction(fileId: unknown, html: unknown) {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };
  if (typeof fileId !== "string" || !/^fil_[0-9a-z]+$/i.test(fileId) || typeof html !== "string") return { error: "没有权限" };
  if (html.length > 3_000_000) return { error: "文档太大了" };
  return saveDoc(viewer, fileId, html);
}

/** 「新建文档」 in a module's 资料库: a blank page in that library, opened in the editor. */
export async function newDocAction(module: unknown, name?: unknown) {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };
  if (!isLibModule(module) || !viewer.modules.includes(module)) return { error: "没有权限" };
  if (viewer.role === "guest") return { error: "访客不能新建文档" };
  const folderId = await libraryFolder(viewer, module);
  const title = (typeof name === "string" && name.trim() ? name.trim() : `未命名文档 ${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date())}`).slice(0, 120);
  const row = await createDocument(viewer, { name: title, text: "", folderId });
  revalidatePath(`/${module}`);
  return { id: row.id };
}

/** Rename from the editor's title. Editors only (checked in `renameFile`); an
 * uploaded file keeps its extension when the new name leaves it off, so
 * downloads still open in the right program (QA, 2 Oct). */
export async function renameDocAction(fileId: unknown, name: unknown) {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };
  if (typeof fileId !== "string" || !/^fil_[0-9a-z]+$/i.test(fileId) || typeof name !== "string") return { error: "没有权限" };
  const wanted = name.trim().slice(0, 200);
  if (!wanted) return { error: "请填写文档名称" };
  try {
    const [cur] = await db.select({ name: files.name }).from(files).where(eq(files.id, fileId)).limit(1);
    const ext = /\.[a-z0-9]{1,6}$/i.exec(cur?.name ?? "")?.[0];
    const next = ext && !wanted.toLowerCase().endsWith(ext.toLowerCase()) ? `${wanted}${ext}` : wanted;
    const row = await renameFile(viewer, fileId, next);
    revalidatePath(`/docs/${fileId}`);
    return { name: row.name };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没改成功，请再试一次" };
  }
}
