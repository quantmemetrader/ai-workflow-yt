import "server-only";
import { env } from "@/lib/env";

/**
 * TikHub — everybody else's accounts, read only.
 *
 * The division of labour with `zernio.ts` is deliberate and worth stating,
 * because getting it wrong would be a privacy problem rather than a bug:
 *
 *   Zernio  → our own channels. Authorised by the studio. Reads *and* writes.
 *   TikHub  → public numbers on anyone's channel. Reads, and only reads.
 *
 * So competitor research comes from here, and nothing that touches the
 * studio's own accounts ever does. There is no write surface in this file and
 * there should never be one.
 *
 * TikHub bills per request and every response is explicit about it
 * ("This request will incur a charge"), so callers are jobs, results are
 * cached, and a screen never reaches this module directly.
 */

export class TikHubError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "TikHubError";
  }
}

export class TikHubUnconfigured extends Error {
  constructor() {
    super("No TIKHUB_TOKEN is set, so outside-platform research is unavailable.");
    this.name = "TikHubUnconfigured";
  }
}

const TIMEOUT_MS = Number(process.env.TIKHUB_TIMEOUT_MS ?? 30_000);

type Query = Record<string, string | number | boolean | undefined | null>;

async function get<T>(path: string, query: Query = {}): Promise<T> {
  if (!env.tikhub.configured) throw new TikHubUnconfigured();

  const url = new URL(env.tikhub.baseUrl + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { authorization: `Bearer ${env.tikhub.token}`, accept: "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    const why = err instanceof Error && err.name === "TimeoutError" ? `did not answer within ${TIMEOUT_MS}ms` : String(err);
    throw new TikHubError(`TikHub GET ${path} ${why}`, 0);
  }

  const text = await res.text();
  let parsed: { code?: number; data?: unknown; detail?: unknown };
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new TikHubError(`TikHub GET ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`, res.status);
  }

  // TikHub answers 200 with a non-200 `code` for application-level failures,
  // so the HTTP status alone is not the outcome.
  if (!res.ok || (parsed.code !== undefined && parsed.code !== 200)) {
    const detail = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail ?? {}).slice(0, 200);
    throw new TikHubError(`TikHub GET ${path} failed (${res.status}/${parsed.code ?? "?"}): ${detail}`, res.status);
  }

  return (parsed.data ?? parsed) as T;
}

/** Whoever the key belongs to, and what it is allowed to reach. Used by the
 * Admin "channels & credentials" screen to show a key's state without ever
 * showing the key. */
export const keyInfo = () =>
  get<never>("/api/v1/tikhub/user/get_user_info").catch((err) => {
    throw err;
  });

// ------------------------------------------------------------------ YouTube

export type TikHubYouTubeVideo = {
  video_id: string;
  title?: string | null;
  description?: string | null;
  url?: string | null;
  thumbnail?: string | null;
  duration?: string | null;
  published_time?: string | null;
  view_count?: string | null;
  short_view_count?: string | null;
};

export const youtubeChannelVideos = (channelId: string) =>
  get<{ videos?: TikHubYouTubeVideo[] }>("/api/v1/youtube/web_v2/get_channel_videos", { channel_id: channelId });

/**
 * A handle or a URL into the channel id everything else needs.
 *
 * `get_channel_videos` takes a `UC…` id and returns an empty list for anything
 * else — no error, just nothing, which is the worst way for this to fail. So a
 * competitor entered as `@handle` or as a URL is resolved here first, and
 * `UC…` is passed straight through rather than spending a metered request on
 * something that is already an id.
 */
export async function resolveYouTubeChannel(input: string): Promise<string | null> {
  const value = input.trim();
  if (/^UC[\w-]{20,}$/.test(value)) return value;

  const url = value.startsWith("http")
    ? value
    : `https://www.youtube.com/${value.startsWith("@") ? value : `@${value}`}`;

  const res = await get<{ channel_id?: string | null }>("/api/v1/youtube/web_v2/get_channel_id", {
    channel_url: url,
  });
  return res.channel_id ?? null;
}

// ------------------------------------------------ what is hot, per platform

/**
 * One row of a platform's own hot list, in one shape.
 *
 * Five platforms, five payloads, five ideas of what "hot" is: 抖音 counts
 * views, 微博 a search index, 小红书 "people looking", TikTok plays. The number
 * is kept as the platform gave it and labelled in its own words where it had
 * any, because a heat score from 微博 and a view count from 抖音 are not the
 * same unit and pretending they are would be inventing a statistic.
 */
export type { HotRow } from "@/lib/research/platform-catalog";
import type { HotRow } from "@/lib/research/platform-catalog";

const asNumber = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

/** 抖音热榜: 51 phrases, in the platform's order. */
export async function douyinHotSearch(): Promise<HotRow[]> {
  const res = await get<{
    data?: {
      word_list?: { word?: string; hot_value?: number; view_count?: number; discuss_video_count?: number }[];
    };
  }>("/api/v1/douyin/app/v3/fetch_hot_search_list");
  return (res.data?.word_list ?? [])
    .filter((w) => typeof w.word === "string" && w.word.trim())
    .map((w) => ({
      phrase: w.word!.trim(),
      heat: asNumber(w.hot_value) ?? asNumber(w.view_count),
      heatLabel: null,
      url: `https://www.douyin.com/search/${encodeURIComponent(w.word!.trim())}`,
      thumbnail: null,
      extra: w.discuss_video_count ? `${w.discuss_video_count} 条视频在讨论` : null,
    }));
}

/**
 * 微博热搜. The payload is the app's own page layout — groups of cells — so
 * the rows are wherever a cell carries a `desc`. `desc_extr` is the search
 * index the app prints beside each entry.
 */
export async function weiboHotSearch(): Promise<HotRow[]> {
  const res = await get<{
    items?: { items?: { data?: { desc?: string; desc_extr?: string; scheme?: string } }[] }[];
  }>("/api/v1/weibo/app/fetch_hot_search");
  const rows: HotRow[] = [];
  for (const group of res.items ?? []) {
    for (const cell of group.items ?? []) {
      const d = cell.data;
      if (!d?.desc || typeof d.desc !== "string") continue;
      const phrase = d.desc.replace(/^#|#$/g, "").trim();
      if (!phrase || rows.some((r) => r.phrase === phrase)) continue;
      rows.push({
        phrase,
        heat: asNumber(d.desc_extr),
        heatLabel: null,
        url: `https://s.weibo.com/weibo?q=${encodeURIComponent(phrase)}`,
        thumbnail: null,
        extra: null,
      });
    }
  }
  return rows;
}

/** B站热搜: thirty keywords with a heat score. */
export async function bilibiliHotSearch(limit = 30): Promise<HotRow[]> {
  const res = await get<{
    data?: { trending?: { list?: { keyword?: string; show_name?: string; heat_score?: number }[] } };
  }>("/api/v1/bilibili/web/fetch_hot_search", { limit });
  return (res.data?.trending?.list ?? [])
    .map((k) => (k.show_name ?? k.keyword ?? "").trim())
    .map((phrase, i) => ({ phrase, i }))
    .filter((x) => x.phrase)
    .map(({ phrase, i }) => ({
      phrase,
      heat: asNumber(res.data?.trending?.list?.[i]?.heat_score),
      heatLabel: null,
      url: `https://search.bilibili.com/all?keyword=${encodeURIComponent(phrase)}`,
      thumbnail: null,
      extra: null,
    }));
}

/**
 * 小红书's own "热点灵感" for creators — the list the app shows somebody about
 * to write a note. Closer to what this studio wants than a search chart:
 * these are subjects the platform is telling its creators to make things
 * about right now.
 */
export async function xiaohongshuHotInspiration(): Promise<HotRow[]> {
  const res = await get<{
    data?: { items?: { title?: string; score?: number; score_text?: string; cover?: string; type?: string }[] };
  }>("/api/v1/xiaohongshu/app_v2/get_creator_hot_inspiration_feed");
  return (res.data?.items ?? [])
    .filter((n) => typeof n.title === "string" && n.title.trim())
    .map((n) => ({
      phrase: n.title!.trim(),
      heat: asNumber(n.score),
      heatLabel: n.score_text ?? null,
      url: `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(n.title!.trim())}`,
      thumbnail: n.cover ?? null,
      extra: n.type ?? null,
    }));
}

/** TikTok's explore page: what the platform is pushing, with play counts. */
export async function tiktokExplore(count = 20): Promise<HotRow[]> {
  const res = await get<{
    itemList?: {
      id?: string;
      desc?: string;
      author?: { uniqueId?: string; nickname?: string };
      stats?: { playCount?: number };
      video?: { cover?: string; originCover?: string };
      challenges?: { title?: string }[];
    }[];
  }>("/api/v1/tiktok/web/fetch_explore_post", { categoryType: 120, count });
  return (res.itemList ?? [])
    .filter((v) => v.id && (v.desc || v.challenges?.length))
    .map((v) => {
      const tags = (v.challenges ?? []).map((c) => c.title).filter(Boolean).slice(0, 3);
      const handle = v.author?.uniqueId ?? null;
      return {
        phrase: (v.desc ?? "").trim() || tags.map((t) => `#${t}`).join(" "),
        heat: asNumber(v.stats?.playCount),
        heatLabel: null,
        url: handle && v.id ? `https://www.tiktok.com/@${handle}/video/${v.id}` : null,
        thumbnail: v.video?.cover ?? v.video?.originCover ?? null,
        extra: [handle ? `@${handle}` : null, ...tags.map((t) => `#${t}`)].filter(Boolean).join(" · ") || null,
      };
    });
}
