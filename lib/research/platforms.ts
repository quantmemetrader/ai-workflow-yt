import "server-only";
import { env } from "@/lib/env";
import {
  bilibiliHotSearch,
  douyinHotSearch,
  tiktokExplore,
  weiboHotSearch,
  xiaohongshuHotInspiration,
} from "@/lib/social/tikhub";
import { trendingNearby } from "@/lib/research/trending";
import { trendingVideos } from "@/lib/research/youtube";

/**
 * What each platform says is hot, on one switch.
 *
 * The client's ask: *"for trend page see if can select platform — TikTok,
 * rednote, WeChat, YouTube, Weibo etc."* The Trends strip had two feeds,
 * Google's searches and YouTube's chart, and both are Hong Kong's. A studio
 * that publishes into the Chinese platforms too was looking at the wrong
 * side of the wall.
 *
 * Every row here is the platform's own list, read as published — nothing is
 * scraped, and the unit of "heat" is kept as the platform gave it. WeChat has
 * no public list and says so rather than showing somebody else's.
 *
 * TikHub bills per request, so each platform is read at most once per half
 * hour for the whole server, and only when somebody picks it. The two feeds
 * that are free (Google, YouTube) stay on the page load as before.
 */
export { PLATFORMS, isPlatformKey, type PlatformKey } from "@/lib/research/platform-catalog";
import { type PlatformKey, type HotRow } from "@/lib/research/platform-catalog";

export type PlatformHot = {
  platform: PlatformKey;
  rows: HotRow[];
  /** Why the list is empty or thin, in the studio's language. */
  note: string | null;
  fetchedAt: number;
};

const TTL_MS = 30 * 60_000;
const cache = new Map<PlatformKey, PlatformHot>();

export async function platformHot(platform: PlatformKey): Promise<PlatformHot> {
  const hit = cache.get(platform);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit;

  const done = (rows: HotRow[], note: string | null = null): PlatformHot => {
    const out = { platform, rows, note, fetchedAt: Date.now() };
    // A failure is not cached: the next person who looks should get a fresh try.
    if (rows.length) cache.set(platform, out);
    return out;
  };

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
          platform === "douyin"
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
    if (hit) return hit;
    return done([], err instanceof Error ? err.message.slice(0, 160) : "这个平台暂时读不到。");
  }
}
