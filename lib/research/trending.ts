import "server-only";
import { XMLParser } from "fast-xml-parser";

/**
 * What a place is searching for right now, from Google's own feed.
 *
 * `sources.ts` listed Google Trends as permanently blocked — "no official API,
 * and the contract rules out scrapers such as pytrends". The first half was
 * half true: there is no *Trends API*, but Google publishes Daily Search
 * Trends as RSS, which is a feed, not a scrape. It answers in about 300ms with
 * the day's rising searches, an approximate volume, and the news stories
 * behind each one.
 *
 * What this gives the studio is the thing the dashboard could not do before:
 * suggest what to watch. Typing a phrase into an empty box asks a person to
 * already know the answer; a list of what Hong Kong is searching this morning
 * asks them only to recognise one.
 *
 * Volume is approximate by design ("200+", "20K+"), so it is carried as the
 * string Google wrote rather than dressed up as a number nobody measured.
 */
export type TrendingSearch = {
  phrase: string;
  /** Which market this one came from. Set when a row is not from the region
   * that was asked for, so the screen can say so rather than imply it. */
  region?: string;
  /** Google's own wording: "200+", "20K+". Null when it did not say. */
  traffic: string | null;
  /** The story behind it, if the feed named one. */
  headline: string | null;
  headlineUrl: string | null;
  source: string | null;
};

/** The regions the studio publishes into. Google's own geo codes. */
export const TRENDING_REGIONS = ["HK", "TW", "SG", "US", "GB", "JP"] as const;

/*
 * One fetch per region per half hour, for the whole server.
 *
 * Daily Search Trends moves hourly at best, and this is read on every render
 * of the dashboard. Without the cache, ten people opening Research is ten
 * requests to Google for a list that has not changed.
 */
const TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; rows: TrendingSearch[] }>();

export async function trendingSearches(region: string = "HK"): Promise<TrendingSearch[]> {
  const geo = (TRENDING_REGIONS as readonly string[]).includes(region.toUpperCase())
    ? region.toUpperCase()
    : "HK";

  const hit = cache.get(geo);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;

  try {
    const res = await fetch(`https://trends.google.com/trending/rss?geo=${geo}`, {
      headers: { "User-Agent": "Tengya/1.0 (+studio research)" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Google Trends answered ${res.status}`);
    const rows = parse(await res.text());
    cache.set(geo, { at: Date.now(), rows });
    return rows;
  } catch {
    /*
     * A dashboard does not fail because a suggestion list is unavailable. The
     * last good answer is served if there is one, stale and all — a list of
     * this morning's searches is still worth reading this afternoon — and an
     * empty list otherwise, which the screen draws as no suggestions.
     */
    return hit?.rows ?? [];
  }
}

function parse(xml: string): TrendingSearch[] {
  const parser = new XMLParser({
    ignoreAttributes: true,
    // `ht:` is the feed's own namespace; keeping the prefix means the keys
    // below read the same as the XML they came from.
    removeNSPrefix: false,
  });

  const doc = parser.parse(xml) as {
    rss?: { channel?: { item?: unknown } };
  };
  const raw = doc.rss?.channel?.item;
  const items = Array.isArray(raw) ? raw : raw ? [raw] : [];

  const out: TrendingSearch[] = [];
  for (const entry of items) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;

    const phrase = text(item.title);
    if (!phrase) continue;

    // One trend can carry several stories; the first is the one the feed leads
    // with, and a suggestion row has room for one.
    const newsRaw = item["ht:news_item"];
    const news = (Array.isArray(newsRaw) ? newsRaw[0] : newsRaw) as Record<string, unknown> | undefined;

    out.push({
      phrase: phrase.slice(0, 120),
      traffic: text(item["ht:approx_traffic"]),
      headline: news ? text(news["ht:news_item_title"])?.slice(0, 200) ?? null : null,
      headlineUrl: news ? text(news["ht:news_item_url"]) : null,
      source: news ? text(news["ht:news_item_source"])?.slice(0, 60) ?? null : null,
    });
  }
  return out.slice(0, 20);
}

/** The parser hands back numbers for numeric-looking text, and objects for
 * empty elements. Only real text is wanted. */
function text(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

/**
 * The region's own list, topped up from the markets the studio also publishes
 * into when the home feed is thin.
 *
 * Google's Hong Kong feed is often five phrases, which left a row meant to
 * carry the day's news looking half-built. The fix is not to invent phrases:
 * it is to show the neighbouring markets this studio actually posts to, each
 * tagged with where it came from. "arsenal · HK" and "arsenal · GB" are
 * different facts and the screen says which it has.
 */
export async function trendingNearby(
  region: string = "HK",
  want = 14,
): Promise<TrendingSearch[]> {
  const home = (TRENDING_REGIONS as readonly string[]).includes(region.toUpperCase())
    ? region.toUpperCase()
    : "HK";

  const rows = (await trendingSearches(home)).map((r) => ({ ...r, region: home }));
  if (rows.length >= want) return rows.slice(0, want);

  const seen = new Set(rows.map((r) => r.phrase.toLowerCase()));
  /* Nearest first: the markets a Hong Kong studio's audience overlaps with
     before the ones it does not. */
  const order = home === "HK" ? ["TW", "SG", "GB", "US", "JP"] : TRENDING_REGIONS.filter((r) => r !== home);

  for (const other of order) {
    if (rows.length >= want) break;
    const more = await trendingSearches(other).catch(() => []);
    for (const row of more) {
      if (rows.length >= want) break;
      const key = row.phrase.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ ...row, region: other });
    }
  }

  return rows;
}
