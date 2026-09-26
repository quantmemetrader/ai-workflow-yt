import "server-only";
import { env } from "@/lib/env";
import { tikhubRequest } from "@/lib/social/tikhub";
import { orientationOf, type Candidate, type SearchOpts } from "@/lib/media/types";
import { asCount, cleanTitle, isoFromEpoch, withTimeout } from "@/lib/media/tools";

/**
 * TikTok video search, through TikHub; the clip itself comes free.
 *
 * TikTok's web search gives this server nothing (an empty list, no error),
 * so the search is the one metered request. The download is not: yt-dlp
 * with browser impersonation pulls the post straight from the permalink,
 * and the `play_addr` in the search result (no watermark, about six hours
 * of life) is kept as the fallback for the posts yt-dlp cannot reach.
 *
 * Region US: TikTok is not in Hong Kong, and the studio's beat is global
 * tech. Relevance for a Chinese business subject is poor here — it is the
 * last of the short-form sources, not the first.
 */
const TIMEOUT_MS = 9_000;

type Aweme = {
  aweme_id?: string;
  desc?: string;
  create_time?: number;
  author?: { uid?: string; sec_uid?: string; unique_id?: string; nickname?: string };
  video?: {
    duration?: number;
    play_addr?: { url_list?: string[]; width?: number; height?: number };
    cover?: { url_list?: string[] };
    origin_cover?: { url_list?: string[] };
  };
  statistics?: { play_count?: number; digg_count?: number };
};

export async function searchTikTok(query: string, opts: SearchOpts): Promise<Candidate[]> {
  if (!env.tikhub.configured || opts.kind !== "video") return [];
  const keyword = query.trim();
  if (!keyword) return [];

  const res = await withTimeout(
    tikhubRequest<{ search_item_list?: { aweme_info?: Aweme }[] }>("/api/v1/tiktok/app/v3/fetch_video_search_result", {
      keyword,
      offset: 0,
      count: Math.min(20, Math.max(10, opts.limit * 2)),
      sort_type: 0,
      publish_time: 0,
      region: "US",
    }).catch(() => null),
    TIMEOUT_MS,
    null,
  );

  const max = opts.maxDurationS ?? 60;
  const out: Candidate[] = [];
  for (const row of res?.search_item_list ?? []) {
    const a = row.aweme_info;
    const handle = a?.author?.unique_id;
    if (!a?.aweme_id || !handle) continue;
    const durationMs = typeof a.video?.duration === "number" ? a.video.duration : undefined;
    if (durationMs && durationMs > max * 1000) continue;
    const thumb = a.video?.cover?.url_list?.[0] ?? a.video?.origin_cover?.url_list?.[0];
    if (!thumb) continue;
    const play = a.video?.play_addr?.url_list?.find((u) => typeof u === "string" && /^https?:/.test(u));
    const w = a.video?.play_addr?.width;
    const h = a.video?.play_addr?.height;
    const url = `https://www.tiktok.com/@${handle}/video/${a.aweme_id}`;
    out.push({
      id: `tiktok:${a.aweme_id}`,
      kind: "video",
      platform: "tiktok",
      title: cleanTitle(a.desc, `@${handle} 的视频`),
      url,
      author: { name: a.author?.nickname?.trim() || handle, url: `https://www.tiktok.com/@${handle}`, id: a.author?.sec_uid ?? a.author?.uid },
      thumb,
      durationMs,
      width: w,
      height: h,
      orientation: orientationOf(w, h) ?? "portrait",
      stats: { views: asCount(a.statistics?.play_count), likes: asCount(a.statistics?.digg_count) },
      publishedAt: isoFromEpoch(a.create_time),
      handle: { via: "yt-dlp", url, fallbackUrl: play },
      credit: `TikTok @${handle}`,
    });
    if (out.length >= opts.limit) break;
  }
  return out;
}
