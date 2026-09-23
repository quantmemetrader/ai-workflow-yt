import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { researchSources, seriesCache, topics } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import {
  dailyCounts,
  gdeltTimeline,
  hackerNewsSeries,
  youtubeSeries,
  newsSearch,
  sourceFeed,
  type Article,
  type Point,
} from "./fetchers";
import { env } from "@/lib/env";
import { SOURCES, unavailableReason, usableSources } from "./sources";
import { changeOver, WINDOW_DAYS, type Window } from "./service";

/**
 * Filling the research tables from the outside world. Only the worker calls
 * this.
 *
 * A source that fails does not fail the round: its row records what went wrong
 * and the dot beside its name in the sidebar goes amber, which is more useful
 * to a producer than an empty chart with no explanation.
 */

/** Registers every source we know about, so the sidebar list is the code's own
 * list rather than a hand-maintained duplicate. */
export async function syncSourceRegistry() {
  // One statement rather than one per source: this runs at every worker boot,
  // and a round trip to Singapore costs a quarter of a second.
  await db
    .insert(researchSources)
    .values(
      SOURCES.map((source) => {
        const reason = unavailableReason(source);
        return {
          key: source.key,
          name: source.name,
          kind: source.kind,
          homepage: source.homepage,
          status: (reason ? "unconfigured" : "degraded") as "unconfigured" | "degraded",
          note: reason,
        };
      }),
    )
    .onConflictDoUpdate({
      target: researchSources.key,
      set: {
        name: sql`excluded.name`,
        kind: sql`excluded.kind`,
        homepage: sql`excluded.homepage`,
        note: sql`excluded.note`,
        /**
         * Status is normally owned by whoever last tried to read the source,
         * not by this registry — overwriting it here would throw away the
         * outcome of the last fetch on every worker boot.
         *
         * The one case it must be touched is a source whose *availability*
         * changed. A key arriving in the environment has to lift
         * "unconfigured", or the sidebar keeps asking for a credential that is
         * already there; a key leaving has to restore it. Anything else keeps
         * the status it earned.
         */
        status: sql`case
          when excluded.note is not null then 'unconfigured'::source_status
          when ${researchSources.status} = 'unconfigured' then 'degraded'::source_status
          else ${researchSources.status}
        end`,
      },
    });

  // A source removed from the registry has to leave the sidebar too. Without
  // this, "YouTube mostPopular" stayed on screen after it was replaced,
  // telling people we needed a key we had already stopped needing.
  await db.delete(researchSources).where(
    sql`key not in (${sql.join(
      SOURCES.map((s) => sql`${s.key}`),
      sql`, `,
    )})`,
  );
}

async function markSource(key: string, ok: boolean, error?: string) {
  await db
    .update(researchSources)
    .set(
      ok
        ? { status: "live", lastOkAt: new Date(), lastError: null }
        : { status: "degraded", lastError: error?.slice(0, 300) ?? "unknown error" },
    )
    .where(eq(researchSources.key, key));
}

/**
 * One series, and the sources behind it.
 *
 * **YouTube first, now.** The chain used to start at GDELT, which rate-limits
 * this address, and fall through Hacker News to counting Google News
 * headlines — three proxies for attention, none of them about video. The
 * studio makes videos, and the platform's own API answers in under a second
 * with what was published about a phrase and what it was watched. That is the
 * signal; the rest are the fallback now, in that order, and the row records
 * which one drew the line because the brief insists every chart states its
 * source.
 */
export async function refreshSeries(query: string, window: Window) {
  let points: Point[] = [];
  let sourceKey = "youtube";
  let error: string | null = null;
  let youtubeArticleRows: Article[] = [];

  if (env.youtube.configured) {
    try {
      const yt = await youtubeSeries(query, WINDOW_DAYS[window]);
      // One video is a fact, not a line. Below a week of days the shape says
      // nothing and the older sources are worth asking.
      if (yt.points.length >= 7) points = yt.points;
      youtubeArticleRows = yt.articles;
      await markSource("youtube", true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markSource("youtube", false, message);
      error = message;
    }
  }

  if (!points.length) {
    sourceKey = "gdelt";
    try {
      points = await gdeltTimeline(query, window);
      await markSource("gdelt", true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      error = error ? `${error}; ${message}` : message;
      await markSource("gdelt", false, message);
    }
  }

  // Hacker News answers every time, which is what keeps the charts real while
  // GDELT is parked. For a technology studio it is also a signal worth having
  // in its own right.
  if (!points.length) {
    try {
      points = await hackerNewsSeries(query, WINDOW_DAYS[window]);
      sourceKey = "hackernews";
      await markSource("hackernews", true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markSource("hackernews", false, message);
      error = error ? `${error}; ${message}` : message;
    }
  }

  let articles: Article[] = [];
  try {
    articles = await newsSearch(query, 40);
    await markSource("googlenews", true);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markSource("googlenews", false, message);
    error = error ? `${error}; ${message}` : message;
  }

  /*
   * The videos are sources too. "Why it's moving" listed newspaper headlines
   * only, on a dashboard for a video studio — the thing most worth seeing was
   * the video somebody else already made about it.
   */
  if (youtubeArticleRows.length) {
    articles = [...youtubeArticleRows, ...articles]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 40);
  }

  const signalIsFlat = points.length > 0 && points.every((p) => p.v === 0);
  if (signalIsFlat && articles.length) {
    const fromArticles = dailyCounts(articles, WINDOW_DAYS[window]);
    if (fromArticles.length > 1) {
      points = fromArticles;
      sourceKey = "googlenews";
      error = error ? `${error}; no signal volume, chart drawn from article counts` : null;
    }
  }

  if (points.length < 7 && articles.length) {
    // Last resort: count the articles themselves. Only worth drawing if it
    // produces a line rather than a dot.
    const fromArticles = dailyCounts(articles, WINDOW_DAYS[window]);
    if (fromArticles.length > points.length) {
      points = fromArticles;
      sourceKey = "googlenews";
      error = error ? `${error}; chart drawn from article counts` : "chart drawn from article counts";
    }
  }

  // Never replace a good series with an empty one: a source having a bad day
  // should not wipe yesterday's chart.
  if (!points.length) {
    const [existing] = await db
      .select()
      .from(seriesCache)
      .where(and(eq(seriesCache.query, query), eq(seriesCache.window, window)))
      .limit(1);
    if (existing?.points.length) {
      await db
        .update(seriesCache)
        .set({ error: error ?? "no fresh data this round", fetchedAt: existing.fetchedAt })
        .where(eq(seriesCache.id, existing.id));
      return { points: existing.points.length, articles: articles.length, sourceKey: existing.sourceKey, error };
    }
  }

  await db
    .insert(seriesCache)
    .values({
      id: newId("rep"),
      sourceKey,
      query,
      window,
      points,
      articles: articles.slice(0, 12),
      fetchedAt: new Date(),
      error,
    })
    .onConflictDoUpdate({
      target: [seriesCache.query, seriesCache.window],
      set: { sourceKey, points, articles: articles.slice(0, 12), fetchedAt: new Date(), error },
    });

  return { points: points.length, articles: articles.length, sourceKey, error };
}

/** One topic: refresh its series, then recompute the numbers the dashboard
 * ranks on. */
export async function refreshTopic(topicId: string) {
  const [topic] = await db.select().from(topics).where(eq(topics.id, topicId)).limit(1);
  if (!topic) throw new Error(`No topic ${topicId}`);

  let result: Awaited<ReturnType<typeof refreshSeries>>;
  try {
    result = await refreshSeries(topic.query, "3m");
  } catch (err) {
    // The round failed outright. The topic still records that it was tried,
    // so the dashboard stops saying "collecting…" and shows what it has.
    await db.update(topics).set({ lastFetchedAt: new Date(), updatedAt: new Date() }).where(eq(topics.id, topicId));
    throw err;
  }

  const [cached] = await db
    .select()
    .from(seriesCache)
    .where(and(eq(seriesCache.query, topic.query), eq(seriesCache.window, "3m")))
    .limit(1);

  const points = cached?.points ?? [];
  const recent = points.slice(-14);
  const signalHeat = recent.length ? recent.reduce((a, b) => a + b.v, 0) / recent.length : 0;

  /*
   * Heat has to mean "how much is being said about this now", and no single
   * free source covers every beat: Hacker News knows about HBM and nothing
   * about Hong Kong virtual banks. So a topic with no signal volume falls back
   * to how many articles the news search found in the last week, which is a
   * real measurement of the same thing from a different angle. `sourceKeys`
   * records which one the number came from, and the screen says so.
   */
  const weekAgo = Date.now() - 7 * 86_400_000;
  const recentArticles = (cached?.articles ?? []).filter((a) => new Date(a.at).getTime() > weekAgo).length;
  const heat = signalHeat > 0 ? signalHeat : recentArticles;
  const change = changeOver(points);

  await db
    .update(topics)
    .set({
      heat,
      change14d: change,
      rising: change > 0.05,
      sourceKeys:
        signalHeat > 0
          ? [result.sourceKey, ...(cached?.articles.length ? ["googlenews"] : [])]
          : ["googlenews"],
      lastFetchedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(topics.id, topicId));

  return { ...result, heat, change };
}

/** Pulls each outlet's own feed, so "Connected sources" reflects reality and
 * the studio can see what its named sources are publishing right now. */
export async function refreshFeeds() {
  const results: Record<string, number> = {};

  for (const source of usableSources()) {
    if (!source.feed) continue;
    try {
      const articles = await sourceFeed(source.key, 60);
      results[source.key] = articles.length;
      await db
        .insert(seriesCache)
        .values({
          id: newId("rep"),
          sourceKey: source.key,
          // A series is keyed by query and window, so each outlet's own feed
          // needs its own query — otherwise the outlets overwrite each other.
          query: `__feed__:${source.key}`,
          window: "feed",
          points: dailyCounts(articles, 30),
          articles: articles.slice(0, 12),
          fetchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [seriesCache.query, seriesCache.window],
          set: { points: dailyCounts(articles, 30), articles: articles.slice(0, 12), fetchedAt: new Date() },
        });
      await markSource(source.key, true);
    } catch (err) {
      results[source.key] = 0;
      await markSource(source.key, false, err instanceof Error ? err.message : String(err));
    }
  }

  return results;
}

/** Queues a refresh for every topic that has not been updated today. */
export async function staleTopics(tenantId: string, olderThanHours = 20) {
  return db
    .select({ id: topics.id, query: topics.query })
    .from(topics)
    .where(
      and(
        eq(topics.tenantId, tenantId),
        sql`${topics.lastFetchedAt} is null or ${topics.lastFetchedAt} < now() - ${`${olderThanHours} hours`}::interval`,
      ),
    )
    .limit(50);
}
