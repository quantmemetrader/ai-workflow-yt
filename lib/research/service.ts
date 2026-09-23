import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  comparisons,
  researchSources,
  seriesCache,
  topicEvents,
  topics,
  users,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { enqueue } from "@/lib/jobs/queue";
import { createDocument } from "@/lib/files/service";
import type { Point } from "./fetchers";

export type Window = "1m" | "3m" | "6m";
export const WINDOW_DAYS: Record<Window, number> = { "1m": 30, "3m": 90, "6m": 180 };

/**
 * Market Research, read from the database.
 *
 * Nothing here calls the outside world: the refresh job does that and writes to
 * `series_cache`. A screen that fetched on render would be a screen that dies
 * the moment GDELT rate-limits us, and the brief is clear that Research
 * "loads without a chat prompt".
 */

export type RankedTopic = {
  id: string;
  name: string;
  nameLocal: string | null;
  query: string;
  category: string | null;
  summary: string | null;
  angles: string[];
  flagged: boolean;
  flagReason: string | null;
  heat: number;
  change14d: number;
  rising: boolean;
  status: "new" | "adopted" | "rejected" | "saved";
  sourceKeys: string[];
  points: Point[];
  /** The stories behind the number. The dashboard renders these and the query
   * never returned them, so the panel was always empty. */
  articles: { title: string; url: string; domain: string; at: string }[];
  freshness: Date | null;
  /**
   * Nothing has been collected for this phrase yet.
   *
   * Watching a phrase queues a fetch across sources that answer in their own
   * time — a first collection takes about a minute — and until now the topic
   * simply appeared with a heat of zero and no explanation, which reads as a
   * button that did not work.
   */
  collecting: boolean;
  /** What the sources said, if anything went wrong. */
  error: string | null;
  ownerName: string | null;
  targetChannel: string | null;
  dueDate: string | null;
};

/**
 * Ranked topics for the dashboard.
 *
 * Ranking is heat, adjusted by what this person has adopted and rejected
 * before — the brief says a user should understand their choices are training
 * something, so the weights are theirs, visible, and derived from events they
 * can see the count of.
 */
export async function rankedTopics(
  viewer: Viewer,
  opts: { categories?: string[]; statuses?: RankedTopic["status"][]; limit?: number } = {},
): Promise<RankedTopic[]> {
  const conds = [eq(topics.tenantId, viewer.tenantId)];
  if (opts.categories?.length) conds.push(inArray(topics.category, opts.categories));
  if (opts.statuses?.length) conds.push(inArray(topics.status, opts.statuses));

  const [rows, weights] = await Promise.all([
    db
      .select({ topic: topics, ownerName: users.name })
      .from(topics)
      .leftJoin(users, eq(users.id, topics.ownerId))
      .where(and(...conds))
      .orderBy(desc(topics.heat))
      .limit(opts.limit ?? 40),
    categoryWeights(viewer),
  ]);

  const keys = rows.map((r) => `${r.topic.query}`);
  const series = keys.length
    ? await db
        .select()
        .from(seriesCache)
        .where(and(eq(seriesCache.window, "3m"), inArray(seriesCache.query, keys)))
    : [];
  const byQuery = new Map(series.map((s) => [s.query, s]));

  return rows
    .map((r) => {
      const cached = byQuery.get(r.topic.query);
      const weight = 1 + (weights.get(r.topic.category ?? "") ?? 0) * 0.15;
      return {
        id: r.topic.id,
        name: r.topic.name,
        nameLocal: r.topic.nameLocal,
        query: r.topic.query,
        category: r.topic.category,
        summary: r.topic.summary,
        angles: r.topic.angles,
        flagged: r.topic.flagged,
        flagReason: r.topic.flagReason,
        heat: r.topic.heat * weight,
        change14d: r.topic.change14d,
        rising: r.topic.rising,
        status: r.topic.status,
        sourceKeys: r.topic.sourceKeys,
        points: cached?.points ?? [],
        articles: cached?.articles ?? [],
        freshness: cached?.fetchedAt ?? r.topic.lastFetchedAt,
        // Never fetched. A phrase the sources came back empty for has been
        // fetched, and saying "collecting…" over it was a spinner that never
        // stopped (and a page that refreshed every six seconds for ever).
        collecting: r.topic.lastFetchedAt === null,
        error: cached?.error ?? null,
        ownerName: r.ownerName,
        targetChannel: r.topic.targetChannel,
        dueDate: r.topic.dueDate,
      };
    })
    .sort((a, b) => b.heat - a.heat);
}

/** Adopt/reject counts per category for this person, which is the whole of the
 * "ranking weights" the dashboard footer talks about. */
export async function categoryWeights(viewer: Viewer): Promise<Map<string, number>> {
  const rows = await db
    .select({
      category: topicEvents.category,
      score: sql<number>`sum(case when ${topicEvents.action} = 'adopt' then 1 when ${topicEvents.action} = 'reject' then -1 else 0 end)::int`,
    })
    .from(topicEvents)
    .where(eq(topicEvents.userId, viewer.id))
    .groupBy(topicEvents.category);

  return new Map(rows.filter((r) => r.category).map((r) => [r.category!, Number(r.score)]));
}

export async function decisionCount(viewer: Viewer, sinceDays = 30): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(topicEvents)
    .where(
      and(
        eq(topicEvents.userId, viewer.id),
        sql`${topicEvents.at} > now() - ${`${sinceDays} days`}::interval`,
      ),
    );
  return Number(row?.n ?? 0);
}

/** Adopt, reject or save. Adopting hands the topic to the backlog with an owner
 * — that is what "adopt" means to a producer. */
export async function decide(
  viewer: Viewer,
  topicId: string,
  action: "adopt" | "reject" | "save" | "unsave",
) {
  const [topic] = await db
    .select()
    .from(topics)
    .where(and(eq(topics.id, topicId), eq(topics.tenantId, viewer.tenantId)))
    .limit(1);
  if (!topic) throw new Error("Topic not found");

  const status =
    action === "adopt" ? "adopted" : action === "reject" ? "rejected" : action === "save" ? "saved" : "new";

  await db.transaction(async (trx) => {
    await trx
      .update(topics)
      .set({
        status,
        ownerId: action === "adopt" ? viewer.id : topic.ownerId,
        updatedAt: new Date(),
      })
      .where(eq(topics.id, topicId));

    await trx.insert(topicEvents).values({
      id: newId("top"),
      topicId,
      userId: viewer.id,
      action,
      category: topic.category,
    });
  });

  await audit(viewer, `research.${action}`, {
    objectType: "topic",
    objectId: topicId,
    module: "research",
    meta: { name: topic.name },
  });
}

/** Sets the backlog fields an adopted topic needs before Script can pick it up. */
export async function planTopic(
  viewer: Viewer,
  topicId: string,
  input: { ownerId?: string | null; targetChannel?: string | null; dueDate?: string | null },
) {
  await db
    .update(topics)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(topics.id, topicId), eq(topics.tenantId, viewer.tenantId)));
  await audit(viewer, "research.plan", { objectType: "topic", objectId: topicId, module: "research" });
}

export type SeriesResult = {
  query: string;
  points: Point[];
  articles: { title: string; url: string; domain: string; at: string }[];
  sourceKey: string;
  fetchedAt: Date | null;
  /** True when nothing is cached yet and a fetch has been queued. */
  pending: boolean;
  error: string | null;
};

/**
 * Series for Search & compare. Cached series come back immediately; anything
 * missing or stale is queued and reported as pending, so the screen can say
 * "collecting" instead of hanging on a source that answers once every five
 * seconds.
 */
export async function seriesFor(
  viewer: Viewer,
  queries: string[],
  window: Window,
  maxAgeHours = 12,
): Promise<SeriesResult[]> {
  const wanted = queries.map((q) => q.trim()).filter(Boolean).slice(0, 5);
  if (!wanted.length) return [];

  const cached = await db
    .select()
    .from(seriesCache)
    .where(and(eq(seriesCache.window, window), inArray(seriesCache.query, wanted)));

  const byQuery = new Map(cached.map((c) => [c.query, c]));
  const now = Date.now();
  const stale = now - maxAgeHours * 3_600_000;
  /*
   * A round that fell back to Hacker News or to article counts, because GDELT
   * was rate-limiting this address, is not worth keeping for twelve hours: the
   * cooldown is ten minutes and the chart it produced is the thin one. It was
   * kept, though, because the row looked fresh — so a phrase asked for during
   * a rate limit stayed on the fallback source until the next morning.
   */
  const degradedStale = now - 3_600_000;

  const out: (SeriesResult & { refresh: boolean })[] = wanted.map((query) => {
    const hit = byQuery.get(query);
    const has = Boolean(hit && hit.points.length > 0);
    const degraded = Boolean(hit && (hit.error || hit.sourceKey !== "gdelt"));
    const fresh = Boolean(
      hit &&
        has &&
        hit.fetchedAt.getTime() > (degraded ? degradedStale : stale),
    );
    return {
      query,
      points: hit?.points ?? [],
      articles: hit?.articles ?? [],
      sourceKey: hit?.sourceKey ?? "gdelt",
      fetchedAt: hit?.fetchedAt ?? null,
      // "Collecting" means there is nothing to draw yet. A thin chart from a
      // fallback source is something, and saying "collecting" over it would be
      // a spinner that never stops.
      pending: !has,
      error: hit?.error ?? null,
      refresh: !fresh,
    };
  });

  // Queued together, not one after another: this runs while a page is being
  // rendered, and five queues in sequence is five round trips to Singapore
  // before anybody sees a chart.
  await Promise.all(
    out
      .filter((s) => s.refresh)
      .map((s) =>
        enqueue({
          tenantId: viewer.tenantId,
          type: "research.series",
          module: "research",
          payload: { query: s.query, window },
          createdBy: viewer.id,
          dedupeKey: `series:${s.query}:${window}`,
          priority: 5,
        }),
      ),
  );

  // `refresh` is how this function decided what to queue; it is not part of
  // what a screen renders.
  return out.map((s) => ({
    query: s.query,
    points: s.points,
    articles: s.articles,
    sourceKey: s.sourceKey,
    fetchedAt: s.fetchedAt,
    pending: s.pending,
    error: s.error,
  }));
}

/** "Export the comparison to the database as a research report" (brief). */
export async function exportComparison(
  viewer: Viewer,
  queries: string[],
  window: Window,
  region: string,
) {
  const series = await seriesFor(viewer, queries, window);
  const today = new Date().toISOString().slice(0, 10);

  const lines = [
    `# Search & compare — ${queries.join(" vs ")}`,
    "",
    `**Window:** last ${WINDOW_DAYS[window]} days, to ${today}  `,
    `**Region:** ${region}  `,
    `**Source:** GDELT worldwide coverage volume, and Google News for the articles behind it.`,
    "",
    "| Series | Peak / day | Avg / day | Change over the window | Points |",
    "|---|---:|---:|---:|---:|",
    ...series.map((s) => {
      const values = s.points.map((p) => p.v);
      const peak = values.length ? Math.max(...values) : 0;
      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      const change = changeOver(s.points);
      return `| ${s.query} | ${peak.toFixed(3)} | ${avg.toFixed(3)} | ${(change * 100).toFixed(1)}% | ${s.points.length} |`;
    }),
    "",
    "## Primary sources",
    ...series.flatMap((s) => [
      "",
      `### ${s.query}`,
      ...(s.articles.length
        ? s.articles.slice(0, 8).map((a) => `- [${a.title}](${a.url}) — ${a.domain}, ${a.at.slice(0, 10)}`)
        : ["- No articles cached yet for this series."]),
    ]),
    "",
    "---",
    "",
    "Figures are GDELT's normalised share of worldwide coverage, not article counts. A rise means the world is talking about it more, relative to everything else being published.",
  ];

  const file = await createDocument(viewer, {
    name: `Compare — ${queries.join(" vs ")} — ${today}.md`,
    text: lines.join("\n"),
    tags: ["research", "comparison"],
  });

  await db.insert(comparisons).values({
    id: newId("rep"),
    tenantId: viewer.tenantId,
    userId: viewer.id,
    queries,
    window,
    region,
    fileId: file.id,
  });

  await audit(viewer, "research.export", {
    objectType: "file",
    objectId: file.id,
    module: "research",
    meta: { queries },
  });

  return file;
}

/** Change between the first and last thirds of a series, which is what the
 * "14 d change" column means when the window is longer. */
export function changeOver(points: Point[]): number {
  if (points.length < 6) return 0;
  const third = Math.max(1, Math.floor(points.length / 3));
  const head = points.slice(0, third);
  const tail = points.slice(-third);
  const avg = (xs: Point[]) => xs.reduce((a, b) => a + b.v, 0) / xs.length;
  const start = avg(head);
  if (!start) return avg(tail) > 0 ? 1 : 0;
  return (avg(tail) - start) / start;
}

/** The "Connected sources" list, with the status dots meaning something. */
export async function connectedSources() {
  return db.select().from(researchSources).orderBy(researchSources.kind, researchSources.name);
}

/**
 * Start watching a topic.
 *
 * The studio chooses its own beats; the seed only ever provided a starting
 * set. Creating one queues its first refresh straight away, so the dashboard
 * fills in within a minute or two rather than at the next scheduled run.
 */
/**
 * Which beat a phrase belongs to, when nobody said.
 *
 * A stated keyword map rather than a model call. Three reasons: it is free and
 * instant on a path somebody is waiting on, it is the same answer every time,
 * and it is a guess a person can read and correct — a model's guess looks
 * authoritative and is not.
 *
 * Anything it does not recognise is left unfiled, which is honest. The beats
 * panel shows unfiled topics under "All" and they are still watched, ranked
 * and collected exactly the same.
 */
const BEAT_WORDS: Record<string, string[]> = {
  ai: ["ai", "artificial intelligence", "llm", "gpt", "openai", "anthropic", "gemini", "大模型", "agent", "machine learning", "人工智能", "copilot", "inference"],
  chain: ["crypto", "blockchain", "bitcoin", "btc", "ethereum", "eth", "solana", "web3", "token", "defi", "stablecoin", "binance", "加密", "区块链"],
  semi: ["nvidia", "semiconductor", "chip", "tsmc", "amd", "intel", "arm", "wafer", "foundry", "hbm", "lithography", "asml", "芯片", "半导体"],
  devices: ["iphone", "apple", "android", "samsung", "laptop", "headset", "wearable", "vision pro", "consumer tech", "手机", "耳机"],
  fintech: ["fintech", "payments", "bank", "banking", "neobank", "stripe", "wise", "remittance", "支付", "金融科技"],
  ev: ["ev", "electric vehicle", "tesla", "byd", "battery", "charging", "autonomous", "self-driving", "电动车", "电池"],
  startups: ["startup", "venture", "vc", "seed round", "series a", "funding", "founder", "accelerator", "创业", "融资"],
};

export function guessBeat(phrase: string): string | null {
  const q = phrase.toLowerCase();
  for (const [key, words] of Object.entries(BEAT_WORDS)) {
    // Whole words for the short Latin ones, so "ev" does not match "seven"
    // and "ai" does not match "email".
    if (words.some((w) => (/^[a-z]{1,3}$/.test(w) ? new RegExp(`\\b${w}\\b`).test(q) : q.includes(w)))) {
      return key;
    }
  }
  return null;
}

export async function createTopic(
  viewer: Viewer,
  input: { query: string; name?: string; category?: string | null; region?: string },
) {
  const query = input.query.trim();
  if (!query) throw new Error("A topic needs a phrase to watch");
  if (query.length > 80) throw new Error("That phrase is too long to watch");

  const region = input.region ?? "HK";

  // Insert first and let `topics_query_idx` settle it: reading before writing
  // costs a round trip and still loses to two people watching the same phrase
  // at the same moment. No row back means someone else got there.
  const [row] = await db
    .insert(topics)
    .values({
      id: newId("top"),
      tenantId: viewer.tenantId,
      query,
      name: (input.name ?? query).slice(0, 120),
      // What the person filtering to a beat plainly meant, then a guess from
      // the phrase, then nothing.
      category: input.category ?? guessBeat(query),
      region,
    })
    .onConflictDoNothing({ target: [topics.tenantId, topics.query, topics.region] })
    .returning();

  if (!row) {
    const [existing] = await db
      .select()
      .from(topics)
      .where(and(eq(topics.tenantId, viewer.tenantId), eq(topics.query, query), eq(topics.region, region)))
      .limit(1);
    if (existing) return existing;
    throw new Error("Could not start watching that phrase");
  }

  await enqueue({
    tenantId: viewer.tenantId,
    type: "research.refreshTopic",
    module: "research",
    payload: { topicId: row.id },
    objectType: "topic",
    objectId: row.id,
    createdBy: viewer.id,
    dedupeKey: `topic:${row.id}`,
    priority: 10,
  });

  await audit(viewer, "research.watch", {
    objectType: "topic",
    objectId: row.id,
    module: "research",
    meta: { query },
  });

  return row;
}

/** Stop watching. The events stay: they are what trained the ranking. */
export async function removeTopic(viewer: Viewer, topicId: string) {
  await db
    .delete(topics)
    .where(and(eq(topics.id, topicId), eq(topics.tenantId, viewer.tenantId)));
  await audit(viewer, "research.unwatch", { objectType: "topic", objectId: topicId, module: "research" });
}

/**
 * Moves an adopted topic along the board.
 *
 * The last two lanes belong to Script: once that module exists, a brief
 * becoming a draft will set the stage itself. Until then a producer moves the
 * card, which is how they track work the product cannot yet see.
 */
export async function moveTopicStage(
  viewer: Viewer,
  topicId: string,
  stage: "adopted" | "briefing" | "scripting" | "handed",
) {
  const [row] = await db
    .update(topics)
    .set({ stage, updatedAt: new Date() })
    .where(and(eq(topics.id, topicId), eq(topics.tenantId, viewer.tenantId)))
    .returning({ id: topics.id, name: topics.name });

  if (!row) throw new Error("Topic not found");

  await audit(viewer, "research.stage", {
    objectType: "topic",
    objectId: topicId,
    module: "research",
    meta: { stage, name: row.name },
  });
}
