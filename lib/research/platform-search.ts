import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { hotSnapshots } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { env } from "@/lib/env";
import { searchVideos } from "@/lib/research/youtube";
import type { HotRow } from "@/lib/research/platform-catalog";

/**
 * One phrase, searched on each platform, with every result's own numbers.
 *
 * "Search & compare" drew one line per phrase from one source. The studio
 * wanted what the trends board shows, by platform: for a phrase, what the
 * top posts on YouTube, 抖音, B站 and 小红书 are and how they did. Results
 * are stored (`hot_snapshots`, platform "search:<key>:<phrase>") for six
 * hours, so a phrase looked at twice costs one set of requests.
 */
export type SearchPlatform = "youtube" | "douyin" | "bilibili" | "xiaohongshu";
export const SEARCH_PLATFORMS: SearchPlatform[] = ["youtube", "douyin", "bilibili", "xiaohongshu"];

const TTL_MS = 6 * 60 * 60_000;
const n = (v: unknown): number | null => {
  const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(x) && x >= 0 ? x : null;
};
const rate = (a: number | null, b: number | null) => (a !== null && b ? a / b : null);
const iso = (sec: unknown) => (n(sec) ? new Date(n(sec)! * 1000).toISOString() : null);
const strip = (s: string) => s.replace(/<[^>]+>/g, "").trim();

async function tikhub<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (!env.tikhub.configured) throw new Error("No TikHub key");
  const res = await fetch(env.tikhub.baseUrl + path, {
    method: init?.method ?? "GET",
    headers: { authorization: `Bearer ${env.tikhub.token}`, accept: "application/json", "content-type": "application/json" },
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  const j = (await res.json().catch(() => ({}))) as { data?: T };
  if (!res.ok) throw new Error(`TikHub ${path} ${res.status}`);
  return (j.data ?? (j as T)) as T;
}

async function live(platform: SearchPlatform, q: string): Promise<HotRow[]> {
  if (platform === "youtube") {
    const vids = await searchVideos(q, { days: 90, limit: 12, regionCode: "HK" });
    return vids.map((v) => ({
      phrase: v.title,
      heat: v.views,
      heatLabel: null,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      thumbnail: v.thumbnail,
      extra: v.channelTitle,
      stats: { views: v.views, likes: v.likes, comments: v.comments, likeRate: v.views ? v.likes / v.views : null, publishedAt: v.publishedAt },
    }));
  }
  if (platform === "bilibili") {
    const d = await tikhub<{ data?: { result?: { title?: string; play?: unknown; like?: unknown; review?: unknown; favorites?: unknown; pic?: string; author?: string; bvid?: string; pubdate?: unknown }[] } }>(
      `/api/v1/bilibili/web/fetch_general_search?keyword=${encodeURIComponent(q)}&order=totalrank&page=1&page_size=12`,
    );
    return (d.data?.result ?? []).filter((r) => r.title).map((r) => ({
      phrase: strip(r.title!),
      heat: n(r.play),
      heatLabel: null,
      url: r.bvid ? `https://www.bilibili.com/video/${r.bvid}` : null,
      thumbnail: r.pic ? (r.pic.startsWith("//") ? `https:${r.pic}` : r.pic) : null,
      extra: r.author ?? null,
      stats: { views: n(r.play), likes: n(r.like), comments: n(r.review), likeRate: rate(n(r.like), n(r.play)), publishedAt: iso(r.pubdate) },
    }));
  }
  if (platform === "douyin") {
    const d = await tikhub<{ data?: { aweme_info?: { aweme_id?: string; desc?: string; create_time?: unknown; author?: { nickname?: string; follower_count?: unknown }; statistics?: { play_count?: unknown; digg_count?: unknown; comment_count?: unknown; share_count?: unknown }; video?: { cover?: { url_list?: string[] } } } }[] }>(
      "/api/v1/douyin/search/fetch_general_search_v1",
      { method: "POST", body: { keyword: q, cursor: 0, sort_type: "1", publish_time: "0", filter_duration: "0", content_type: "1" } },
    );
    return (d.data ?? [])
      .map((x) => x.aweme_info)
      .filter((a): a is NonNullable<typeof a> => Boolean(a?.aweme_id))
      .map((a) => {
        const views = n(a.statistics?.play_count) || null;
        const likes = n(a.statistics?.digg_count);
        return {
          phrase: (a.desc ?? "").replace(/#\S+/g, "").trim() || `${a.author?.nickname ?? ""} 的视频`,
          heat: likes,
          heatLabel: null,
          url: `https://www.douyin.com/video/${a.aweme_id}`,
          thumbnail: a.video?.cover?.url_list?.[0] ?? null,
          extra: a.author?.nickname ?? null,
          stats: { views, likes, comments: n(a.statistics?.comment_count), shares: n(a.statistics?.share_count), likeRate: rate(likes, views), fans: n(a.author?.follower_count) || null, publishedAt: iso(a.create_time) },
        };
      });
  }
  const d = await tikhub<{ data?: { items?: { note?: { id?: string; title?: string; liked_count?: unknown; collected_count?: unknown; comments_count?: unknown; images_list?: { url?: string }[]; user?: { nickname?: string }; timestamp?: unknown } }[] } }>(
    `/api/v1/xiaohongshu/app_v2/search_notes?keyword=${encodeURIComponent(q)}&page=1&sort_type=popularity_descending`,
  );
  return (d.data?.items ?? [])
    .map((i) => i.note)
    .filter((x): x is NonNullable<typeof x> => Boolean(x?.id && x.title))
    .map((x) => ({
      phrase: x.title!,
      heat: n(x.liked_count),
      heatLabel: null,
      url: `https://www.xiaohongshu.com/explore/${x.id}`,
      thumbnail: x.images_list?.[0]?.url ?? null,
      extra: x.user?.nickname ?? null,
      stats: { likes: n(x.liked_count), comments: n(x.comments_count), shares: n(x.collected_count), publishedAt: iso(x.timestamp) },
    }));
}

export async function searchPlatform(platform: SearchPlatform, phrase: string): Promise<{ rows: HotRow[]; fetchedAt: number; note: string | null }> {
  const q = phrase.trim().slice(0, 60);
  const key = `search:${platform}:${q.toLowerCase()}`;
  const [hit] = await db
    .select()
    .from(hotSnapshots)
    .where(and(eq(hotSnapshots.platform, key), gte(hotSnapshots.fetchedAt, new Date(Date.now() - TTL_MS))))
    .orderBy(desc(hotSnapshots.fetchedAt))
    .limit(1);
  if (hit) return { rows: hit.rows as HotRow[], fetchedAt: hit.fetchedAt.getTime(), note: hit.note };
  try {
    const rows = await live(platform, q);
    const fetchedAt = Date.now();
    if (rows.length) await db.insert(hotSnapshots).values({ id: newId("hot"), platform: key, rows, fetchedAt: new Date(fetchedAt) });
    return { rows, fetchedAt, note: rows.length ? null : "这个平台上没搜到。" };
  } catch (err) {
    console.error(`[research] search ${platform} "${q}"`, err);
    return { rows: [], fetchedAt: Date.now(), note: "这个平台刚才没给数据，过一会儿再试。" };
  }
}
