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
import { PLATFORMS, type PlatformKey, type HotRow } from "@/lib/research/platform-catalog";

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
  return { platform, rows: row.rows as HotRow[], note: row.note, fetchedAt: row.fetchedAt.getTime(), summary: row.summary, judged: (row.judged as Judged | null) ?? null };
}

/** Read one platform live and store what came back. Used by the collector. */
export async function collectPlatform(platform: PlatformKey, tenantId: string | null = process.env.TENANT_ID ?? null): Promise<PlatformHot> {
  const hot = await readLive(platform);
  if (hot.rows.length) {
    const [summary, judged] = await Promise.all([
      summarizeHot(platform, hot.rows),
      tenantId ? judgeHot(tenantId, platform, hot.rows, hot.fetchedAt).catch(() => null) : Promise.resolve(null),
    ]);
    hot.summary = summary;
    hot.judged = judged;
    await db.insert(hotSnapshots).values({ id: newId("hot"), platform, rows: hot.rows, note: hot.note, summary, judged, fetchedAt: new Date(hot.fetchedAt) });
    memo.delete(platform);
  }
  return hot;
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

/** Every platform that has a list, one after another. */
export async function collectAll(): Promise<{ platform: PlatformKey; rows: number; note: string | null }[]> {
  const out = [];
  for (const p of PLATFORMS) {
    if (p.unavailable) continue;
    const hot = await collectPlatform(p.key);
    out.push({ platform: p.key, rows: hot.rows.length, note: hot.note });
  }
  return out;
}

async function readLive(platform: PlatformKey): Promise<PlatformHot> {
  const done = (rows: HotRow[], note: string | null = null): PlatformHot => ({ platform, rows, note, fetchedAt: Date.now() });

  try {
    switch (platform) {
      case "google": {
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
        const rows = await trendingVideos("HK", 24);
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
                          : await tiktokExplore();
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
