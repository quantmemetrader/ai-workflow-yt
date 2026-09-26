import "server-only";
import { orientationOf, type Candidate, type SearchOpts } from "@/lib/media/types";
import { asCount, cleanTitle, durationMsFrom, fetchJson, isoFromEpoch, run, withTimeout, BROWSER_UA, YT_DLP } from "@/lib/media/tools";

/**
 * B站 search, free, two ways.
 *
 * First B站's own web search API. It refuses a client with no browser
 * fingerprint (412), but hands one out on request at `finger/spi`, and with
 * that cookie a search answers in a quarter of a second with twenty videos:
 * title, uploader, length, plays, cover. No login, no key.
 *
 * If that ever closes, yt-dlp's `bilisearchN:` still works — its flat mode
 * hits the same 412, so it has to take each video's page, which is about
 * two seconds a result. Kept as the fallback with a small N.
 *
 * Fetching is yt-dlp on the permalink: 720p H.264 is served without a
 * login, DASH video and audio merged by the tool, and `--download-sections`
 * takes just the window the editor wants from a long explainer.
 */
const TIMEOUT_MS = 9_000;

let fingerprint: { cookie: string; at: number } | null = null;

async function cookie(): Promise<string | null> {
  if (fingerprint && Date.now() - fingerprint.at < 6 * 3600_000) return fingerprint.cookie;
  const spi = await fetchJson<{ data?: { b_3?: string; b_4?: string } }>("https://api.bilibili.com/x/frontend/finger/spi", {
    headers: { "user-agent": BROWSER_UA },
    timeoutMs: 5_000,
  });
  if (!spi?.data?.b_3) return null;
  fingerprint = { cookie: `buvid3=${spi.data.b_3}; buvid4=${spi.data.b_4 ?? ""}`, at: Date.now() };
  return fingerprint.cookie;
}

type WebResult = {
  bvid?: string;
  title?: string;
  description?: string;
  author?: string;
  mid?: number | string;
  pic?: string;
  duration?: string;
  play?: unknown;
  like?: unknown;
  pubdate?: unknown;
  arcurl?: string;
};

async function viaWebApi(keyword: string, opts: SearchOpts): Promise<Candidate[] | null> {
  const c = await cookie();
  if (!c) return null;
  const url = new URL("https://api.bilibili.com/x/web-interface/search/type");
  url.searchParams.set("search_type", "video");
  url.searchParams.set("keyword", keyword.slice(0, 100));
  url.searchParams.set("page", "1");
  url.searchParams.set("page_size", String(Math.min(30, Math.max(10, opts.limit * 3))));
  /* B站's buckets: 1 under ten minutes, 2 ten to thirty, 3 thirty to sixty. */
  const max = opts.maxDurationS;
  if (max !== undefined) url.searchParams.set("duration", max <= 600 ? "1" : max <= 1800 ? "2" : "3");
  const body = await fetchJson<{ code?: number; data?: { result?: WebResult[] } }>(url.toString(), {
    headers: { "user-agent": BROWSER_UA, cookie: c, referer: "https://www.bilibili.com/" },
    timeoutMs: 7_000,
  });
  if (!body || body.code !== 0) return null;

  const out: Candidate[] = [];
  for (const r of body.data?.result ?? []) {
    if (!r.bvid || !r.title) continue;
    /* Paid courses come back beside videos and cannot be fetched. */
    if (r.arcurl && /\/cheese\//.test(r.arcurl)) continue;
    const durationMs = durationMsFrom(r.duration);
    if (max !== undefined && durationMs && durationMs > max * 1000) continue;
    const pic = r.pic ? (r.pic.startsWith("//") ? `https:${r.pic}` : r.pic.replace(/^http:/, "https:")) : null;
    if (!pic) continue;
    const name = r.author?.trim() || "B站UP主";
    const permalink = `https://www.bilibili.com/video/${r.bvid}`;
    out.push({
      id: `bilibili:${r.bvid}`,
      kind: "video",
      platform: "bilibili",
      title: cleanTitle(r.title),
      description: r.description ? cleanTitle(r.description) : undefined,
      url: permalink,
      author: { name, url: r.mid ? `https://space.bilibili.com/${r.mid}` : undefined, id: r.mid ? String(r.mid) : undefined },
      thumb: pic,
      durationMs,
      /* The search does not say; B站 uploads are landscape almost without exception. */
      orientation: "landscape",
      stats: { views: asCount(r.play), likes: asCount(r.like) },
      publishedAt: isoFromEpoch(r.pubdate),
      handle: { via: "yt-dlp", url: permalink },
      credit: `B站 @${name}`,
    });
    if (out.length >= opts.limit) break;
  }
  return out;
}

type YtEntry = {
  id?: string;
  title?: string;
  description?: string;
  webpage_url?: string;
  uploader?: string;
  uploader_id?: string;
  duration?: number;
  thumbnail?: string;
  view_count?: number;
  like_count?: number;
  timestamp?: number;
  width?: number;
  height?: number;
};

async function viaYtDlp(keyword: string, opts: SearchOpts): Promise<Candidate[]> {
  const n = Math.min(4, Math.max(1, opts.limit));
  const { stdout } = await run(YT_DLP, [`bilisearch${n}:${keyword}`, "-j", "--no-warnings", "--no-playlist"], {
    timeoutMs: TIMEOUT_MS + 6_000,
    signal: opts.signal,
  });
  const out: Candidate[] = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let e: YtEntry;
    try {
      e = JSON.parse(line) as YtEntry;
    } catch {
      continue;
    }
    if (!e.id || !e.title || !e.thumbnail) continue;
    const durationMs = durationMsFrom(e.duration);
    if (opts.maxDurationS !== undefined && durationMs && durationMs > opts.maxDurationS * 1000) continue;
    const name = e.uploader?.trim() || "B站UP主";
    const permalink = `https://www.bilibili.com/video/${e.id}`;
    out.push({
      id: `bilibili:${e.id}`,
      kind: "video",
      platform: "bilibili",
      title: cleanTitle(e.title),
      description: e.description ? cleanTitle(e.description) : undefined,
      url: permalink,
      author: { name, url: e.uploader_id ? `https://space.bilibili.com/${e.uploader_id}` : undefined, id: e.uploader_id },
      thumb: e.thumbnail.replace(/^http:/, "https:"),
      durationMs,
      width: e.width,
      height: e.height,
      orientation: orientationOf(e.width, e.height) ?? "landscape",
      stats: { views: asCount(e.view_count), likes: asCount(e.like_count) },
      publishedAt: isoFromEpoch(e.timestamp),
      handle: { via: "yt-dlp", url: permalink },
      credit: `B站 @${name}`,
    });
  }
  return out.slice(0, opts.limit);
}

export async function searchBilibili(query: string, opts: SearchOpts): Promise<Candidate[]> {
  if (opts.kind !== "video") return [];
  const keyword = query.trim();
  if (!keyword) return [];
  const first = await withTimeout(viaWebApi(keyword, opts).catch(() => null), TIMEOUT_MS, null);
  if (first) return first;
  return withTimeout(viaYtDlp(keyword, opts).catch(() => []), TIMEOUT_MS + 6_000, []);
}
