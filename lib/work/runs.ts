import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentRuns } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

/**
 * An AI employee at work, for the task tracker: opened when a turn starts, its step moved on every tool
 * call, closed when the turn ends. Writes never hold up the turn.
 */
export async function openRun(input: { tenantId: string; agent: string; userId: string | null; title: string; href: string | null }): Promise<string> {
  const id = newId("run" as never);
  await db
    .insert(agentRuns)
    .values({ id, tenantId: input.tenantId, agent: input.agent, userId: input.userId, title: input.title.slice(0, 120), href: input.href, stage: "正在思考" })
    .catch(() => {});
  return id;
}

export function stepRun(id: string, stage: string): void {
  void db
    .update(agentRuns)
    .set({ stage: stage.slice(0, 80), steps: sql`${agentRuns.steps} + 1`, updatedAt: new Date() })
    .where(eq(agentRuns.id, id))
    .catch(() => {});
}

export function stageRun(id: string, stage: string): void {
  void db.update(agentRuns).set({ stage: stage.slice(0, 80), updatedAt: new Date() }).where(eq(agentRuns.id, id)).catch(() => {});
}

export async function closeRun(id: string, status: "done" | "failed" | "stopped"): Promise<void> {
  await db.update(agentRuns).set({ status, finishedAt: new Date(), updatedAt: new Date() }).where(eq(agentRuns.id, id)).catch(() => {});
}

/** How long this employee's turns usually take, from the last two weeks (ms); 25 s with no history. */
export async function typicalRunMs(tenantId: string, agent: string): Promise<number> {
  const rows = await db
    .select({ ms: sql<number>`percentile_cont(0.5) within group (order by extract(epoch from (${agentRuns.finishedAt} - ${agentRuns.startedAt})) * 1000)` })
    .from(agentRuns)
    .where(and(eq(agentRuns.tenantId, tenantId), eq(agentRuns.agent, agent), eq(agentRuns.status, "done"), gt(agentRuns.startedAt, new Date(Date.now() - 14 * 86_400_000))))
    .catch(() => [] as { ms: number }[]);
  const ms = Number(rows[0]?.ms);
  return Number.isFinite(ms) && ms > 2000 ? Math.round(ms) : 25_000;
}

/** Turns left "running" by a process that died (a deploy, a crash) are closed so the tracker does not show them for ever. */
export async function sweepRuns(tenantId: string): Promise<void> {
  await db
    .update(agentRuns)
    .set({ status: "stopped", finishedAt: new Date() })
    .where(and(eq(agentRuns.tenantId, tenantId), eq(agentRuns.status, "running"), sql`${agentRuns.updatedAt} < now() - interval '10 minutes'`))
    .catch(() => {});
}
