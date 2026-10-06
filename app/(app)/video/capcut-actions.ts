"use server";

import { getViewer } from "@/lib/auth/dal";
import { capcutState, requestCapcutExport } from "@/lib/video/capcut/service";

/**
 * 导出到剪映: asking for a draft and following it. In a file of its own so the
 * editor's main actions file is not where this feature's edits land.
 */

async function viewer() {
  const v = await getViewer();
  if (!v || !v.modules.includes("video")) return null;
  return v;
}

const id = (v: unknown) => (typeof v === "string" && v && v.length <= 64 ? v : null);

export async function capcutExportAction(projectId: string, input: { app: string; aspect: string; captionLanguage: string }) {
  const v = await viewer();
  if (!v) return { error: "没有权限。" };
  if (!id(projectId)) return { error: "找不到这个剪辑了。" };
  const zh = (v.locale ?? "zh-CN").startsWith("zh");
  try {
    const jobId = await requestCapcutExport(v, projectId, input ?? {});
    return { jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "Not found") return { error: zh ? "找不到这个剪辑了。" : "That cut no longer exists." };
    return { error: zh ? "没能开始导出，请稍后再试。" : msg || "Could not start the export." };
  }
}

export async function capcutStateAction(projectId: string) {
  const v = await viewer();
  if (!v || !id(projectId)) return { error: "Not found" as const };
  const state = await capcutState(v, projectId);
  if (!state) return { error: "Not found" as const };
  return state;
}
