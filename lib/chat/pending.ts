import "server-only";
import { and, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatMessages } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import type { Viewer } from "@/lib/auth/types";
import { AGENT_KEYS, type AgentKey } from "@/lib/agents/catalog";
import { isStepKey, type StepKey } from "@/lib/agents/steps";

/**
 * An employee at work, as a row in the channel.
 *
 * From the moment an employee is dispatched until its reply is posted, the
 * channel holds one placeholder row for it — `meta.pending = { agent, step,
 * since }` — and the turn moves its step along as it reads, writes, cuts
 * (`lib/agents/steps.ts`). It lives in the database, not in one process's
 * memory, so any of the four app instances can answer the channel's poll,
 * and the chat already polls every few seconds.
 *
 * Three rules keep a placeholder from ever passing for a message:
 *
 *   1. **Written already deleted.** Its `deleted_at` is set when it is born.
 *      Every reader of messages — the channel, `read_channel` and
 *      `search_messages` for the employees, unread counts, "who is this
 *      reply to", Home — already passes over deleted rows, so none of them
 *      can see it, including any written after this one. Only the readers
 *      here look for it.
 *   2. **Removed when the turn ends**, whatever way it ends (`endPending`
 *      in the dispatcher's `finally`). The reply itself is posted as a new
 *      message, so it lands in its right place and order.
 *   3. **Stale after ten minutes without a step.** A process that died
 *      mid-turn leaves its row behind; nothing reads one whose last
 *      heartbeat (`edited_at`) is older than that, and the next turn in the
 *      same channel sweeps them away.
 */
const STALE_MS = 10 * 60_000;

export type PendingRow = {
  id: string;
  channelId: string;
  agent: AgentKey;
  step: StepKey;
  /** When the turn started (ISO). */
  since: string;
  /** A render or a director run this turn started, for the live job chip. */
  job?: { videoProjectId: string } | null;
};

/** Puts the row up as the turn starts, and clears the dead ones first. */
export async function startPending(agent: Viewer, channelId: string, key: AgentKey, step: StepKey = "thinking"): Promise<string | null> {
  try {
    await db.execute(sql`
      delete from ${chatMessages}
       where channel_id = ${channelId}
         and deleted_at is not null
         and meta ? 'pending'
         and coalesce(edited_at, created_at) < now() - (${STALE_MS} * interval '1 millisecond')
    `);
    const id = newId("msg");
    const now = new Date();
    await db.insert(chatMessages).values({
      id,
      channelId,
      authorId: agent.id,
      body: "",
      meta: { pending: { agent: key, step, since: now.toISOString() } },
      editedAt: now,
      deletedAt: now,
    });
    return id;
  } catch (err) {
    // Showing the work is not the work: a turn goes ahead without its row.
    console.error("[pending] could not put the working row up", err);
    return null;
  }
}

/** Moves the row to its next step; also its heartbeat. */
export async function stepPending(id: string, step: StepKey, job?: { videoProjectId: string }): Promise<void> {
  const patch = JSON.stringify(job ? { step, job } : { step });
  await db.execute(sql`
    update ${chatMessages}
       set meta = jsonb_set(meta, '{pending}', coalesce(meta -> 'pending', '{}'::jsonb) || ${patch}::jsonb),
           edited_at = now()
     where id = ${id}
       and deleted_at is not null
       and meta ? 'pending'
  `);
}

/** Takes the row down. Only ever a placeholder: a real message is never touched. */
export async function endPending(id: string | null): Promise<void> {
  if (!id) return;
  try {
    await db.execute(sql`delete from ${chatMessages} where id = ${id} and deleted_at is not null and meta ? 'pending'`);
  } catch (err) {
    console.error("[pending] could not take the working row down", err);
  }
}

/** The live rows in some channels, oldest first. Readers check the channels. */
export async function pendingIn(channelIds: string[]): Promise<PendingRow[]> {
  const ids = [...new Set(channelIds)].slice(0, 200);
  if (!ids.length) return [];
  const rows = await db
    .select({ id: chatMessages.id, channelId: chatMessages.channelId, meta: chatMessages.meta, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .where(
      and(
        inArray(chatMessages.channelId, ids),
        /* Bounded by when the turn began, so the (channel, created_at) index
           answers it however long the channel is: no turn runs for an hour. */
        sql`${chatMessages.createdAt} > now() - interval '1 hour'`,
        sql`${chatMessages.deletedAt} is not null`,
        sql`${chatMessages.meta} ? 'pending'`,
        sql`coalesce(${chatMessages.editedAt}, ${chatMessages.createdAt}) > now() - (${STALE_MS} * interval '1 millisecond')`,
      ),
    )
    .orderBy(chatMessages.createdAt);
  return rows.flatMap((r) => {
    const p = readPending(r.meta);
    return p ? [{ id: r.id, channelId: r.channelId, ...p, since: p.since ?? r.createdAt.toISOString() }] : [];
  });
}

/** One channel's live rows. */
export async function pendingInChannel(channelId: string): Promise<PendingRow[]> {
  return pendingIn([channelId]);
}

/** A placeholder's `meta.pending`, read defensively: the column is jsonb. */
function readPending(meta: unknown): Omit<PendingRow, "id" | "channelId" | "since"> & { since?: string } | null {
  const p = (meta as { pending?: unknown } | null)?.pending;
  if (!p || typeof p !== "object") return null;
  const r = p as Record<string, unknown>;
  const agent = typeof r.agent === "string" && (AGENT_KEYS as readonly string[]).includes(r.agent) ? (r.agent as AgentKey) : null;
  if (!agent) return null;
  const job = r.job && typeof r.job === "object" && typeof (r.job as { videoProjectId?: unknown }).videoProjectId === "string" ? { videoProjectId: (r.job as { videoProjectId: string }).videoProjectId } : null;
  return {
    agent,
    step: isStepKey(r.step) ? r.step : "working",
    ...(typeof r.since === "string" ? { since: r.since } : {}),
    job,
  };
}
