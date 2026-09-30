"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { planToday } from "@/lib/agents/plan-today";
import { runPlan } from "@/lib/agents/plan-run";
import { hideHot, restoreHot } from "@/lib/research/hot-hidden";

async function researcher() {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("research")) return null;
  return viewer;
}

/** 「换一份」 on 策划今日提报: a fresh plan now, told to put forward a different topic. */
export async function refreshPlanAction(): Promise<{ error?: string; topic?: string | null }> {
  const viewer = await researcher();
  if (!viewer) return { error: "没有权限" };
  if (viewer.role === "guest") return { error: "访客不能重新提报" };
  const before = await planToday(viewer.tenantId).catch(() => null);
  try {
    const out = await runPlan({ tenant: viewer.tenantId, force: true, avoid: before?.topic ? [before.topic] : [], requestedBy: viewer.id });
    if (!out.posted) return { error: out.skipped === "budget" ? "策划这个月的 AI 预算用完了" : "这次没有提报出来，稍后再试" };
  } catch (err) {
    console.error("[plan] refresh failed", err);
    return { error: "这次没有提报出来，稍后再试" };
  }
  revalidatePath("/home");
  revalidatePath("/research");
  const after = await planToday(viewer.tenantId).catch(() => null);
  return { topic: after?.topic ?? null };
}

/** 「不再显示」 on a 热点榜 row, for the whole studio. */
export async function hideHotAction(phrase: unknown): Promise<{ error?: string }> {
  const viewer = await researcher();
  if (!viewer) return { error: "没有权限" };
  if (typeof phrase !== "string" || !phrase.trim() || phrase.length > 400) return { error: "Not allowed" };
  await hideHot(viewer.tenantId, viewer.id, phrase);
  revalidatePath("/research/hot");
  return {};
}

export async function restoreHotAction(): Promise<{ error?: string }> {
  const viewer = await researcher();
  if (!viewer) return { error: "没有权限" };
  await restoreHot(viewer.tenantId, viewer.id);
  revalidatePath("/research/hot");
  return {};
}
