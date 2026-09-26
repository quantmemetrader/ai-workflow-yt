import "server-only";
import { env } from "@/lib/env";
import { tikhubRequest } from "@/lib/social/tikhub";
import type { Candidate, SearchOpts } from "@/lib/media/types";
import { asCount, cleanTitle, durationMsFrom, run, withTimeout, YT_DLP } from "@/lib/media/tools";

/**
 * YouTube search, free, through yt-dlp.
 *
 * `ytsearchN:` in flat mode is one request to YouTube's own search page:
 * under a second for ten results, with title, channel, length, views and
 * the permalink, and no key or quota spent. The Data API in
 * `lib/research/youtube.ts` costs a hundred of its ten thousand daily units
 * for the same answer, so it stays for exact statistics, not for this.
 *
 * deno is on the child's PATH (`tools.ts`) because YouTube's player asks
 * for a JavaScript challenge and yt-dlp without a runtime loses formats.
 * No bot check has been seen from this server; if "Sign in to confirm you
 * are not a bot" appears, the first thing to try is a cookie file.
 *
 * `licence: "cc"` asks TikHub's search instead, with YouTube's own
 * Creative Commons filter, for the times the editor wants footage it may
 * reuse outright rather than quote. One metered request.
 *
 * Fetching is yt-dlp with `--download-sections`, so a ten-second cutaway
 * from an hour-long keynote moves ten seconds of video.
 */
const TIMEOUT_MS = 9_000;

type FlatEntry = {
  id?: string;
  title?: string;
  description?: string;
  url?: string;
  webpage_url?: string;
  duration?: number | null;
  channel?: string;
  channel_id?: string;
  channel_url?: string;
  uploader?: string;
  uploader_url?: string;
  view_count?: number | null;
  live_status?: string | null;
  timestamp?: number | null;
};

function candidateFrom(e: { id: string; title: string; description?: string; channel: string; channelUrl?: string; channelId?: string; durationMs?: number; views?: number; publishedAt?: string; licence?: string }): Candidate {
  const url = `https://www.youtube.com/watch?v=${e.id}`;
  return {
    id: `youtube:${e.id}`,
    kind: "video",
    platform: "youtube",
    title: e.title,
    description: e.description,
    url,
    author: { name: e.channel, url: e.channelUrl, id: e.channelId },
    /* i.ytimg.com is stable and unsigned; the search's own thumbnail URLs are not always present in flat mode. */
    thumb: `https://i.ytimg.com/vi/${e.id}/hqdefault.jpg`,
    durationMs: e.durationMs,
    orientation: "landscape",
    stats: { views: e.views },
    publishedAt: e.publishedAt,
    handle: { via: "yt-dlp", url },
    licence: e.licence,
    credit: `YouTube · ${e.channel}`,
  };
}

async function viaYtDlp(keyword: string, opts: SearchOpts): Promise<Candidate[]> {
  /* Ask for a few more than wanted: live streams and over-long videos are dropped below. */
  const n = Math.min(15, Math.max(3, opts.limit * 2));
  const { stdout } = await run(YT_DLP, [`ytsearch${n}:${keyword}`, "--flat-playlist", "-j", "--no-warnings"], {
    timeoutMs: TIMEOUT_MS + 3_000,
    signal: opts.signal,
  });
  const out: Candidate[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let e: FlatEntry;
    try {
      e = JSON.parse(line) as FlatEntry;
    } catch {
      continue;
    }
    if (!e.id || !e.title) continue;
    if (e.live_status && e.live_status !== "not_live" && e.live_status !== "was_live") continue;
    const durationMs = durationMsFrom(e.duration ?? undefined);
    /* A live stream or a premiere has no length; a cutaway cannot be cut from it. */
    if (!durationMs) continue;
    if (opts.maxDurationS !== undefined && durationMs > opts.maxDurationS * 1000) continue;
    out.push(
      candidateFrom({
        id: e.id,
        title: cleanTitle(e.title),
        description: e.description ? cleanTitle(e.description) : undefined,
        channel: e.channel?.trim() || e.uploader?.trim() || "YouTube",
        channelUrl: e.uploader_url ?? e.channel_url,
        channelId: e.channel_id,
        durationMs,
        views: asCount(e.view_count),
        publishedAt: e.timestamp ? new Date(e.timestamp * 1000).toISOString() : undefined,
      }),
    );
    if (out.length >= opts.limit) break;
  }
  return out;
}

type TikHubVideo = {
  video_id?: string;
  title?: string;
  description_snippet?: string;
  duration?: string;
  view_count?: string;
  author?: string;
  channel_id?: string;
  published_time?: string;
};

async function viaTikHubCreativeCommons(keyword: string, opts: SearchOpts): Promise<Candidate[]> {
  if (!env.tikhub.configured) return [];
  const res = await tikhubRequest<{ videos?: TikHubVideo[] }>("/api/v1/youtube/web_v2/get_general_search_v2", {
    keyword,
    type: "video",
    sort_by: "relevance",
    features: "creative_commons",
    ...(opts.maxDurationS !== undefined && opts.maxDurationS <= 240 ? { duration: "short" } : {}),
  });
  const out: Candidate[] = [];
  for (const v of res.videos ?? []) {
    if (!v.video_id || !v.title) continue;
    const durationMs = durationMsFrom(v.duration);
    if (opts.maxDurationS !== undefined && durationMs && durationMs > opts.maxDurationS * 1000) continue;
    out.push(
      candidateFrom({
        id: v.video_id,
        title: cleanTitle(v.title),
        description: v.description_snippet ? cleanTitle(v.description_snippet) : undefined,
        channel: v.author?.trim() || "YouTube",
        channelUrl: v.channel_id ? `https://www.youtube.com/channel/${v.channel_id}` : undefined,
        channelId: v.channel_id,
        durationMs,
        views: asCount(v.view_count),
        /* YouTube's filter, not a licence read off the page: the video's own page states it. */
        licence: "CC BY (YouTube filter)",
      }),
    );
    if (out.length >= opts.limit) break;
  }
  return out;
}

export async function searchYouTube(query: string, opts: SearchOpts): Promise<Candidate[]> {
  if (opts.kind !== "video") return [];
  const keyword = query.trim();
  if (!keyword) return [];
  const search = opts.licence === "cc" ? viaTikHubCreativeCommons(keyword, opts) : viaYtDlp(keyword, opts);
  return withTimeout(search.catch(() => []), TIMEOUT_MS + 3_000, []);
}
