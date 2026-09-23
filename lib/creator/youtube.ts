import "server-only";
import { env } from "@/lib/env";

/**
 * Every upload on a YouTube channel, from the platform's own Data API.
 *
 * Three calls and all of them official: the channel's uploads playlist, the
 * playlist's items fifty at a time, and the videos those items name with their
 * statistics and length. The whole channel costs about one unit per fifty
 * videos, which is nothing against the 10,000 a day the key allows.
 *
 * Transcripts are deliberately not fetched here. The Data API can list a
 * video's caption tracks but downloading one needs the channel owner's OAuth
 * grant, which this product does not hold, and the unofficial `timedtext`
 * endpoint is exactly the kind of interface the contract (A3(1)) forbids.
 */
const BASE = "https://www.googleapis.com/youtube/v3";

export type ChannelUpload = {
  externalId: string;
  title: string;
  description: string;
  tags: string[];
  durationSec: number | null;
  views: number;
  likes: number;
  comments: number;
  thumbnailUrl: string | null;
  publishedAt: Date | null;
};

async function get<T>(path: string, query: Record<string, string | number | undefined>): Promise<T> {
  if (!env.youtube.configured) throw new Error("YOUTUBE_API_KEY is not set, so the channel cannot be read.");
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  url.searchParams.set("key", env.youtube.apiKey);

  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: { message?: string; errors?: { reason?: string }[] } })
    | null;
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason;
    throw new Error(
      reason === "quotaExceeded"
        ? "YouTube's daily quota for this key is used up. It resets at midnight Pacific."
        : (body?.error?.message ?? `YouTube answered ${res.status}`),
    );
  }
  return body as T;
}

/** ISO 8601 `PT1H2M3S` to seconds. */
export function isoDuration(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!m) return null;
  return (Number(m[1] ?? 0) * 86400) + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

const num = (v: string | undefined) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Every upload on the channel, newest first. */
export async function channelUploads(channelId: string, opts: { max?: number } = {}): Promise<ChannelUpload[]> {
  const max = opts.max ?? 500;

  const ch = await get<{ items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[] }>("channels", {
    part: "contentDetails",
    id: channelId,
  });
  const playlist = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlist) throw new Error("YouTube does not know that channel, or it has no uploads playlist.");

  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await get<{
      items?: { contentDetails?: { videoId?: string } }[];
      nextPageToken?: string;
    }>("playlistItems", { part: "contentDetails", playlistId: playlist, maxResults: 50, pageToken });
    for (const item of page.items ?? []) {
      const id = item.contentDetails?.videoId;
      if (id) ids.push(id);
    }
    pageToken = page.nextPageToken;
  } while (pageToken && ids.length < max);

  const out: ChannelUpload[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const res = await get<{
      items?: {
        id?: string;
        snippet?: {
          title?: string;
          description?: string;
          tags?: string[];
          publishedAt?: string;
          thumbnails?: Record<string, { url?: string }>;
        };
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
        contentDetails?: { duration?: string };
      }[];
    }>("videos", { part: "snippet,statistics,contentDetails", id: batch.join(","), maxResults: 50 });

    for (const v of res.items ?? []) {
      if (!v.id) continue;
      const thumbs = v.snippet?.thumbnails ?? {};
      out.push({
        externalId: v.id,
        title: v.snippet?.title ?? "",
        description: v.snippet?.description ?? "",
        tags: (v.snippet?.tags ?? []).slice(0, 40),
        durationSec: isoDuration(v.contentDetails?.duration),
        views: num(v.statistics?.viewCount),
        likes: num(v.statistics?.likeCount),
        comments: num(v.statistics?.commentCount),
        thumbnailUrl: thumbs.medium?.url ?? thumbs.high?.url ?? thumbs.default?.url ?? null,
        publishedAt: v.snippet?.publishedAt ? new Date(v.snippet.publishedAt) : null,
      });
    }
  }

  return out.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0));
}
