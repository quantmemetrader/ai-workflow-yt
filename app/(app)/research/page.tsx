import { requireModule } from "@/lib/auth/dal";
import { chatChannels, chatMessages } from "@/lib/db/schema";
import type { PlanToday } from "@/components/research/PickBoard";
import { answeringModel } from "@/lib/ai/models";
import { latestDigest } from "@/lib/home/pulse";
import { latestIdeas } from "@/lib/ideas/service";
import { ownPicksToday } from "@/lib/research/own-picks";
import { proposalsFor } from "@/lib/agents/proposals";
import { evidenceNumbers, type Evidence } from "@/lib/research/signals";
import { ResearchShell } from "@/components/research/ResearchShell";
import { PickBoard, type PickCard } from "@/components/research/PickBoard";
import { db } from "@/lib/db/client";
import { topics } from "@/lib/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

export const metadata = { title: "选题 · Topics" };

const hkDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date());

/** Brief rows name their source as "抖音（财经榜）"; the card wants "抖音". */
const shortLabel = (s: string) => s.replace(/（.*?）|\(.*?\)/g, "").replace(/赛道(热门视频|热门|榜)?/g, "").replace(/\s+/g, " ").trim();
/** Close enough to be the same topic twice. */
const sameAs = (a: string) => a.replace(/[\s《》「」“”"'：:，,。.！!？?—\-·|]/g, "").slice(0, 14);

/**
 * 选题 · 推荐: the few topics worth making today, each one press from a
 * project (`PickBoard`). Read from what the researcher already wrote — the
 * morning brief's signals and 研究员's ideas (the same two Home shows) —
 * then what colleagues added today and the plan's to-dos. Storage only:
 * opening this page never asks a platform or a model anything.
 */
export default async function PicksPage() {
  const viewer = await requireModule("research");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const [digest, ideas, own, proposals, saved] = await Promise.all([
    latestDigest(viewer.tenantId).catch(() => null),
    latestIdeas(viewer, 8).catch(() => []),
    ownPicksToday(viewer.tenantId).catch(() => []),
    proposalsFor(viewer, "script").catch(() => ({ items: [] as { text: string; why: string | null }[] })),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(topics)
      .where(and(eq(topics.tenantId, viewer.tenantId), inArray(topics.status, ["adopted", "saved"])))
      .catch(() => [{ n: 0 }]),
  ]);

  const cards: PickCard[] = [];
  const seen = new Set<string>();
  const push = (c: PickCard) => {
    const k = sameAs(c.title);
    if (!k || seen.has(k)) return;
    seen.add(k);
    cards.push(c);
  };

  for (const [i, s] of (digest?.signals ?? []).slice(0, 2).entries()) {
    push({
      key: `signal:${digest?.date ?? ""}:${i}`,
      title: s.title,
      why: s.whyNow.replace(/（证据\d+）|\[[A-Z]\d{1,2}\]/g, "").trim() || null,
      proof: s.evidence.slice(0, 2).map((e) => ({ label: shortLabel(e.source), numbers: evidenceNumbers(e as unknown as Evidence).split(" · ").slice(0, 2).join(" · "), url: e.url ?? null })),
      tag: "brief",
      ref: { kind: "signal", title: s.title },
    });
  }
  if (!digest?.signals?.length && digest?.topic) push({ key: `brief:${digest.date ?? ""}`, title: digest.topic, why: digest.why, proof: [], tag: "brief", ref: { kind: "signal", title: digest.topic } });

  for (const idea of ideas) {
    if (idea.status === "dismissed") continue;
    push({
      key: `idea:${idea.id}`,
      title: idea.title,
      why: idea.why ?? idea.angle ?? null,
      proof: idea.evidence.slice(0, 2).map((e) => ({ label: shortLabel(e.label), numbers: e.numbers.split(" · ").slice(0, 2).join(" · "), url: e.url })),
      tag: "idea",
      ref: { kind: "idea", id: idea.id },
      ideaId: idea.id,
      projectId: idea.status === "started" ? idea.projectId : null,
    });
  }
  for (const o of own) push({ key: `own:${o.text}`, title: o.text, why: null, proof: [], tag: "mine", by: o.by, ref: { kind: "own", text: o.text } });
  if (cards.length < 3) {
    for (const p of proposals.items ?? []) push({ key: `plan:${p.text}`, title: p.text, why: p.why, proof: [], tag: "plan", ref: { kind: "own", text: p.text } });
  }

  /* 策划's report for the day, from the plan it posted (the newest one, if it is from the last two days). */
  const [planRow] = await db
    .select({ id: chatMessages.id, meta: chatMessages.meta, createdAt: chatMessages.createdAt, slug: chatChannels.slug })
    .from(chatMessages)
    .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
    .where(and(eq(chatChannels.tenantId, viewer.tenantId), sql`${chatMessages.deletedAt} is null`, sql`(${chatMessages.meta} -> 'plan' -> 'list') is not null`))
    .orderBy(desc(chatMessages.createdAt))
    .limit(1)
    .catch(() => []);
  let plan: PlanToday | null = null;
  if (planRow && Date.now() - planRow.createdAt.getTime() < 2 * 86_400_000) {
    const raw = (planRow.meta as { plan?: { date?: unknown; list?: unknown } } | null)?.plan;
    const list = (Array.isArray(raw?.list) ? raw!.list : []) as { owner?: unknown; text?: unknown; why?: unknown }[];
    const items = list
      .filter((x) => typeof x.text === "string" && x.text.trim())
      .map((x) => ({ owner: String(x.owner ?? ""), text: String(x.text).replace(/^\S{1,6}\s*[—-]\s*/, "").trim().slice(0, 260), why: typeof x.why === "string" && x.why.trim() ? x.why.trim().slice(0, 200) : null }));
    const topic = list.map((x) => (typeof x.text === "string" ? /《([^》]{4,80})》/.exec(x.text)?.[1] : null)).find(Boolean) ?? null;
    if (items.length) plan = { date: typeof raw?.date === "string" ? raw.date : planRow.createdAt.toISOString().slice(0, 10), topic, items, href: `/chat/c/${planRow.slug}` };
  }

  return (
    <ResearchShell zh={zh} savedCount={saved[0]?.n ?? 0}>
      <PickBoard picks={cards.slice(0, 8)} zh={zh} day={hkDate()} model={answeringModel()} canWrite={viewer.modules.includes("script")} plan={plan} />
    </ResearchShell>
  );
}
