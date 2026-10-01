"use server";

import { getViewer } from "@/lib/auth/dal";
import { isProductionKey } from "@/lib/agents/catalog";
import { setMyWorkRole } from "@/lib/home/service";

/**
 * "设为我的默认" on Home's role tabs: the Home this person lands on.
 *
 * Its own file rather than `actions.ts` beside it, which carries the
 * proposal and hand-off actions. No revalidation: the screen refreshes
 * itself when this returns, and a broad `revalidatePath` re-rendered the
 * whole shell, which read as the site reloading.
 *
 * `null` (or "overview") clears it — the studio's default applies again,
 * which is the overview for owners and admins.
 */
export async function setMyWorkRoleAction(role: string | null) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return { error: "没有权限" };
  const next = role === null || role === "overview" ? null : isProductionKey(role) ? role : undefined;
  if (next === undefined) return { error: "没有这个岗位" };
  try {
    await setMyWorkRole(viewer, next);
    return { ok: true as const, workRole: next };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没有保存成功，再试一次" };
  }
}
