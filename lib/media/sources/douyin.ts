import "server-only";
import { env } from "@/lib/env";
import { tikhubRequest } from "@/lib/social/tikhub";
import { orientationOf, type Candidate, type SearchOpts } from "@/lib/media/types";
import { asCount, cleanTitle, isoFromEpoch, withTimeout } from "@/lib/media/tools";

/**
 * 抖音 video search, through TikHub.
 *
 * There is no free path: douyin.com serves this server's datacenter IP a JS
 * challenge and its search API answers "blocked", so the one metered request
 * per query is the price of the best Chinese short-form source there is.
 *
 * `fetch_video_search_v1` with the 综合 sort and 抖音's own "under a minute"
 * filter, which is the length the editor wants anyway. Each result carries
 * `play_addr.url_list`: a plain MP4 on 抖音's CDN with **no watermark**
 * (the `download_addr` beside it is the watermarked one, and
 * `has_watermark: true` on every item refers to that). The address expires
 * about an hour after the search, so a candidate from here should be fetched
 * soon after it is chosen, not kept for the next session.
 */
const TIMEOUT_MS = 9_000;

type Aweme = {
  aweme_id?: string;
  desc?: string;
  create_time?: number;
  author?: { uid?: string; sec_uid?: string; unique_id?: string; nickname?: string };
  video?: {
    duration?: number;
    width?: number;
    height?: number;
    play_addr?: { url_list?: string[] };
    cover?: { url_list?: string[] };
    origin_cover?: { url_list?: string[] };
  };
  statistics?: { digg_count?: number; play_count?: number };
};

export async function searchDouyin(query: string, opts: SearchOpts): Promise<Candidate[]> {
  if (!env.tikhub.configured || opts.kind !== "video") return [];
  const keyword = query.trim();
  if (!keyword) return [];

  const max = opts.maxDurationS ?? 60;
  const res = await withTimeout(
    tikhubRequest<{ data?: { aweme_info?: Aweme }[] }>(
      "/api/v1/douyin/search/fetch_video_search_v1",
      {},
      {
        keyword,
        cursor: 0,
        sort_type: "0",
        publish_time: "0",
        /* 抖音's own buckets: under a minute, one to five, over five. */
        filter_duration: max <= 60 ? "0-1" : max <= 300 ? "1-5" : "0",
        content_type: "1",
        search_id: "",
        backtrace: "",
      },
    ).catch(() => null),
    TIMEOUT_MS,
    null,
  );

  const out: Candidate[] = [];
  for (const row of res?.data ?? []) {
    const a = row.aweme_info;
    const play = a?.video?.play_addr?.url_list?.find((u) => typeof u === "string" && /^https?:/.test(u));
    if (!a?.aweme_id || !play) continue;
    const durationMs = typeof a.video?.duration === "number" ? a.video.duration : undefined;
    if (durationMs && durationMs > max * 1000) continue;
    const name = a.author?.nickname?.trim() || (a.author?.unique_id ? `@${a.author.unique_id}` : "抖音用户");
    const thumb = a.video?.cover?.url_list?.[0] ?? a.video?.origin_cover?.url_list?.[0];
    if (!thumb) continue;
    out.push({
      id: `douyin:${a.aweme_id}`,
      kind: "video",
      platform: "douyin",
      title: cleanTitle(a.desc, `${name} 的视频`),
      url: `https://www.douyin.com/video/${a.aweme_id}`,
      author: { name, url: a.author?.sec_uid ? `https://www.douyin.com/user/${a.author.sec_uid}` : undefined, id: a.author?.sec_uid ?? a.author?.uid },
      thumb,
      durationMs,
      width: a.video?.width,
      height: a.video?.height,
      orientation: orientationOf(a.video?.width, a.video?.height),
      stats: { likes: asCount(a.statistics?.digg_count) },
      publishedAt: isoFromEpoch(a.create_time),
      handle: { via: "direct", url: play, expiresAt: new Date(Date.now() + 55 * 60_000).toISOString() },
      credit: `抖音 @${name}`,
    });
    if (out.length >= opts.limit) break;
  }
  return out;
}
