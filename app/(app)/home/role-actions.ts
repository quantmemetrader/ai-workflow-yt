"use server";

import { getViewer } from "@/lib/auth/dal";
import { AGENT_KEYS, type AgentKey } from "@/lib/agents/catalog";
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
  if (!viewer || !viewer.modules.includes("chat")) return { error: "Not allowed" };
  const next = role === null || role === "overview" ? null : (AGENT_KEYS as readonly string[]).includes(role) ? (role as AgentKey) : undefined;
  if (next === undefined) return { error: "No such job" };
  try {
    await setMyWorkRole(viewer, next);
    return { ok: true as const, workRole: next };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save that" };
  }
}
