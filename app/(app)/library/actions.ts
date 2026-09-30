"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { addExample, deleteExample, mayTrain } from "@/lib/agents/training";
import { LIBRARIES, examplesFromFile, isLibModule, trainTag } from "@/lib/files/module-library";

/**
 * 「用来训练」 on a library file: its text (what AI read on upload) becomes a
 * training example for the module's AI employee; off takes it out again.
 */
export async function trainWithFileAction(module: unknown, fileId: unknown, on: boolean): Promise<{ error?: string }> {
  const viewer = await getViewer();
  if (!viewer || !isLibModule(module) || !viewer.modules.includes(module)) return { error: "Not allowed" };
  if (!mayTrain(viewer)) return { error: "只有管理员可以训练 AI 同事" };
  if (typeof fileId !== "string" || !/^fil_[0-9a-z]+$/i.test(fileId)) return { error: "Not allowed" };
  const key = LIBRARIES[module].train;
  try {
    if (on) {
      const [f] = await db.select({ name: files.name, text: files.text }).from(files).where(and(eq(files.id, fileId), eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt))).limit(1);
      if (!f) return { error: "找不到这个文件" };
      if (!f.text?.trim()) return { error: "AI 还在读这个文件，读完后再设为训练范例" };
      if ((await examplesFromFile(viewer.tenantId, key, fileId)).length) return {};
      await addExample(viewer, key, `文件《${f.name.slice(0, 80)}》${trainTag(fileId)}`, f.text.trim().slice(0, 6000));
    } else {
      for (const r of await examplesFromFile(viewer.tenantId, key, fileId)) await deleteExample(viewer, r.id);
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没改成" };
  }
  revalidatePath(`/${module}`);
  revalidatePath(`/train/${key}`);
  return {};
}
