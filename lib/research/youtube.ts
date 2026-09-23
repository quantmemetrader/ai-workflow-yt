import "server-only";
import { env } from "@/lib/env";

/**
 * YouTube, speaking for itself.
 *
 * The studio watches other people's channels through TikHub, which reads
 * sixteen platforms and is the right tool for Douyin and Xiaohongshu. Its
 * YouTube discovery endpoints, though, answer with empty lists — `search_channels`
 * for "nvidia" returns `total_count: 0`, and `get_trending_videos` returns no
 * videos for any region. Verified against the live API, not assumed.
 *
 * So discovery comes from the platform's own Data API: `videos?chart=mostPopular`
 * for what a country is watching today, and `search` ordered by view count for
 * who is making videos about a subject. Both are what a person would look up
 * by hand, which is the test for whether this belongs in a product.
 *
 * **Quota is the constraint.** The free key allows 10,000 units a day. A
 * `search` costs 100 units; `videos.list` and `channels.list` cost 1 each. So
 * search results are cached for an hour and the two cheap calls are used to
 * enrich them, rather than searching again for every question.
 */
const BASE = "https://www.googleapis.com/youtube/v3";

export class YouTubeUnconfigured extends Error {
  constructor() {
    super("YOUTUBE_API_KEY is not set, so YouTube cannot be read here.");
    this.name = "YouTubeUnconfigured";
  }
}

export class YouTubeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Google's own reason: `quotaExceeded`, `keyInvalid`, … */
    readonly reason?: string,
  ) {
    super(message);
    this.name = "YouTubeError";
  }
}

async function get<T>(path: string, query: Record<string, string | number | undefined>): Promise<T> {
  if (!env.youtube.configured) throw new YouTubeUnconfigured();

  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  url.searchParams.set("key", env.youtube.apiKey);

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  } catch (err) {
    throw new YouTubeError(
      err instanceof Error ? err.message : "YouTube could not be reached",
      0,
    );
  }

  const body = (await res.json().catch(() => null)) as
    | { error?: { message?: string; errors?: { reason?: string }[] } }
    | null;

  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason;
    // Quota is the one failure worth naming in the interface: it is not a bug,
    // it resets at midnight Pacific, and the studio can do nothing about it
    // except wait or raise the quota.
    const message =
      reason === "quotaExceeded"
        ? "YouTube's daily quota for this key is used up. It resets at midnight Pacific."
        : (body?.error?.message ?? `YouTube answered ${res.status}`);
    throw new YouTubeError(message, res.status, reason);
  }

  return body as T;
}

/* ------------------------------------------------------------------ types */

export type YouTubeVideo = {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnail: string | null;
  views: number;
  likes: number;
  comments: number;
};

export type YouTubeChannel = {
  id: string;
  title: string;
  handle: string | null;
  thumbnail: string | null;
  subscribers: number;
  videoCount: number;
  views: number;
  country: string | null;
};

/* ------------------------------------------------------------- the calls */

type VideoListItem = {
  id: string | { videoId?: string };
  snippet?: {
    title?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
};

/*
 * One read per region per twenty minutes, for the whole server.
 *
 * The dashboard leads with this now, so it is read on every render of the
 * Research home. `mostPopular` costs a single unit, but ten people opening the
 * page is still ten requests for a chart that changes a few times a day.
 */
const TRENDING_TTL_MS = 20 * 60_000;
const trendingCache = new Map<string, { at: number; rows: YouTubeVideo[] }>();

/** What a country is watching today, in the platform's own order. */
export async function trendingVideos(regionCode = "HK", limit = 20): Promise<YouTubeVideo[]> {
  const region = regionCode.toUpperCase();
  const hit = trendingCache.get(region);
  if (hit && Date.now() - hit.at < TRENDING_TTL_MS) return hit.rows.slice(0, limit);

  try {
    const res = await get<{ items?: VideoListItem[] }>("videos", {
      part: "snippet,statistics",
      chart: "mostPopular",
      regionCode: region,
      maxResults: 50,
    });
    const rows = (res.items ?? []).map(toVideo);
    trendingCache.set(region, { at: Date.now(), rows });
    return rows.slice(0, limit);
  } catch (err) {
    // The last good list beats an empty strip; quota resets at midnight
    // Pacific and this page is opened all day.
    if (hit) return hit.rows.slice(0, limit);
    throw err;
  }
}

/**
 * The videos a phrase produced, most-watched first.
 *
 * `search` returns no statistics, so the ids it hands back are passed to
 * `videos.list` for view counts — 100 units plus 1, rather than 100 units for
 * a list of titles with no numbers on them.
 */
export async function searchVideos(
  query: string,
  opts: { days?: number; limit?: number; regionCode?: string } = {},
): Promise<YouTubeVideo[]> {
  const days = opts.days ?? 30;
  const publishedAfter = new Date(Date.now() - days * 86_400_000).toISOString();

  const found = await get<{ items?: VideoListItem[] }>("search", {
    part: "snippet",
    q: query,
    type: "video",
    order: "viewCount",
    publishedAfter,
    regionCode: opts.regionCode?.toUpperCase(),
    maxResults: Math.min(50, opts.limit ?? 25),
  });

  const ids = (found.items ?? [])
    .map((i) => (typeof i.id === "string" ? i.id : i.id?.videoId))
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];

  const full = await get<{ items?: VideoListItem[] }>("videos", {
    part: "snippet,statistics",
    id: ids.join(","),
    maxResults: 50,
  });
  return (full.items ?? []).map(toVideo).sort((a, b) => b.views - a.views);
}

/** Subscriber counts, pictures and handles for channels already identified. */
export async function channelsById(ids: string[]): Promise<YouTubeChannel[]> {
  const wanted = [...new Set(ids)].slice(0, 50);
  if (wanted.length === 0) return [];

  const res = await get<{
    items?: {
      id?: string;
      snippet?: {
        title?: string;
        country?: string;
        customUrl?: string;
        thumbnails?: Record<string, { url?: string }>;
      };
      statistics?: { subscriberCount?: string; videoCount?: string; viewCount?: string };
    }[];
  }>("channels", { part: "snippet,statistics", id: wanted.join(","), maxResults: 50 });

  return (res.items ?? []).map((c) => ({
    id: c.id ?? "",
    title: c.snippet?.title ?? "",
    handle: c.snippet?.customUrl ?? null,
    thumbnail: pickThumb(c.snippet?.thumbnails),
    subscribers: num(c.statistics?.subscriberCount),
    videoCount: num(c.statistics?.videoCount),
    views: num(c.statistics?.viewCount),
    country: c.snippet?.country ?? null,
  }));
}

/**
 * Who is making videos about this, ranked by what they got for it.
 *
 * One search, then one channel lookup: the whole question costs 102 units.
 * Channels are ranked by the views their videos in this search actually
 * earned, not by subscriber count — a million-subscriber channel whose video
 * on the subject did nothing is not who the studio is competing with here.
 */
export type BeatChannel = YouTubeChannel & {
  /** Views their videos in this search earned, and how many there were. */
  viewsHere: number;
  videosHere: number;
  topVideo: { id: string; title: string; views: number } | null;
};

export async function channelsForPhrase(
  phrase: string,
  opts: { days?: number; regionCode?: string } = {},
): Promise<BeatChannel[]> {
  const videos = await searchVideos(phrase, { days: opts.days ?? 30, limit: 50, regionCode: opts.regionCode });
  if (videos.length === 0) return [];

  const byChannel = new Map<string, YouTubeVideo[]>();
  for (const v of videos) {
    const list = byChannel.get(v.channelId);
    if (list) list.push(v);
    else byChannel.set(v.channelId, [v]);
  }

  const channels = await channelsById([...byChannel.keys()]);
  const info = new Map(channels.map((c) => [c.id, c]));

  return [...byChannel.entries()]
    .map(([channelId, own]) => {
      const meta = info.get(channelId);
      const top = own.reduce((best, v) => (v.views > best.views ? v : best), own[0]);
      return {
        id: channelId,
        title: meta?.title ?? own[0].channelTitle,
        handle: meta?.handle ?? null,
        thumbnail: meta?.thumbnail ?? null,
        subscribers: meta?.subscribers ?? 0,
        videoCount: meta?.videoCount ?? 0,
        views: meta?.views ?? 0,
        country: meta?.country ?? null,
        viewsHere: own.reduce((sum, v) => sum + v.views, 0),
        videosHere: own.length,
        topVideo: { id: top.id, title: top.title, views: top.views },
      };
    })
    .sort((a, b) => b.viewsHere - a.viewsHere);
}

/* ----------------------------------------------------------------- shapes */

function toVideo(item: VideoListItem): YouTubeVideo {
  return {
    id: typeof item.id === "string" ? item.id : (item.id?.videoId ?? ""),
    title: item.snippet?.title ?? "",
    channelId: item.snippet?.channelId ?? "",
    channelTitle: item.snippet?.channelTitle ?? "",
    publishedAt: item.snippet?.publishedAt ?? "",
    thumbnail: pickThumb(item.snippet?.thumbnails),
    views: num(item.statistics?.viewCount),
    likes: num(item.statistics?.likeCount),
    comments: num(item.statistics?.commentCount),
  };
}

/** The largest picture the response carried, which is still only 480 wide. */
function pickThumb(thumbs: Record<string, { url?: string }> | undefined): string | null {
  if (!thumbs) return null;
  for (const size of ["medium", "high", "standard", "default"]) {
    const url = thumbs[size]?.url;
    if (url) return url;
  }
  return null;
}

/** Counts arrive as strings, and a hidden count does not arrive at all. */
function num(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
