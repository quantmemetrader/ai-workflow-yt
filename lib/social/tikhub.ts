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

async function get<T>(path: string, query: Query = {}, body?: unknown): Promise<T> {
  if (!env.tikhub.configured) throw new TikHubUnconfigured();

  const url = new URL(env.tikhub.baseUrl + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${env.tikhub.token}`, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
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

/**
 * The raw call, for the media library (`lib/media/sources`).
 *
 * The readers below collapse every platform to `HotRow` for research, and
 * drop the things a clip fetch needs — play addresses, lengths, author ids.
 * The media sources read the full payload themselves through this; same
 * token, same timeout, same billing, and still nothing but reads.
 */
export const tikhubRequest = get;

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
      word_list?: {
        word?: string;
        hot_value?: number;
        view_count?: number;
        discuss_video_count?: number;
        /** The platform's own cover for the phrase, on its signed picture CDN. */
        word_cover?: { url_list?: string[] } | null;
      }[];
    };
  }>("/api/v1/douyin/app/v3/fetch_hot_search_list");
  return (res.data?.word_list ?? [])
    .filter((w) => typeof w.word === "string" && w.word.trim())
    .map((w) => ({
      phrase: w.word!.trim(),
      heat: asNumber(w.hot_value) ?? asNumber(w.view_count),
      heatLabel: null,
      url: `https://www.douyin.com/search/${encodeURIComponent(w.word!.trim())}`,
      thumbnail: w.word_cover?.url_list?.find((u) => typeof u === "string" && u.startsWith("http")) ?? null,
      /* Almost every row says "1 条视频在讨论", which tells nobody anything;
         the count is shown only when it is a count. */
      extra: w.discuss_video_count && w.discuss_video_count > 1 ? `${w.discuss_video_count} 条视频在讨论` : null,
    }));
}

/**
 * 微博热搜. The payload is the app's own page layout — groups of cells — so
 * the rows are wherever a cell carries a `desc`. `desc_extr` is the search
 * index the app prints beside each entry.
 *
 * The layout's own links carry a `desc` too ("查看更多实时上升热点",
 * "更多", "开启定位，实时获取本地看点"); they are buttons, not topics.
 */
const WEIBO_CHROME = /^(查看更多|更多$|开启定位)/;

/**
 * `category` is one of the app's own hot-list tabs (TikHub's documentation
 * of `fetch_hot_search`): realtimehot is the main list, technologynav the 科技
 * list the beat feed reads — fifty tech topics with their search index, which
 * is what "微博 on the studio's beat" is, where the main list is celebrities.
 * One request either way.
 */
export async function weiboHotSearch(category?: "realtimehot" | "technologynav", count?: number): Promise<HotRow[]> {
  const res = await get<{
    items?: { items?: { data?: { desc?: string; desc_extr?: string; scheme?: string } }[] }[];
  }>("/api/v1/weibo/app/fetch_hot_search", category ? { category, page: 1, count: count ?? 50 } : {});
  const rows: HotRow[] = [];
  for (const group of res.items ?? []) {
    for (const cell of group.items ?? []) {
      const d = cell.data;
      if (!d?.desc || typeof d.desc !== "string") continue;
      const phrase = d.desc.replace(/^#|#$/g, "").trim();
      if (!phrase || WEIBO_CHROME.test(phrase) || rows.some((r) => r.phrase === phrase)) continue;
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

/**
 * TikTok's explore page: what the platform is pushing, with play counts.
 *
 * `categoryType` is TikTok's own explore category (TikHub's documentation
 * of `fetch_explore_post`): 120 is everything, 118 Technology, 116
 * Education, 114 Society. There is no finance category. One request
 * whichever is asked for.
 */
export async function tiktokExplore(count = 20, categoryType = 120): Promise<HotRow[]> {
  const res = await get<{
    itemList?: {
      id?: string;
      desc?: string;
      author?: { uniqueId?: string; nickname?: string };
      stats?: { playCount?: number; diggCount?: number; commentCount?: number; shareCount?: number };
      createTime?: number;
      video?: { cover?: string; originCover?: string };
      challenges?: { title?: string }[];
    }[];
  }>("/api/v1/tiktok/web/fetch_explore_post", { categoryType, count });
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
        stats: {
          views: asNumber(v.stats?.playCount),
          likes: asNumber(v.stats?.diggCount),
          comments: asNumber(v.stats?.commentCount),
          shares: asNumber(v.stats?.shareCount),
          likeRate: rate(asNumber(v.stats?.diggCount), asNumber(v.stats?.playCount)),
          publishedAt: v.createTime ? new Date(v.createTime * 1000).toISOString() : null,
        },
      };
    });
}

const rate = (a: number | null, b: number | null) => (a !== null && b ? a / b : null);

// ------------------------------------------------------------ 抖音 billboards

/**
 * 抖音's creator billboards (热点宝): ranked videos with their real numbers.
 *
 * Unlike the hot-search list, which is phrases, these are videos: plays,
 * likes, like rate, the account's follower count and when it went up. They
 * can be filtered to a vertical, so the studio sees 财经 and 科技 rather than
 * whatever dance is top today.
 */
export const DOUYIN_VERTICALS = {
  /** 财经: 金融, 宏观经济, 创业商业, 房产, 保险. */
  finance: { value: 616, children: [{ value: 61601 }, { value: 61605 }, { value: 61604 }, { value: 61603 }, { value: 61602 }] },
  /** 科技: 前沿科技, 科技产品, 数码产品, 大众科技, 科技科普. */
  tech: { value: 615, children: [{ value: 61506 }, { value: 61501 }, { value: 61507 }, { value: 61509 }, { value: 61502 }] },
} as const;

type BillboardVideo = {
  item_id?: string;
  item_title?: string;
  item_cover_url?: string;
  nick_name?: string;
  fans_cnt?: number;
  play_cnt?: number;
  like_cnt?: number;
  like_rate?: number;
  publish_time?: number;
};

function billboardRow(v: BillboardVideo): HotRow {
  const title = (v.item_title ?? "").replace(/\s*#\S+/g, "").trim();
  return {
    phrase: title || (v.nick_name ? `${v.nick_name} 的视频` : "（无标题视频）"),
    heat: asNumber(v.play_cnt),
    heatLabel: null,
    url: v.item_id ? `https://www.douyin.com/video/${v.item_id}` : null,
    thumbnail: v.item_cover_url ?? null,
    extra: v.nick_name ?? null,
    stats: {
      views: asNumber(v.play_cnt),
      likes: asNumber(v.like_cnt),
      likeRate: rate(asNumber(v.like_cnt), asNumber(v.play_cnt)) ?? (typeof v.like_rate === "number" && v.like_rate > 0 ? v.like_rate : null),
      fans: asNumber(v.fans_cnt),
      publishedAt: v.publish_time ? new Date(v.publish_time * 1000).toISOString() : null,
    },
  };
}

/** Hot videos in the given verticals. `subType` 1001 is the whole list. */
export async function douyinBillboardVideos(
  verticals: (keyof typeof DOUYIN_VERTICALS)[],
  opts: { hours?: 1 | 24 | 72 | 168; subType?: 1001 | 1002 | 1005; size?: number } = {},
): Promise<HotRow[]> {
  const res = await get<{ data?: { objs?: BillboardVideo[] } }>(
    "/api/v1/douyin/billboard/fetch_hot_total_video_list",
    {},
    {
      page: 1,
      page_size: opts.size ?? 30,
      date_window: opts.hours ?? 24,
      sub_type: opts.subType ?? 1001,
      keyword: "",
      tags: verticals.map((k) => DOUYIN_VERTICALS[k]),
    },
  );
  return (res.data?.objs ?? []).filter((v) => v.item_id).map(billboardRow);
}

/**
 * Videos from small accounts that travelled far past their own audience.
 *
 * One request per vertical: given 财经 and 科技 together the billboard drops
 * the filter and returns everything, dance clips included. Merged and
 * ordered by how many times its own followers each video was watched.
 */
export async function douyinBreakouts(verticals: (keyof typeof DOUYIN_VERTICALS)[], hours: 24 | 72 | 168 = 168, size = 20): Promise<HotRow[]> {
  const lists = await Promise.all(
    verticals.map((k) =>
      get<{ data?: { objs?: BillboardVideo[] } }>(
        "/api/v1/douyin/billboard/fetch_hot_total_low_fan_list",
        {},
        { page: 1, page_size: size, date_window: hours, keyword: "", tags: [DOUYIN_VERTICALS[k]] },
      ),
    ),
  );
  const seen = new Set<string>();
  const rows: HotRow[] = [];
  for (const [i, res] of lists.entries()) {
    for (const v of res.data?.objs ?? []) {
      if (!v.item_id || seen.has(v.item_id)) continue;
      seen.add(v.item_id);
      const row = billboardRow(v);
      row.extra = [v.nick_name, verticals[i] === "finance" ? "财经" : "科技"].filter(Boolean).join(" · ");
      rows.push(row);
    }
  }
  const ratio = (r: HotRow) => (r.stats?.views && r.stats?.fans ? r.stats.views / r.stats.fans : 0);
  return rows.sort((a, b) => ratio(b) - ratio(a));
}

/** Topics climbing fastest on 抖音 right now, with their hourly heat. */
export async function douyinRising(size = 30): Promise<HotRow[]> {
  const res = await get<{ data?: {
    objs?: {
      sentence?: string;
      hot_score?: number;
      rank_diff?: number;
      video_count?: number;
      create_at?: number;
      sentence_tag_name?: string;
      first_item_cover_url?: string;
    }[];
  } }>("/api/v1/douyin/billboard/fetch_hot_rise_list", { page: 1, page_size: size, order: "rank_diff", sentence_tag: "", keyword: "" });
  return (res.data?.objs ?? [])
    .filter((o) => o.sentence)
    .map((o) => ({
      phrase: o.sentence!.trim(),
      heat: asNumber(o.hot_score),
      heatLabel: null,
      url: `https://www.douyin.com/search/${encodeURIComponent(o.sentence!.trim())}`,
      thumbnail: o.first_item_cover_url || null,
      extra: o.sentence_tag_name ?? null,
      stats: {
        videos: asNumber(o.video_count),
        rankUp: asNumber(o.rank_diff),
        publishedAt: o.create_at ? new Date(o.create_at * 1000).toISOString() : null,
      },
    }));
}

// ------------------------------------------------------------ beat searches

/*
 * The searches the beat feeds make (`lib/research/beat-feeds.ts`): a word of
 * one of the studio's beats, on one platform, the posts that did best
 * recently, each with its own numbers. One request each, billed; the feeds
 * count them against a per-run cap before calling.
 *
 * Endpoints and parameters are from TikHub's own documentation
 * (api.tikhub.io/openapi.json), and each was tried once against the live API
 * before being used here (09-26): what came back is noted on each.
 */

const ago = (sec: unknown) => {
  const n = typeof sec === "number" ? sec : typeof sec === "string" ? Number(sec) : NaN;
  // Seconds or milliseconds, whichever the platform sent.
  return Number.isFinite(n) && n > 0 ? new Date(n > 1e12 ? n : n * 1000).toISOString() : null;
};
const stripTags = (t: string) => t.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim();

/**
 * 抖音's creator billboard, filtered to titles with the keyword: up to 30
 * videos ranked by heat over the window, with plays, likes, the account's
 * followers. Richer than 抖音's own search, which returns eight videos and
 * no play counts. "大模型" over 72 hours came back with 27 videos, nearly
 * all on the subject; a loose word ("AI") came back with AI-drawn cats,
 * which is why the beat words are specific.
 */
export async function douyinBillboardSearch(keyword: string, opts: { hours?: 24 | 72 | 168; size?: number } = {}): Promise<HotRow[]> {
  const res = await get<{ data?: { objs?: BillboardVideo[] } }>(
    "/api/v1/douyin/billboard/fetch_hot_total_video_list",
    {},
    { page: 1, page_size: opts.size ?? 30, date_window: opts.hours ?? 72, sub_type: 1001, keyword, tags: [] },
  );
  return (res.data?.objs ?? []).filter((v) => v.item_id).map(billboardRow);
}

type DouyinAweme = {
  aweme_id?: string;
  desc?: string;
  create_time?: number;
  author?: { nickname?: string; follower_count?: number };
  statistics?: { play_count?: number; digg_count?: number; comment_count?: number; share_count?: number; collect_count?: number };
  video?: { cover?: { url_list?: string[] } };
};

/**
 * 抖音's own video search, most liked within `days` (1 or 7). Eight videos a
 * page, matched by what they are about rather than by title; 抖音 does not
 * return play counts here (always 0), so likes, comments, shares and saves
 * are the numbers. The beat feed's fallback when the billboard search has
 * little for a word.
 */
export async function douyinVideoSearch(keyword: string, opts: { days?: 1 | 7 } = {}): Promise<HotRow[]> {
  const res = await get<{ data?: { aweme_info?: DouyinAweme }[] }>(
    "/api/v1/douyin/search/fetch_video_search_v1",
    {},
    { keyword, cursor: 0, sort_type: "1", publish_time: String(opts.days ?? 7), filter_duration: "0", content_type: "0", search_id: "", backtrace: "" },
  );
  return (res.data ?? [])
    .map((x) => x.aweme_info)
    .filter((a): a is DouyinAweme => Boolean(a?.aweme_id && (a.desc ?? "").trim()))
    .map((a) => {
      const s = a.statistics ?? {};
      return {
        phrase: (a.desc ?? "").replace(/\s*#\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 200) || `${a.author?.nickname ?? ""} 的视频`,
        heat: asNumber(s.digg_count),
        heatLabel: null,
        url: `https://www.douyin.com/video/${a.aweme_id}`,
        thumbnail: a.video?.cover?.url_list?.[0] ?? null,
        extra: a.author?.nickname ?? null,
        stats: {
          likes: asNumber(s.digg_count),
          comments: asNumber(s.comment_count),
          shares: asNumber(s.share_count),
          saves: asNumber(s.collect_count),
          fans: asNumber(a.author?.follower_count),
          publishedAt: ago(a.create_time),
        },
      };
    });
}

type TikTokAweme = {
  aweme_id?: string;
  desc?: string;
  create_time?: number;
  author?: { unique_id?: string; nickname?: string; follower_count?: number };
  statistics?: { play_count?: number; digg_count?: number; comment_count?: number; share_count?: number; collect_count?: number };
  video?: { cover?: { url_list?: string[] }; origin_cover?: { url_list?: string[] } };
};

/**
 * TikTok's video search, most liked first, within `days` (1, 7, 30). Thirty
 * videos with plays, likes, comments, shares and the account's followers.
 * Region is the market searched; TikTok is not in Hong Kong, so the US.
 */
export async function tiktokVideoSearch(keyword: string, opts: { days?: 1 | 7 | 30; count?: number; region?: string } = {}): Promise<HotRow[]> {
  const res = await get<{ search_item_list?: { aweme_info?: TikTokAweme }[] }>("/api/v1/tiktok/app/v3/fetch_video_search_result", {
    keyword,
    offset: 0,
    count: opts.count ?? 30,
    sort_type: 1,
    publish_time: opts.days ?? 7,
    region: opts.region ?? "US",
  });
  return (res.search_item_list ?? [])
    .map((x) => x.aweme_info)
    .filter((a): a is TikTokAweme => Boolean(a?.aweme_id && (a.desc ?? "").trim()))
    .map((a) => {
      const s = a.statistics ?? {};
      const handle = a.author?.unique_id ?? null;
      const views = asNumber(s.play_count);
      const likes = asNumber(s.digg_count);
      return {
        phrase: (a.desc ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
        heat: views,
        heatLabel: null,
        url: handle ? `https://www.tiktok.com/@${handle}/video/${a.aweme_id}` : null,
        thumbnail: a.video?.cover?.url_list?.[0] ?? a.video?.origin_cover?.url_list?.[0] ?? null,
        extra: handle ? `@${handle}` : (a.author?.nickname ?? null),
        stats: {
          views,
          likes,
          comments: asNumber(s.comment_count),
          shares: asNumber(s.share_count),
          saves: asNumber(s.collect_count),
          likeRate: rate(likes, views),
          fans: asNumber(a.author?.follower_count),
          publishedAt: ago(a.create_time),
        },
      };
    });
}

type XhsNote = {
  id?: string;
  title?: string;
  desc?: string;
  type?: string;
  liked_count?: unknown;
  collected_count?: unknown;
  comments_count?: unknown;
  shared_count?: unknown;
  images_list?: { url?: string }[];
  user?: { nickname?: string };
  timestamp?: unknown;
};

/**
 * 小红书 note search: 20 notes, with likes, saves, comments and shares (no
 * view counts; 小红书 does not publish them). `sort` "popularity_descending"
 * is most liked; `time` "一周内" is meant to keep it to the last week, but
 * a few older notes still come back, so the feed checks the date itself.
 * The defaults are what "Search & compare" has always asked for.
 */
export async function xiaohongshuSearchNotes(
  keyword: string,
  opts: { sort?: "general" | "popularity_descending" | "time_descending"; time?: "不限" | "一天内" | "一周内" | "半年内" } = {},
): Promise<HotRow[]> {
  const res = await get<{ data?: { items?: { note?: XhsNote }[] } }>("/api/v1/xiaohongshu/app_v2/search_notes", {
    keyword,
    page: 1,
    sort_type: opts.sort ?? "popularity_descending",
    time_filter: opts.time,
  });
  return (res.data?.items ?? [])
    .map((i) => i.note)
    .filter((x): x is XhsNote => Boolean(x?.id && (x.title || x.desc)))
    .map((x) => {
      const likes = asNumber(x.liked_count);
      return {
        phrase: (x.title || (x.desc ?? "").split(/\n/)[0] || "").replace(/\s+/g, " ").trim().slice(0, 120),
        heat: likes,
        heatLabel: null,
        url: `https://www.xiaohongshu.com/explore/${x.id}`,
        thumbnail: x.images_list?.[0]?.url ?? null,
        extra: x.user?.nickname ?? null,
        stats: {
          likes,
          comments: asNumber(x.comments_count),
          shares: asNumber(x.shared_count),
          saves: asNumber(x.collected_count),
          publishedAt: ago(x.timestamp),
        },
      };
    });
}

type BiliResult = { title?: string; play?: unknown; like?: unknown; review?: unknown; favorites?: unknown; danmaku?: unknown; pic?: string; author?: string; bvid?: string; pubdate?: unknown; typename?: string };

/**
 * B站 search. `order` "click" is most played; `sinceHours` keeps it to videos
 * published within that many hours (B站's own pubtime filter). About forty
 * videos a request with plays, likes, comments and saves. The row's second
 * line carries B站's own section name ("计算机技术", "单机游戏"), which the
 * classifier reads: an AI-made short drama is filed under 影视, not 科技.
 * The defaults are what "Search & compare" has always asked for.
 */
export async function bilibiliSearchVideos(keyword: string, opts: { order?: "totalrank" | "click" | "pubdate"; sinceHours?: number; size?: number } = {}): Promise<HotRow[]> {
  const now = Math.floor(Date.now() / 1000);
  const res = await get<{ data?: { result?: BiliResult[] } }>("/api/v1/bilibili/web/fetch_general_search", {
    keyword,
    order: opts.order ?? "totalrank",
    page: 1,
    page_size: opts.size ?? 12,
    pubtime_begin_s: opts.sinceHours ? now - Math.round(opts.sinceHours * 3600) : undefined,
    pubtime_end_s: opts.sinceHours ? now : undefined,
  });
  const list = Array.isArray(res.data?.result) ? res.data!.result! : [];
  return list
    .filter((r) => r && r.title)
    .map((r) => {
      const views = asNumber(r.play);
      const likes = asNumber(r.like);
      const author = r.author ?? null;
      return {
        phrase: stripTags(r.title!),
        heat: views,
        heatLabel: null,
        url: r.bvid ? `https://www.bilibili.com/video/${r.bvid}` : null,
        thumbnail: r.pic ? (r.pic.startsWith("//") ? `https:${r.pic}` : r.pic) : null,
        extra: [author, r.typename].filter(Boolean).join(" · ") || null,
        stats: { views, likes, comments: asNumber(r.review), saves: asNumber(r.favorites), likeRate: rate(likes, views), publishedAt: ago(r.pubdate) },
      };
    });
}

type WeiboPost = {
  mblogid?: string;
  id?: string | number;
  text?: string;
  text_raw?: string;
  created_at?: string;
  attitudes_count?: unknown;
  comments_count?: unknown;
  reposts_count?: unknown;
  pic_ids?: string[];
  page_info?: { page_pic?: { url?: string } };
  user?: { id?: string | number; screen_name?: string; followers_count?: unknown };
};

/**
 * 微博's search, "热门" tab (`search_type` 60): ten posts that did best for
 * the keyword, with likes, comments, reposts and the account's followers.
 * Not strictly recent (a July post can still rank for 人工智能), so the feed
 * checks the date.
 */
export async function weiboHotPosts(keyword: string): Promise<HotRow[]> {
  const res = await get<{ items?: { category?: string; data?: WeiboPost }[] }>("/api/v1/weibo/app/fetch_search_all", { query: keyword, page: 1, search_type: 60 });
  const rows: HotRow[] = [];
  for (const it of res.items ?? []) {
    const d = it.data;
    if (!d || d.attitudes_count === undefined || !(d.text || d.text_raw)) continue;
    const text = stripTags(d.text_raw ?? d.text ?? "").replace(/\s+/g, " ").replace(/\s*展开c?$/, "").trim();
    if (text.length < 6) continue;
    const likes = asNumber(d.attitudes_count);
    const at = d.created_at ? new Date(d.created_at) : null;
    rows.push({
      phrase: text.slice(0, 140),
      heat: likes,
      heatLabel: null,
      url: d.user?.id && d.mblogid ? `https://weibo.com/${d.user.id}/${d.mblogid}` : null,
      thumbnail: d.page_info?.page_pic?.url ?? (d.pic_ids?.[0] ? `https://wx1.sinaimg.cn/orj360/${d.pic_ids[0]}.jpg` : null),
      extra: d.user?.screen_name ?? null,
      stats: {
        likes,
        comments: asNumber(d.comments_count),
        shares: asNumber(d.reposts_count),
        fans: asNumber(d.user?.followers_count),
        publishedAt: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
      },
    });
  }
  return rows;
}
