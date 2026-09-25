import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { hotSnapshots } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { env } from "@/lib/env";
import {
  bilibiliHotSearch,
  douyinBillboardVideos,
  douyinBreakouts,
  douyinHotSearch,
  douyinRising,
  tiktokExplore,
  weiboHotSearch,
  xiaohongshuHotInspiration,
} from "@/lib/social/tikhub";
import { trendingNearby } from "@/lib/research/trending";
import { trendingVideos } from "@/lib/research/youtube";
import { summarizeHot } from "@/lib/research/summary";
import { judgeHot, type Judged } from "@/lib/research/judge";
import { FOCUS_FALLBACK, channelFocus, classifyHot } from "@/lib/research/relevance";
import { recordUsage } from "@/lib/ai/ledger";

/**
 * What each platform says is hot, read from storage.
 *
 * Reading a platform takes seconds and TikHub bills per request, and when
 * each page view called out the studio waited on Amsterdam-to-China round
 * trips and every one of the four app processes kept its own copy. Now
 * `scripts/collect-hot.ts` reads every list on the hour into
 * `hot_snapshots`, and a page reads the newest row: one database read.
 *
 * A platform with nothing stored yet (a new one, or the first hour after a
 * wipe) is read live once and stored, so the page is never empty just
 * because the collector has not run.
 *
 * Every row is the platform's own list, read as published. The unit of
 * "heat" is kept as the platform gave it. WeChat has no public list.
 */
export { PLATFORMS, isPlatformKey, type PlatformKey } from "@/lib/research/platform-catalog";
import { PLATFORMS, onFocus, type PlatformKey, type HotRow, type RelevanceMap } from "@/lib/research/platform-catalog";

export type PlatformHot = {
  platform: PlatformKey;
  rows: HotRow[];
  /** Why the list is empty or thin, in the studio's language. */
  note: string | null;
  fetchedAt: number;
  /** 研究员's line on what is going viral here, written at collection. */
  summary?: string | null;
  /** 研究员's marks on the rows, made at collection so no page waits. */
  judged?: Judged | null;
  /** Business, tech or neither, per row (`lib/research/relevance.ts`).
   *  Null on a list collected before this existed, or when the classifier
   *  failed: readers show such a list unfiltered. */
  relevance?: RelevanceMap | null;
};

/** A stored list older than this is read again live rather than shown. */
const STALE_MS = 6 * 60 * 60_000;
/** Within a process, a stored list is re-read from the database this often. */
const MEMO_MS = 60_000;
const memo = new Map<PlatformKey, { at: number; hot: PlatformHot }>();

export async function platformHot(platform: PlatformKey): Promise<PlatformHot> {
  const m = memo.get(platform);
  if (m && Date.now() - m.at < MEMO_MS) return m.hot;

  const stored = await latestStored(platform);
  if (stored && Date.now() - stored.fetchedAt < STALE_MS) {
    memo.set(platform, { at: Date.now(), hot: stored });
    return stored;
  }

  const live = await collectPlatform(platform);
  // A failed live read still shows the last good list, labelled by its time.
  const hot = live.rows.length || !stored ? live : stored;
  memo.set(platform, { at: Date.now(), hot });
  return hot;
}

async function latestStored(platform: PlatformKey): Promise<PlatformHot | null> {
  const [row] = await db
    .select()
    .from(hotSnapshots)
    .where(and(eq(hotSnapshots.platform, platform), gte(hotSnapshots.fetchedAt, new Date(Date.now() - 7 * 86_400_000))))
    .orderBy(desc(hotSnapshots.fetchedAt))
    .limit(1);
  if (!row || !Array.isArray(row.rows) || row.rows.length === 0) return null;
  return {
    platform,
    rows: row.rows as HotRow[],
    note: row.note,
    fetchedAt: row.fetchedAt.getTime(),
    summary: row.summary,
    judged: (row.judged as Judged | null) ?? null,
    relevance: (row.relevance as RelevanceMap | null) ?? null,
  };
}

/** When a platform was last stored, without reading its rows. */
async function newestAt(platform: PlatformKey): Promise<number | null> {
  const [row] = await db
    .select({ at: hotSnapshots.fetchedAt })
    .from(hotSnapshots)
    .where(eq(hotSnapshots.platform, platform))
    .orderBy(desc(hotSnapshots.fetchedAt))
    .limit(1);
  return row ? row.at.getTime() : null;
}

/**
 * The classifier's model calls, on the Research agent's own ledger row, so
 * the AI spend screen shows what keeping the lists on the beat costs. Looked
 * up once per list and only when a model was actually asked; a studio whose
 * agent is switched off still gets its marks, just unmetered.
 */
function meterFor(tenantId: string) {
  let viewer: Promise<{ id: string; tenantId: string } | null> | null = null;
  return async (res: { model: string; provider?: string; promptTokens: number; completionTokens: number; costMicros: number; requestId?: string }) => {
    viewer ??= import("@/lib/agents").then((m) => m.agentViewer(tenantId, "research")).catch(() => null);
    const v = await viewer;
    if (!v) return;
    await recordUsage({
      viewer: v,
      module: "research",
      model: res.model,
      provider: res.provider ?? "openrouter",
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      costMicros: res.costMicros,
      requestId: res.requestId,
    });
  };
}

/**
 * Read one platform live and store what came back. Used by the collector.
 *
 * The tenant defaults to the studio's own, as every other script does. It
 * defaulted to `null` while `.env.local` has no `TENANT_ID`, so 研究员's
 * marks were never stored and every tab view asked a model for them again.
 *
 * Order matters: the rows are marked business / tech / other first, and the
 * researcher's line and marks are then written about the rows on the beat —
 * a summary of a list that is mostly concerts and festival greetings was
 * the noise the studio complained about, restated. With fewer than three
 * rows on the beat the marks look at the whole list, since there is too
 * little to judge otherwise; the screen's filter still hides what is off it.
 */
export async function collectPlatform(
  platform: PlatformKey,
  tenantId: string = process.env.TENANT_ID ?? "tnt_aurafarmers",
  opts: { reuse?: RelevanceMap } = {},
): Promise<PlatformHot> {
  const hot = await readLive(platform);
  if (hot.rows.length) {
    const [prev, pillars] = await Promise.all([
      latestStored(platform).catch(() => null),
      channelFocus(tenantId).catch(() => FOCUS_FALLBACK),
    ]);
    const { relevance, counts } = await classifyHot(platform, hot.rows, {
      prev: { ...opts.reuse, ...(prev?.relevance ?? {}) },
      pillars,
      onUsage: meterFor(tenantId),
    });
    if (relevance) {
      console.log(`[research] ${platform} relevance: ${counts.rules} by rule, ${counts.reused} reused, ${counts.model} by model${counts.missing ? `, ${counts.missing} unmarked` : ""}`);
    }
    const focus = relevance ? hot.rows.filter((r) => onFocus(relevance[r.phrase])) : hot.rows;
    const [summary, judged] = await Promise.all([
      summarizeHot(platform, hot.rows, relevance),
      judgeHot(tenantId, platform, relevance && focus.length >= 3 ? focus : hot.rows, hot.fetchedAt).catch(() => null),
    ]);
    hot.summary = summary;
    hot.judged = judged;
    hot.relevance = relevance;
    await db.insert(hotSnapshots).values({ id: newId("hot"), platform, rows: hot.rows, note: hot.note, summary, judged, relevance, fetchedAt: new Date(hot.fetchedAt) });
    memo.delete(platform);
  }
  return hot;
}

/**
 * One platform's newest stored list, never a live read — for a page render,
 * which must not wait on a platform or a model. `platformHot` reads live
 * when the stored list is stale; this shows the stale list (with its time)
 * instead, or null when nothing was ever stored.
 */
export async function storedHot(platform: PlatformKey): Promise<PlatformHot | null> {
  return latestStored(platform);
}

/** Every platform's newest stored list at once, for a page that wants all
 *  its tabs ready before anybody clicks one. Storage only, never a live read. */
export async function storedAll(): Promise<Partial<Record<PlatformKey, PlatformHot>>> {
  const out: Partial<Record<PlatformKey, PlatformHot>> = {};
  await Promise.all(
    PLATFORMS.filter((p) => !p.unavailable).map(async (p) => {
      const hot = await latestStored(p.key);
      if (hot) out[p.key] = hot;
    }),
  );
  return out;
}

/**
 * How long a stored list is left alone before the collector reads it again.
 *
 * TikHub bills per request. Two things were spending it for nothing:
 *
 *   - Extra runs. 26 full runs landed between 05:50 and 07:28 HKT on 09-25,
 *     where two were due — about 260 billed requests for lists that had not
 *     changed. A list stored under half an hour ago is not read again unless
 *     the run says `--force`.
 *   - The creator billboards. 财经, 科技 and the low-follower breakouts rank
 *     over 24 hours and 7 days, and across 49 hourly runs they showed about
 *     one new title per run. They are read every third hour (a list under
 *     2h50m old is kept), which saves four of the ten requests in two runs
 *     of three. Age rather than the clock hour, so a run missed to a restart
 *     does not push them out to six hours.
 */
const MIN_GAP_MS = 30 * 60_000;
const SLOW_GAP_MS = 170 * 60_000;
const SLOW = new Set<PlatformKey>(["dy_breakout", "dy_finance", "dy_tech"]);

/** Every platform that has a list, one after another. */
export async function collectAll(
  opts: { force?: boolean } = {},
): Promise<{ platform: PlatformKey; rows: number; note: string | null; skipped?: string }[]> {
  const out: { platform: PlatformKey; rows: number; note: string | null; skipped?: string }[] = [];
  /* What this run has already marked, so a video on two 抖音 lists is
     classified once. */
  const seen: RelevanceMap = {};
  for (const p of PLATFORMS) {
    if (p.unavailable) continue;
    if (!opts.force) {
      const at = await newestAt(p.key).catch(() => null);
      const gap = SLOW.has(p.key) ? SLOW_GAP_MS : MIN_GAP_MS;
      if (at !== null && Date.now() - at < gap) {
        out.push({ platform: p.key, rows: 0, note: null, skipped: `stored ${Math.round((Date.now() - at) / 60_000)} min ago` });
        continue;
      }
    }
    const hot = await collectPlatform(p.key, undefined, { reuse: seen });
    Object.assign(seen, hot.relevance ?? {});
    out.push({ platform: p.key, rows: hot.rows.length, note: hot.note });
  }
  return out;
}

async function readLive(platform: PlatformKey): Promise<PlatformHot> {
  const done = (rows: HotRow[], note: string | null = null): PlatformHot => ({ platform, rows, note, fetchedAt: Date.now() });

  try {
    switch (platform) {
      case "google": {
        /* Topped up from Taiwan and Singapore only when Hong Kong's feed is
           thin; Britain, the US and Japan added football and lotteries. */
        const rows = await trendingNearby("HK", 30);
        return done(
          rows.map((r) => ({
            phrase: r.phrase,
            heat: null,
            heatLabel: r.traffic,
            url: r.headlineUrl,
            thumbnail: null,
            extra: r.region && r.region !== "HK" ? `${r.region} · ${r.headline ?? ""}`.trim() : r.headline,
          })),
        );
      }
      case "youtube": {
        /* Hong Kong's Science & Technology chart (category 28) rather than
           the whole chart, which is music videos and film trailers. Checked
           on 09-25: Hong Kong has one, 24 videos, phone reviews and chip
           analysis. A region without one answers empty or with an error;
           then the whole chart, said so in the note, and the classifier
           sorts it. One unit of quota either way. */
        const tech = await trendingVideos("HK", 24, { categoryId: "28" }).catch(() => []);
        const rows = tech.length ? tech : await trendingVideos("HK", 24);
        return done(
          rows.map((v) => ({
            phrase: v.title,
            heat: v.views,
            heatLabel: null,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            thumbnail: v.thumbnail,
            extra: v.channelTitle,
            stats: {
              views: v.views,
              likes: v.likes,
              comments: v.comments,
              likeRate: v.views ? v.likes / v.views : null,
              publishedAt: v.publishedAt,
            },
          })),
          tech.length ? null : "YouTube 香港此刻没有科技分类榜，这里是总榜。",
        );
      }
      case "wechat":
        return done([], "微信没有公开的热榜接口，所以这里不显示别人的猜测。");
      default: {
        if (!env.tikhub.configured) {
          return done([], "没有配置 TikHub 密钥，读不到这个平台。在 管理 → 渠道与凭证 里设置。");
        }
        const rows =
          platform === "dy_breakout"
            ? await douyinBreakouts(["finance", "tech"])
            : platform === "dy_finance"
              ? await douyinBillboardVideos(["finance"], { hours: 24 })
              : platform === "dy_tech"
                ? await douyinBillboardVideos(["tech"], { hours: 24 })
                : platform === "dy_rising"
                  ? await douyinRising()
                  : platform === "douyin"
                    ? await douyinHotSearch()
                    : platform === "weibo"
                      ? await weiboHotSearch()
                      : platform === "bilibili"
                        ? await bilibiliHotSearch()
                        : platform === "xiaohongshu"
                          ? await xiaohongshuHotInspiration()
                          : await tiktokExplore(20, 118);
        return done(rows, rows.length ? null : "这个平台刚才没有返回任何内容。");
      }
    }
  } catch (err) {
    /* The reader's own message names the endpoint and quotes the upstream
       body — right for a log, wrong for a screen. */
    console.error(`[research] ${platform} hot list`, err);
    const status = err instanceof Error ? (err.message.match(/\((\d{3})\//)?.[1] ?? null) : null;
    return done(
      [],
      status ? `这个平台刚才没给数据（上游 ${status}）。过一会儿再点一次，通常就好。` : "这个平台暂时读不到，过一会儿再点一次。",
    );
  }
}
