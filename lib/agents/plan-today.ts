import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, chatMessages } from "@/lib/db/schema";
import type { PlanToday } from "@/components/agents/PlanTodayCard";

/**
 * 策划's report for the day: the plan it posts at 08:05 HKT in #研究日报, the
 * topic it puts forward (the 《…》 in a to-do) and each colleague's part.
 * The newest plan, if it is from the last two days. Storage only.
 */
export async function planToday(tenantId: string): Promise<PlanToday | null> {
  const [row] = await db
    .select({ meta: chatMessages.meta, createdAt: chatMessages.createdAt, slug: chatChannels.slug })
    .from(chatMessages)
    .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
    .where(and(eq(chatChannels.tenantId, tenantId), sql`${chatMessages.deletedAt} is null`, sql`(${chatMessages.meta} -> 'plan' -> 'list') is not null`))
    .orderBy(desc(chatMessages.createdAt))
    .limit(1)
    .catch(() => []);
  if (!row || Date.now() - row.createdAt.getTime() > 2 * 86_400_000) return null;
  const raw = (row.meta as { plan?: { date?: unknown; list?: unknown } } | null)?.plan;
  const list = (Array.isArray(raw?.list) ? raw!.list : []) as { owner?: unknown; text?: unknown; why?: unknown }[];
  const items = list
    .filter((x) => typeof x.text === "string" && x.text.trim())
    .map((x) => ({
      owner: String(x.owner ?? ""),
      text: String(x.text).replace(/^\S{1,6}\s*[—-]\s*/, "").trim().slice(0, 260),
      why: typeof x.why === "string" && x.why.trim() ? x.why.trim().slice(0, 200) : null,
    }));
  if (!items.length) return null;
  const topic = list.map((x) => (typeof x.text === "string" ? /《([^》]{4,80})》/.exec(x.text)?.[1] : null)).find(Boolean) ?? null;
  return { date: typeof raw?.date === "string" ? raw.date : row.createdAt.toISOString().slice(0, 10), topic, items, href: `/chat/c/${row.slug}` };
}
