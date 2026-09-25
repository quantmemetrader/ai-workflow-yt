import "server-only";
import { and, desc, eq, gte, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, chatMessages, creatorVideos, ideas, settings, topics } from "@/lib/db/schema";
import { ulid } from "@/lib/ids";
import type { Viewer } from "@/lib/auth/types";
import type { Idea, IdeaEvidence, IdeaStatus } from "@/lib/ideas/types";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { assertBudget, BudgetStop, recordUsage } from "@/lib/ai/ledger";
import { agentViewer } from "@/lib/agents";
import { creatorVoiceText } from "@/lib/creator/service";
import { guessBeat } from "@/lib/research/service";
import { PLATFORMS, type HotRow } from "@/lib/research/platform-catalog";
import { toSimplified } from "@/lib/text/simplified";
import { cleanCodes, numbersOf } from "@/lib/projects/topic";

/**
 * Video ideas worked out by 研究员 from the research the studio already has.
 *
 * The client's ask: Home should have an idea module "based on research", so
 * that nobody goes from a title straight to a script without the research in
 * between. So an idea here is never a blank-page brainstorm. It is built from
 * a pool of stored evidence, and every idea must name the rows that support
 * it; an idea whose evidence cannot be found in the pool is dropped rather
 * than shown with invented support.
 *
 * The pool is read from what is stored, with no live (billed) platform read:
 *
 *   — the latest hot list of each platform (`hot_snapshots`), only the rows
 *     marked business or tech when the list has been classified
 *     (`relevance`), every row when it has not;
 *   — this morning's signals from the brief, and today's own picks;
 *   — the creator's own subjects (the "Creator voice" note) and how the
 *     channel's recent uploads did (`creator_videos`);
 *   — the backlog topics the studio already keeps.
 *
 * One model call (研究员's, the assistant model, falling back like
 * `lib/research/summary.ts`), recorded in the ledger against 研究员's own
 * user row. The batch is stored (`ideas`), so Home is instant on the next
 * visit and an idea can become a project.
 */

/* ------------------------------------------------------------- reading */

type IdeaRow = typeof ideas.$inferSelect;

function toIdea(r: IdeaRow): Idea {
  return {
    id: r.id,
    batchId: r.batchId,
    seed: r.seed,
    title: r.title,
    titles: r.titles ?? [],
    angle: r.angle,
    why: r.why,
    hook: r.hook,
    format: r.format,
    strength: r.strength,
    evidence: (r.evidence as IdeaEvidence[]) ?? [],
    status: (["new", "saved", "started", "dismissed"].includes(r.status) ? r.status : "new") as IdeaStatus,
    projectId: r.projectId,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * The ideas Home shows: the latest batch 研究员 generated for this studio,
 * strongest first, without the dismissed ones.
 */
export async function latestIdeas(viewer: Viewer, limit = 6): Promise<Idea[]> {
  const [latest] = await db
    .select({ batchId: ideas.batchId })
    .from(ideas)
    .where(eq(ideas.tenantId, viewer.tenantId))
    .orderBy(desc(ideas.createdAt))
    .limit(1);
  if (!latest) return [];
  const rows = await db
    .select()
    .from(ideas)
    .where(and(eq(ideas.tenantId, viewer.tenantId), eq(ideas.batchId, latest.batchId), ne(ideas.status, "dismissed")))
    .orderBy(sql`${ideas.strength} desc nulls last`, ideas.createdAt)
    .limit(Math.max(1, Math.min(20, limit)));
  return rows.map(toIdea);
}

export async function ideaById(viewer: Viewer, id: string): Promise<Idea | null> {
  const [row] = await db.select().from(ideas).where(and(eq(ideas.id, id), eq(ideas.tenantId, viewer.tenantId))).limit(1);
  return row ? toIdea(row) : null;
}

/**
 * Keep an idea for later, or put it away.
 *
 * "saved" also puts it in the topic backlog (a `topics` row, status saved),
 * which is what "存进选题储备" says: it then shows on /research/backlog and in
 * the Script module's topics. The row is written directly rather than
 * through `createTopic`, which would also queue a chart refresh at once.
 */
export async function setIdeaStatus(viewer: Viewer, id: string, status: "saved" | "dismissed" | "new"): Promise<Idea | null> {
  const [row] = await db
    .update(ideas)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(ideas.id, id), eq(ideas.tenantId, viewer.tenantId), ne(ideas.status, "started")))
    .returning();
  if (!row) return ideaById(viewer, id);
  if (status === "saved") await backlogFromIdea(viewer, row).catch((err) => console.error("[ideas] could not add to the backlog", err));
  return toIdea(row);
}

async function backlogFromIdea(viewer: Viewer, idea: IdeaRow): Promise<string | null> {
  const query = idea.title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!query) return null;
  const angles = [idea.angle, ...(idea.titles ?? []).filter((t) => t !== idea.title)].filter((x): x is string => Boolean(x && x.trim())).slice(0, 5);
  const [made] = await db
    .insert(topics)
    .values({
      id: `top_${ulid()}`,
      tenantId: viewer.tenantId,
      query,
      name: idea.title.slice(0, 120),
      category: guessBeat(query),
      summary: idea.why,
      angles,
      status: "saved",
      stage: "adopted",
      ownerId: viewer.id,
    })
    .onConflictDoNothing({ target: [topics.tenantId, topics.query, topics.region] })
    .returning({ id: topics.id });
  if (made) return made.id;
  /* Already watched under that phrase: keep it, and make sure it is kept. */
  const [existing] = await db
    .update(topics)
    .set({ status: "saved", updatedAt: new Date() })
    .where(and(eq(topics.tenantId, viewer.tenantId), eq(topics.query, query), sql`${topics.status} in ('new', 'rejected')`))
    .returning({ id: topics.id });
  return existing?.id ?? null;
}

/* ------------------------------------------------------ evidence pool */

type PoolRow = IdeaEvidence & { id: string; note?: string };

const PLATFORM_NAME = Object.fromEntries(PLATFORMS.map((p) => [p.key, p.zh])) as Record<string, string>;

/** Rows per list; the video lists (with plays and likes) carry more. */
const TAKE: Record<string, number> = { dy_breakout: 8, dy_finance: 8, dy_tech: 8, dy_rising: 6, douyin: 6, weibo: 6, bilibili: 5, xiaohongshu: 4, google: 5, youtube: 4, tiktok: 3 };

const hkToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date());

/** The creator voice note's "Subjects" section: the channel's own pillars. */
function pillarsOf(voice: string): string {
  const m = voice.match(/##\s*Subjects\s*\n([\s\S]*?)(?:\n##\s|$)/i);
  return (m?.[1] ?? "").trim().slice(0, 500);
}

export async function evidencePool(viewer: Viewer): Promise<{ rows: PoolRow[]; text: string; counts: Record<string, number> }> {
  const rows: PoolRow[] = [];
  const counts: Record<string, number> = {};
  const lines: string[] = [];

  /* 1. The latest stored list of each platform, from the last day and a half. */
  const { rows: lists } = await db.execute<{ platform: string; rows: unknown; relevance: unknown; judged: unknown }>(sql`
    select distinct on (platform) platform, rows, relevance, judged
      from hot_snapshots
     where platform not like 'search:%'
       and fetched_at > now() - interval '36 hours'
     order by platform, fetched_at desc
  `);
  let n = 0;
  for (const list of lists) {
    const name = PLATFORM_NAME[list.platform];
    if (!name) continue;
    const all = (Array.isArray(list.rows) ? (list.rows as HotRow[]) : []).filter((r) => r && typeof r.phrase === "string" && r.phrase.trim());
    const rel = (list.relevance ?? null) as Record<string, { t?: string; s?: number }> | null;
    /* Classified lists: the business and tech rows, the most squarely on
       the beat first, platform order kept among equals. Unclassified (null):
       every row, as the platform ranked them. */
    const picked = rel
      ? all
          .map((r, i) => ({ r, i, m: rel[r.phrase] }))
          .filter((x) => x.m && (x.m.t === "biz" || x.m.t === "tech") && (x.m.s ?? 0) >= 1)
          .sort((a, b) => (b.m!.s ?? 0) - (a.m!.s ?? 0) || a.i - b.i)
          .map((x) => x.r)
      : all;
    const take = picked.slice(0, TAKE[list.platform] ?? 4);
    if (!take.length) continue;
    counts[list.platform] = take.length;
    lines.push(`\n### ${name}${rel ? "（已筛财经科技）" : ""}`);
    for (const r of take) {
      const id = `H${++n}`;
      const numbers = numbersOf(r.stats, r.heat, r.heatLabel);
      rows.push({ id, label: name, title: r.phrase.slice(0, 80), url: r.url ?? null, numbers, thumbnail: r.thumbnail ?? null, platform: list.platform });
      lines.push(`[${id}] ${r.phrase.slice(0, 70)}${r.extra ? ` ｜ ${r.extra.slice(0, 24)}` : ""} ｜ ${numbers || "—"}`);
    }
  }

  /* 2. This morning's signals: 研究员's own conclusion, with its evidence. */
  const [digest] = await db
    .select({ meta: chatMessages.meta })
    .from(chatMessages)
    .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
    .where(and(eq(chatChannels.tenantId, viewer.tenantId), sql`${chatMessages.deletedAt} is null`, sql`(${chatMessages.meta} -> 'digest' ->> 'date') is not null`))
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);
  const dg = (digest?.meta as { digest?: { date?: string; signals?: { title?: string; whyNow?: string; evidence?: { source?: string; phrase?: string; url?: string | null; thumbnail?: string | null; heat?: number | null; heatLabel?: string | null; stats?: Record<string, unknown> | null }[] }[] } } | null)?.digest;
  const signals = Array.isArray(dg?.signals) ? dg!.signals.filter((s) => typeof s?.title === "string") : [];
  if (signals.length) {
    lines.push(`\n### 今早晨报的信号（${dg?.date ?? ""}）`);
    signals.slice(0, 3).forEach((s, i) => {
      const id = `S${i + 1}`;
      const e = s.evidence?.[0];
      rows.push({ id, label: "晨报信号", title: String(s.title).slice(0, 80), url: e?.url ?? null, numbers: e ? numbersOf(e.stats as Parameters<typeof numbersOf>[0], e.heat ?? null, e.heatLabel ?? null) : "", thumbnail: e?.thumbnail ?? null, platform: null });
      lines.push(`[${id}] ${s.title} ｜ ${cleanCodes(s.whyNow).slice(0, 90)}`);
    });
    counts.signals = Math.min(3, signals.length);
  }

  /* 3. What people added to today's picks. */
  const [own] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, `research:own-picks:${viewer.tenantId}`)).limit(1);
  const today = hkToday();
  const picks = (Array.isArray(own?.value) ? (own!.value as { text?: string; by?: string; date?: string }[]) : []).filter((p) => p.text && p.date === today).slice(0, 5);
  if (picks.length) {
    lines.push("\n### 团队今天自己加的选题");
    picks.forEach((p, i) => {
      const id = `P${i + 1}`;
      rows.push({ id, label: `${p.by ?? "团队"}加的选题`, title: String(p.text).slice(0, 80), url: null, numbers: "", platform: null });
      lines.push(`[${id}] ${p.text}`);
    });
    counts.own = picks.length;
  }

  /* 4. The channel's own uploads: the best of the last quarter, and the latest. */
  const since = new Date(Date.now() - 120 * 86_400_000);
  const [best, recent] = await Promise.all([
    db
      .select({ id: creatorVideos.id, title: creatorVideos.title, views: creatorVideos.views, likes: creatorVideos.likes, externalId: creatorVideos.externalId, publishedAt: creatorVideos.publishedAt, thumbnailUrl: creatorVideos.thumbnailUrl })
      .from(creatorVideos)
      .where(and(eq(creatorVideos.tenantId, viewer.tenantId), gte(creatorVideos.publishedAt, since)))
      .orderBy(desc(creatorVideos.views))
      .limit(5),
    db
      .select({ id: creatorVideos.id, title: creatorVideos.title, views: creatorVideos.views, likes: creatorVideos.likes, externalId: creatorVideos.externalId, publishedAt: creatorVideos.publishedAt, thumbnailUrl: creatorVideos.thumbnailUrl })
      .from(creatorVideos)
      .where(eq(creatorVideos.tenantId, viewer.tenantId))
      .orderBy(sql`${creatorVideos.publishedAt} desc nulls last`)
      .limit(5),
  ]);
  const own5 = [...best, ...recent.filter((r) => !best.some((b) => b.id === r.id))];
  if (own5.length) {
    lines.push("\n### 本频道自己的视频（表现）");
    own5.forEach((v, i) => {
      const id = `C${i + 1}`;
      const likeRate = v.views > 0 ? v.likes / v.views : null;
      const numbers = numbersOf({ views: v.views, likes: v.likes, likeRate }, null, null, 2);
      rows.push({ id, label: "本频道", title: v.title.slice(0, 80), url: `https://www.youtube.com/watch?v=${v.externalId}`, numbers, thumbnail: v.thumbnailUrl ?? null, platform: "youtube" });
      lines.push(`[${id}] ${v.title.slice(0, 70)} ｜ ${numbers}${v.publishedAt ? ` ｜ ${v.publishedAt.toISOString().slice(0, 10)}` : ""}`);
    });
    counts.channel = own5.length;
  }

  /* 5. The backlog the studio keeps. */
  const backlog = await db
    .select({ id: topics.id, name: topics.name, summary: topics.summary })
    .from(topics)
    .where(and(eq(topics.tenantId, viewer.tenantId), sql`${topics.status} in ('adopted', 'saved')`))
    .orderBy(desc(topics.heat))
    .limit(6);
  if (backlog.length) {
    lines.push("\n### 选题储备里已经有的");
    backlog.forEach((t, i) => {
      const id = `B${i + 1}`;
      rows.push({ id, label: "选题储备", title: t.name.slice(0, 80), url: null, numbers: "", platform: null });
      lines.push(`[${id}] ${t.name}${t.summary ? ` ｜ ${t.summary.slice(0, 60)}` : ""}`);
    });
    counts.backlog = backlog.length;
  }

  return { rows, text: lines.join("\n").trim(), counts };
}

/* ------------------------------------------------------------ writing */

const REFUSAL = /无法回答|不能回答|无法提供|换个话题|I can.t|I cannot/;

type RawIdea = { title?: unknown; titles?: unknown; angle?: unknown; why?: unknown; hook?: unknown; format?: unknown; strength?: unknown; evidence?: unknown };

function parseIdeas(text: string): RawIdea[] {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  const candidates = [clean, start >= 0 && end > start ? clean.slice(start, end + 1) : ""];
  for (const c of candidates) {
    if (!c) continue;
    try {
      const j = JSON.parse(c) as { ideas?: unknown } | unknown[];
      const list = Array.isArray(j) ? j : Array.isArray((j as { ideas?: unknown }).ideas) ? ((j as { ideas: unknown[] }).ideas as unknown[]) : [];
      if (list.length) return list.filter((x): x is RawIdea => !!x && typeof x === "object");
    } catch {
      /* try the next shape */
    }
  }
  return [];
}

const s = (v: unknown, n: number) => (typeof v === "string" ? toSimplified(v.replace(/\s+/g, " ").trim()).slice(0, n) : "");

export type GenerateResult = { ok: true; ideas: Idea[]; model: string; batchId: string } | { ok: false; error: string };

/**
 * A new batch of ideas: the pool, one model call, the ideas that survive the
 * evidence check, stored. `store: false` does everything but the writes
 * (the batch, and the ledger row), for trying the prompt against real data.
 */
export async function generateIdeas(viewer: Viewer, opts: { seed?: string | null; n?: number; store?: boolean } = {}): Promise<GenerateResult> {
  const n = Math.max(1, Math.min(8, Math.round(opts.n ?? 5)));
  const seed = (opts.seed ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || null;
  const store = opts.store !== false;

  const researcher = await agentViewer(viewer.tenantId, "research");
  try {
    await assertBudget(researcher);
  } catch (err) {
    if (err instanceof BudgetStop) return { ok: false, error: "研究员本期的 AI 额度已经用完。" };
    throw err;
  }

  const [pool, voice] = await Promise.all([evidencePool(viewer), creatorVoiceText(viewer.tenantId).catch(() => "")]);
  if (pool.rows.length < 3) return { ok: false, error: "存下来的研究太少了（热榜和晨报都还没有数据），等下一轮采集后再试。" };
  const pillars = pillarsOf(voice);

  const prompt = [
    "你是一家香港财经科技自媒体工作室的研究员。主持人要拍短视频，请你根据下面这些已经存下来的研究证据，给出选题。",
    pillars ? `本频道已经验证过的题材：\n${pillars}` : "本频道的题材：香港机会、Web3 与 AI、投资与职涯、财经科技、人物对话。",
    seed ? `这次主持人想做的方向：「${seed}」。选题要贴着这个方向，但仍然只能用下面的证据。` : "",
    "",
    "证据（每条前面是编号；数字是平台自己的，不要改）：",
    pool.text,
    "",
    `给出 ${n} 个选题。规则：`,
    "1. 只做财经、商业、科技相关的题；娱乐、体育、节日、明星、段子一律不要。",
    "2. 每个选题引 1 到 3 条证据编号，每条都必须直接支持这个选题；无关的不要硬引，只有一条就只引一条。",
    "3. 不编数字、不编事实。why 里提到的数字必须是证据里有的。",
    "4. 不要和选题储备里已有的题重复；可以换角度。",
    "5. 标题像本频道的标题：具体、有冲突或数字，简体中文，20 字左右。",
    "",
    "只回答一个 JSON 对象，不要任何别的文字：",
    '{"ideas":[{"title":"主标题","titles":["备选标题1","备选标题2"],"angle":"切入角度，一句话","why":"为什么是现在，一两句，引用证据里的数字","hook":"视频第一句话","format":"竖版 60 秒 / 横版 8 分钟 之类","strength":1到5的整数,"evidence":["H3","S1"]}]}',
  ]
    .filter((line) => line !== "")
    .join("\n");

  let raw: RawIdea[] = [];
  let used: string | null = null;
  let lastError = "研究员这次没有给出能读的选题。";
  for (const model of [...new Set([modelFor.assistant(), modelFor.utility()])]) {
    try {
      const out = await complete({ model, messages: [{ role: "user", content: prompt }], temperature: 0.6, maxTokens: 3200 });
      if (store) {
        await recordUsage({
          viewer: researcher,
          module: "research",
          provider: out.provider ?? "openrouter",
          model: out.model,
          promptTokens: out.promptTokens,
          completionTokens: out.completionTokens,
          costMicros: out.costMicros,
          requestId: out.requestId,
        });
      }
      if (REFUSAL.test(out.text.slice(0, 80))) continue;
      raw = parseIdeas(out.text);
      if (raw.length) {
        used = out.model;
        break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[ideas] ${model}`, err);
    }
  }
  if (!raw.length || !used) return { ok: false, error: lastError };

  /* The evidence check: an idea keeps only the rows that are really in the
     pool, and an idea with none left is dropped. */
  const byId = new Map(pool.rows.map((r) => [r.id, r]));
  const batchId = `ib_${ulid()}`;
  const now = new Date();
  const kept = raw
    .map((r) => {
      const title = s(r.title, 80);
      const evidence = (Array.isArray(r.evidence) ? r.evidence : [])
        .map((e) => byId.get(String(e).trim().replace(/^\[|\]$/g, "")))
        .filter((e): e is PoolRow => Boolean(e))
        .slice(0, 3)
        .map(({ label, title: t, url, numbers, thumbnail, platform }) => ({ label, title: t, url, numbers, thumbnail: thumbnail ?? null, platform: platform ?? null }));
      const strength = Number(r.strength);
      return {
        id: `idea_${ulid()}`,
        tenantId: viewer.tenantId,
        batchId,
        createdBy: viewer.id,
        seed,
        title,
        titles: (Array.isArray(r.titles) ? r.titles : []).map((x) => s(x, 80)).filter((x) => x && x !== title).slice(0, 3),
        angle: s(r.angle, 200) || null,
        why: s(r.why, 300) || null,
        hook: s(r.hook, 120) || null,
        format: s(r.format, 40) || null,
        strength: Number.isFinite(strength) ? Math.max(1, Math.min(5, Math.round(strength))) : null,
        evidence,
        status: "new",
        createdAt: now,
        updatedAt: now,
      };
    })
    .filter((x) => x.title && x.evidence.length > 0)
    .slice(0, n);
  if (!kept.length) return { ok: false, error: "研究员给的选题都找不到对应的证据，这次没有存。再试一次，或者换个方向。" };

  if (store) await db.insert(ideas).values(kept);
  return { ok: true, model: used, batchId, ideas: kept.map((k) => toIdea({ ...k, projectId: null } as IdeaRow)) };
}
