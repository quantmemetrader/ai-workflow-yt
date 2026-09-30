"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { saveDoc } from "@/lib/files/doc-edit";
import { createDocument } from "@/lib/files/service";
import { isLibModule, libraryFolder } from "@/lib/files/module-library";

/** Autosave from the document editor. */
export async function saveDocAction(fileId: unknown, html: unknown) {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };
  if (typeof fileId !== "string" || !/^fil_[0-9a-z]+$/i.test(fileId) || typeof html !== "string") return { error: "Not allowed" };
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
  const title = (typeof name === "string" && name.trim() ? name.trim() : `未命名文档 ${new Date().toISOString().slice(0, 10)}`).slice(0, 120);
  const row = await createDocument(viewer, { name: title, text: "", folderId });
  revalidatePath(`/${module}`);
  return { id: row.id };
}
