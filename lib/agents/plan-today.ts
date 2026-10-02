import "server-only";
import { readerLine } from "@/lib/text/reader";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, chatMessages } from "@/lib/db/schema";
import type { PlanToday } from "@/components/agents/PlanTodayCard";

/* An internal id as the planner writes it: a known prefix and a run of id
   characters, any case, maybe cut short with an ellipsis. */
const PLAN_ID = String.raw`\b(?:scr|wp|fil|prj|rnd|cnv|msg|top|job|vp|req|idea|use|am|tc|ch|chn|cmt|sug|sv|apr|inv|usr|tup|ver|brf)_(?:[0-9A-Za-z]{6,}(?:…|\.\.\.)?|[0-9A-Za-z]*(?:…|\.\.\.))`;

/**
 * The planner's ids out of a line a person reads (QA, 2 Oct: 「该脚本已在起草中
 * （scr_01m3…）」 and 「（如scr_01m3…等）」 on 策划今日提报). The brackets go
 * with the id, and 「如…等」 with them, so no 「（如等）」 is left behind.
 * Also run on what the planner writes before it is stored (`plan-run.ts`).
 */
export function scrubPlanIds(text: string): string {
  return text
    .replace(new RegExp(String.raw`\s*[（(]\s*(?:如|例如|比如)?\s*(?:id|ID|编号)?[:：]?\s*\`?${PLAN_ID}\`?(?:\s*[、,，]\s*\`?${PLAN_ID}\`?)*\s*(?:等)?\s*[）)]`, "g"), "")
    .replace(new RegExp(String.raw`(?:如|例如|比如)?\s*\`?${PLAN_ID}\`?\s*(?:等)?`, "g"), "")
    .replace(/[（(]\s*[）)]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

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
  const raw = (row.meta as { plan?: { date?: unknown; list?: unknown; prepared?: { scriptId?: unknown; beats?: unknown; takenBy?: unknown } } } | null)?.plan;
  const list = (Array.isArray(raw?.list) ? raw!.list : []) as { owner?: unknown; text?: unknown; why?: unknown }[];
  const items = list
    .filter((x) => typeof x.text === "string" && x.text.trim())
    .map((x) => ({
      owner: String(x.owner ?? ""),
      text: readerLine(scrubPlanIds(String(x.text).replace(/^\S{1,6}\s*[—-]\s*/, "")), 260),
      why: typeof x.why === "string" && scrubPlanIds(x.why) ? readerLine(scrubPlanIds(x.why), 200) : null,
    }));
  if (!items.length) return null;
  const topic = list.map((x) => (typeof x.text === "string" ? /《([^》]{4,80})》/.exec(x.text)?.[1] : null)).find(Boolean) ?? null;
  /* 编剧 wrote the topic's first draft as soon as the plan was out (lib/agents/autorun.ts); it is still waiting to be taken. */
  const prepared = typeof raw?.prepared?.scriptId === "string" && !raw.prepared.takenBy ? { beats: typeof raw.prepared.beats === "number" ? raw.prepared.beats : 0 } : null;
  return { date: typeof raw?.date === "string" ? raw.date : row.createdAt.toISOString().slice(0, 10), topic, items, href: `/chat/c/${row.slug}`, prepared };
}
