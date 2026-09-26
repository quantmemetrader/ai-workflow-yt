import "server-only";
import { orientationOf, type Candidate, type SearchOpts } from "@/lib/media/types";
import { cleanTitle, fetchJson, withTimeout, BROWSER_UA } from "@/lib/media/tools";

/**
 * Pinterest search, free, through the JSON resource its own web app calls.
 *
 * The public search page is empty HTML (pins arrive client-side), but
 * `BaseSearchResource/get` answers a plain GET with the one header the app
 * sends, `X-Pinterest-PWS-Handler`. No login, no cookie, no CAPTCHA seen in
 * dozens of requests; deterministic results; up to a hundred pins a page.
 * The page's experiment flags include an "unauth lockdown" switch, so the
 * volume stays modest and Bing is the image fallback.
 *
 * Two scopes: `pins` for pictures and `videos` for pin videos, which come
 * as HLS playlists that yt-dlp turns into an MP4 from the pin URL.
 *
 * Two things a caller must know. Pinterest's relevance for a Chinese name is
 * poor ("张一鸣" returns fan pins of actors; "Zhang Yiming ByteDance" the
 * man), so the dispatcher hands this provider the English query. And an
 * original is sometimes HEIC, which no browser renders; the 736px JPEG is
 * the fallback for those.
 *
 * Credit is the pinner plus the site the pin links to, when it links
 * anywhere: the pinner is who put it on Pinterest, not always who made it.
 * A pin from a stock-photo site is marked so the editor can pass it over.
 */
const TIMEOUT_MS = 7_000;

const STOCK_SITES = /(adobe|shutterstock|freepik|gettyimages|istockphoto|dreamstime|123rf|alamy|depositphotos|vecteezy|pond5|storyblocks)\./i;

type Pin = {
  id?: string;
  type?: string;
  title?: string;
  grid_title?: string;
  description?: string;
  seo_alt_text?: string;
  auto_alt_text?: string;
  images?: Record<string, { url?: string; width?: number; height?: number }>;
  pinner?: { id?: string; username?: string; full_name?: string };
  link?: string | null;
  domain?: string | null;
  rich_summary?: { site_name?: string } | null;
  created_at?: string;
  is_video?: boolean | null;
  is_promoted?: boolean;
  videos?: { video_list?: Record<string, { url?: string; width?: number; height?: number; duration?: number; thumbnail?: string }> } | null;
};

async function resource(query: string, scope: "pins" | "videos", pageSize: number): Promise<Pin[]> {
  const url = new URL("https://www.pinterest.com/resource/BaseSearchResource/get/");
  url.searchParams.set("source_url", `/search/${scope}/?q=${encodeURIComponent(query)}`);
  url.searchParams.set("data", JSON.stringify({ options: { query, scope, page_size: pageSize }, context: {} }));
  const body = await fetchJson<{ resource_response?: { status?: string; data?: { results?: Pin[] } } }>(url.toString(), {
    headers: { "X-Pinterest-PWS-Handler": "www/search/[scope].js", "user-agent": BROWSER_UA },
    timeoutMs: TIMEOUT_MS,
  });
  if (body?.resource_response?.status !== "success") return [];
  return (body.resource_response.data?.results ?? []).filter((p) => p.type === "pin" && p.id);
}

function creditFor(p: Pin): { credit: string; licence?: string } {
  const who = p.pinner?.full_name?.trim() || p.pinner?.username || "pinner";
  const site = p.domain && p.domain !== "Uploaded by user" ? p.domain : null;
  return {
    credit: `Pinterest · ${who}${site ? ` (via ${site})` : ""}`,
    licence: site && STOCK_SITES.test(site) ? `stock:${site}` : undefined,
  };
}

function titleOf(p: Pin): string {
  return cleanTitle(p.title || p.grid_title || p.description || p.seo_alt_text || p.auto_alt_text, "Pinterest pin");
}

export async function searchPinterest(query: string, opts: SearchOpts): Promise<Candidate[]> {
  const q = query.trim();
  if (!q) return [];
  const pins = await withTimeout(resource(q, opts.kind === "video" ? "videos" : "pins", Math.min(50, Math.max(18, opts.limit * 4))).catch(() => []), TIMEOUT_MS, []);

  const out: Candidate[] = [];
  for (const p of pins) {
    if (p.is_promoted) continue;
    const pinUrl = `https://www.pinterest.com/pin/${p.id}/`;
    const author = {
      name: p.pinner?.full_name?.trim() || p.pinner?.username || "Pinterest",
      url: p.pinner?.username ? `https://www.pinterest.com/${p.pinner.username}/` : undefined,
      id: p.pinner?.id,
    };
    const thumb = p.images?.["736x"]?.url ?? p.images?.["474x"]?.url ?? p.images?.orig?.url;
    if (!thumb) continue;
    const { credit, licence } = creditFor(p);

    if (opts.kind === "video") {
      const list = p.videos?.video_list ?? {};
      const stream = list.V_HLSV4 ?? list.V_HLSV3_MOBILE ?? Object.values(list).find((v) => v?.url);
      if (!stream?.url) continue;
      const durationMs = typeof stream.duration === "number" ? stream.duration : undefined;
      if (opts.maxDurationS !== undefined && durationMs && durationMs > opts.maxDurationS * 1000) continue;
      const o = orientationOf(stream.width, stream.height);
      if (opts.orientation && opts.orientation !== "any" && o && o !== opts.orientation) continue;
      out.push({
        id: `pinterest:${p.id}`,
        kind: "video",
        platform: "pinterest",
        title: titleOf(p),
        description: p.description ? cleanTitle(p.description) : undefined,
        url: pinUrl,
        author,
        thumb,
        durationMs,
        width: stream.width,
        height: stream.height,
        orientation: o,
        publishedAt: p.created_at ? new Date(p.created_at).toISOString() : undefined,
        handle: { via: "yt-dlp", url: pinUrl, fallbackUrl: stream.url },
        licence,
        credit,
      });
    } else {
      const orig = p.images?.orig;
      const big = p.images?.["736x"];
      if (!orig?.url && !big?.url) continue;
      /* HEIC originals are real on Pinterest now; the 736 rendition is always JPEG. */
      const heic = /\.heic(\?|$)/i.test(orig?.url ?? "");
      const primary = !heic && orig?.url ? orig.url : big?.url ?? orig!.url!;
      const size = !heic && orig?.width ? orig : big;
      const o = orientationOf(size?.width, size?.height);
      if (opts.orientation && opts.orientation !== "any" && o && o !== opts.orientation) continue;
      out.push({
        id: `pinterest:${p.id}`,
        kind: "image",
        platform: "pinterest",
        title: titleOf(p),
        description: p.description ? cleanTitle(p.description) : undefined,
        url: pinUrl,
        author,
        thumb,
        width: size?.width,
        height: size?.height,
        orientation: o,
        publishedAt: p.created_at ? new Date(p.created_at).toISOString() : undefined,
        handle: { via: "image", url: primary, fallbackUrl: big?.url && big.url !== primary ? big.url : undefined },
        licence,
        credit,
      });
    }
    if (out.length >= opts.limit) break;
  }
  return out;
}
