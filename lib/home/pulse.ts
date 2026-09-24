import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, chatMessages, jobs, users } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import { JOB_OWNER, jobName } from "@/lib/home/service";

/**
 * One line at a time on what the studio's employees are doing, for the top
 * bar of every page.
 *
 * "make sure it just look automated and interconnected everywhere." The home
 * screen showed the team at work; every other page showed a table. This is
 * the same fact, small enough to sit beside the breadcrumb: a render at 62%,
 * 研究员's brief from this morning, 编剧 answering in #制作 three minutes ago.
 * Read from what already exists — the queue and the agents' own messages —
 * never invented.
 */
export type PulseLine = {
  /** The employee it is about. */
  agent: AgentKey;
  text: string;
  /** Running now, as opposed to said a while ago. */
  live: boolean;
  href: string;
  at: string;
};

const RECENT_MINUTES = 6 * 60;

export async function studioPulse(viewer: Viewer, zh: boolean): Promise<PulseLine[]> {
  const lines: PulseLine[] = [];
  const name = (k: AgentKey) => (zh ? AGENT_LABELS[k].nameLocal : AGENT_LABELS[k].name);

  const running = await db
    .select({ type: jobs.type, status: jobs.status, progress: jobs.progress, createdAt: jobs.createdAt })
    .from(jobs)
    .where(and(eq(jobs.tenantId, viewer.tenantId), inArray(jobs.status, ["queued", "running"])))
    .orderBy(desc(jobs.createdAt))
    .limit(6);
  for (const j of running) {
    const owner = JOB_OWNER[j.type];
    if (!owner) continue;
    const pct = j.status === "running" && j.progress > 0 ? ` ${Math.round(j.progress * 100)}%` : "";
    lines.push({
      agent: owner,
      text: `${name(owner)} ${jobName(j.type, zh)}${pct}`,
      live: true,
      href: owner === "video" ? "/video" : "/home",
      at: j.createdAt.toISOString(),
    });
  }

  /* The last thing each employee said, in a channel this person can read. */
  const since = new Date(Date.now() - RECENT_MINUTES * 60_000);
  const rows = await db
    .select({
      body: chatMessages.body,
      createdAt: chatMessages.createdAt,
      email: users.email,
      slug: chatChannels.slug,
      channel: chatChannels.name,
      isPrivate: chatChannels.isPrivate,
    })
    .from(chatMessages)
    .innerJoin(users, eq(users.id, chatMessages.authorId))
    .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
    .where(
      and(
        eq(chatChannels.tenantId, viewer.tenantId),
        eq(users.isAgent, true),
        isNull(chatMessages.deletedAt),
        eq(chatChannels.isPrivate, false),
        sql`${chatMessages.createdAt} > ${since}`,
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(12);

  const seen = new Set<AgentKey>();
  for (const r of rows) {
    const key = (Object.keys(AGENT_LABELS) as AgentKey[]).find((k) => r.email === `${k}@agents.invalid`);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const first = firstLine(r.body);
    if (!first) continue;
    lines.push({
      agent: key,
      text: `${name(key)}：${first}`,
      live: false,
      href: r.slug ? `/chat/c/${encodeURIComponent(r.slug)}` : "/chat",
      at: r.createdAt.toISOString(),
    });
    if (lines.length >= 8) break;
  }

  return lines;
}

/**
 * This morning's conclusion from 研究员, for the Trends page to open on.
 *
 * The brief is a message in #研究日报; the Trends page is where the topic it
 * names would be watched, written and argued about. Reading the brief back
 * here is what makes the two the same product.
 */
export type DigestNote = { topic: string | null; why: string | null; date: string | null };

export async function latestDigest(tenantId: string): Promise<DigestNote | null> {
  const [row] = await db
    .select({ body: chatMessages.body, meta: chatMessages.meta })
    .from(chatMessages)
    .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
    .where(
      and(
        eq(chatChannels.tenantId, tenantId),
        isNull(chatMessages.deletedAt),
        sql`(${chatMessages.meta} -> 'digest' ->> 'date') is not null`,
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);
  if (!row) return null;

  const body = row.body ?? "";
  const topic = body.match(/\*\*今天讨论[：:]\s*(.+?)\*\*/)?.[1]?.trim() ?? null;
  const why = body.match(/为什么是现在[：:]\s*(.+)/)?.[1]?.trim().slice(0, 240) ?? null;
  const date = (row.meta as { digest?: { date?: unknown } } | null)?.digest?.date;
  return { topic, why, date: typeof date === "string" ? date : null };
}

function firstLine(body: string): string {
  for (const raw of body.split("\n")) {
    const line = raw.replace(/^[#>\-*\s]+/, "").replace(/\*\*/g, "").replace(/[_`]/g, "").trim();
    if (line) return line.length > 52 ? `${line.slice(0, 52)}…` : line;
  }
  return "";
}
