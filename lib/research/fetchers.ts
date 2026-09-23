import "server-only";
import { XMLParser } from "fast-xml-parser";
import { SOURCE_BY_KEY } from "./sources";
import { searchVideos } from "./youtube";

/**
 * Reading the outside world.
 *
 * Nothing in here is called while somebody is waiting for a page. The refresh
 * job calls it, writes what comes back into `series_cache`, and the screens
 * read the database. That is not only a speed decision: GDELT asks for one
 * request every five seconds and answers 429 otherwise, so a page that fetched
 * on render would be a page that fails under two people.
 */
export type Point = { d: string; v: number };
export type Article = { title: string; url: string; domain: string; at: string };

/**
 * What a chart is allowed to be made of.
 *
 * A source having a bad day answers with nulls, empty strings and the
 * occasional `NaN`. Those survive `JSON.stringify` into `jsonb` as nulls, and
 * a null in a series is a chart that will not draw and a `heat` that ranks as
 * `NaN` for ever after. Numbers are checked here, once, rather than at every
 * place that later reads the cache.
 *
 * Dates arrive either as "20260913T000000Z" or as "2026-09-13"; both reduce to
 * the eight digits a day needs.
 */
function clean(points: { d: string; v: number }[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const digits = String(p.d ?? "").replace(/-/g, "").slice(0, 8);
    if (digits.length !== 8 || !/^\d{8}$/.test(digits)) continue;
    if (!Number.isFinite(p.v)) continue;
    out.push({ d: `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`, v: p.v });
  }
  return out;
}

const UA = "TengyaWorkspace/1.0 (+https://yt.okbro.xyz)";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  // Feeds are inconsistent about whether a single item is an array.
  isArray: (name) => name === "item" || name === "entry",
});

/**
 * One request every five seconds, process-wide, with a queue — GDELT's stated
 * limit, respected rather than discovered.
 *
 * This address is shared with other services, so GDELT often refuses us even
 * inside the limit. A 429 therefore parks the whole source for ten minutes
 * rather than retrying into a wall; Hacker News carries the charts meanwhile.
 */
let gdeltGate: Promise<void> = Promise.resolve();
let gdeltCooldownUntil = 0;
function throttleGdelt<T>(fn: () => Promise<T>): Promise<T> {
  const run = gdeltGate.then(fn);
  gdeltGate = run.then(
    () => new Promise((r) => setTimeout(r, 5200)),
    () => new Promise((r) => setTimeout(r, 5200)),
  );
  return run;
}

async function get(url: string, timeoutMs = 20_000): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, application/json;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
}

/**
 * Daily coverage volume for a phrase, from GDELT. Values are GDELT's own
 * normalised percentage of worldwide coverage, not a count we invented.
 *
 * Retries on 429 because a shared IP hits their limit through no fault of the
 * query; gives up rather than hammering.
 */
export async function gdeltTimeline(query: string, span: "1m" | "3m" | "6m"): Promise<Point[]> {
  if (Date.now() < gdeltCooldownUntil) {
    throw new Error(
      `GDELT is rate-limiting this address; next attempt after ${new Date(gdeltCooldownUntil).toISOString().slice(11, 19)}`,
    );
  }

  const url = SOURCE_BY_KEY.get("gdelt")!
    .search!.replace("{q}", encodeURIComponent(`"${query}"`))
    .replace("{span}", span);

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await throttleGdelt(() => get(url, 30_000));
    const body = await res.text();

    if (res.ok && body.trim().startsWith("{")) {
      const json = JSON.parse(body);
      const series = json.timeline?.[0]?.data;
      if (!Array.isArray(series)) return [];
      return clean(
        series.map((p: { date?: string; value?: number }) => ({
          // "20260913T000000Z" → "2026-09-13"
          d: String(p?.date ?? "").slice(0, 8),
          v: Number(p?.value ?? 0),
        })),
      );
    }

    if (res.status !== 429 && !body.includes("limit requests")) {
      throw new Error(`GDELT said ${res.status}: ${body.slice(0, 160)}`);
    }
    // Their limiter counts across everyone on this address; back off properly.
    await new Promise((r) => setTimeout(r, 15_000 * (attempt + 1)));
  }

  gdeltCooldownUntil = Date.now() + 10 * 60_000;
  throw new Error("GDELT is rate-limiting this address; parked for ten minutes");
}

/** Articles about a phrase, newest first, with the outlet that published each. */
export async function newsSearch(query: string, limit = 40): Promise<Article[]> {
  const url = SOURCE_BY_KEY.get("googlenews")!.search!.replace("{q}", encodeURIComponent(query));
  const res = await get(url);
  if (!res.ok) throw new Error(`Google News said ${res.status}`);
  return parseFeed(await res.text(), limit);
}

/** Everything one outlet has published lately. */
export async function sourceFeed(key: string, limit = 60): Promise<Article[]> {
  const source = SOURCE_BY_KEY.get(key);
  if (!source?.feed) throw new Error(`${key} has no feed`);
  const res = await get(source.feed);
  if (!res.ok) throw new Error(`${source.name} said ${res.status}`);
  return parseFeed(await res.text(), limit, source.name);
}

/** RSS and Atom, which differ in every way that matters. */
function parseFeed(xml: string, limit: number, fallbackOutlet?: string): Article[] {
  const doc = parser.parse(xml);
  const rssItems = doc?.rss?.channel?.item ?? [];
  const atomEntries = doc?.feed?.entry ?? [];
  const out: Article[] = [];

  for (const item of rssItems.slice(0, limit)) {
    const link = typeof item.link === "string" ? item.link : (item.link?.["@href"] ?? "");
    out.push({
      title: text(item.title),
      url: link,
      domain: outletOf(item, link, fallbackOutlet),
      at: date(item.pubDate ?? item["dc:date"]),
    });
  }

  for (const entry of atomEntries.slice(0, limit)) {
    const link = Array.isArray(entry.link)
      ? (entry.link.find((l: Record<string, string>) => l["@rel"] !== "self")?.["@href"] ?? "")
      : (entry.link?.["@href"] ?? "");
    out.push({
      title: text(entry.title),
      url: link,
      domain: outletOf(entry, link, fallbackOutlet),
      at: date(entry.published ?? entry.updated),
    });
  }

  return out.filter((a) => a.title && a.url);
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "#text" in value) return String((value as Record<string, unknown>)["#text"]).trim();
  return "";
}

/** Google News names the original outlet in a `<source>` element; a direct feed
 * is its own outlet; otherwise fall back to the host. */
function outletOf(item: Record<string, unknown>, link: string, fallback?: string): string {
  const named = text(item.source);
  if (named) return named;
  if (fallback) return fallback;
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function date(value: unknown): string {
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

/**
 * Stories per day on Hacker News, which for a technology studio is a real
 * measure of attention and — unlike GDELT — answers every time.
 *
 * Counts are weekly-smoothed by the caller; a single day of a niche query is
 * mostly noise.
 */
export async function hackerNewsSeries(query: string, days: number): Promise<Point[]> {
  const since = Math.floor((Date.now() - days * 86_400_000) / 1000);
  const url =
    "https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=1000" +
    `&numericFilters=created_at_i>${since}&query=${encodeURIComponent(query)}`;

  const res = await get(url, 20_000);
  if (!res.ok) throw new Error(`Hacker News said ${res.status}`);

  const json = (await res.json()) as { hits: { created_at: string }[] };
  const counts = new Map<string, number>();

  // Seed every day in the window so the line is continuous rather than
  // skipping the quiet days.
  for (let i = 0; i <= days; i++) {
    counts.set(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10), 0);
  }
  for (const hit of Array.isArray(json.hits) ? json.hits : []) {
    const day = String(hit?.created_at ?? "").slice(0, 10);
    if (counts.has(day)) counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  const daily = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ d, v }));
  return rollingSum(daily, 7);
}

/** Seven-day rolling total: the shape a weekly cadence actually has. */
/**
 * How much was published about a phrase on YouTube, day by day.
 *
 * This is the signal the studio actually cares about, and it took a key they
 * already had to get it. GDELT rate-limits this address and Hacker News
 * measures what programmers discuss; neither says whether anybody is making
 * — or watching — video about a subject. This does.
 *
 * Each day is scored by the videos published that day, weighted by what they
 * were watched. A day with one video that got two million views mattered more
 * than a day with six that got two thousand, and counting rows alone says the
 * opposite.
 *
 * `search` costs 100 of the key's 10,000 daily units, which is why this is
 * called by the refresh job and never by a render.
 */
export async function youtubeSeries(
  query: string,
  days: number,
): Promise<{ points: Point[]; videos: number; articles: Article[] }> {
  // One search, both answers. Two calls would be 200 of the key's 10,000
  // daily units for one topic, and they would be reading the same list.
  const videos = await searchVideos(query, { days: Math.min(days, 365), limit: 50 });
  if (videos.length === 0) return { points: [], videos: 0, articles: [] };

  const byDay = new Map<string, number>();
  for (const v of videos) {
    const day = v.publishedAt.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    // log1p, so one runaway video lifts its day without flattening every
    // other day into the axis.
    byDay.set(day, (byDay.get(day) ?? 0) + Math.log1p(v.views));
  }

  const points = [...byDay.entries()]
    .map(([d, v]) => ({ d, v: Math.round(v * 10) / 10 }))
    .sort((a, b) => a.d.localeCompare(b.d));

  /* The videos are sources too, and on a dashboard for a video studio the
     most useful one: the video somebody else already made about this. */
  const articles: Article[] = videos.slice(0, 25).map((v) => ({
    title: `${v.title} — ${v.channelTitle}`,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    domain: "youtube.com",
    at: v.publishedAt,
  }));

  return { points: clean(points), videos: videos.length, articles };
}

export function rollingSum(points: Point[], window: number): Point[] {
  return points.map((p, i) => {
    const slice = points.slice(Math.max(0, i - window + 1), i + 1);
    return { d: p.d, v: slice.reduce((a, b) => a + b.v, 0) };
  });
}

/** Articles per day, for a chart drawn from articles rather than from a signal. */
export function dailyCounts(articles: Article[], days = 90): Point[] {
  const counts = new Map<string, number>();
  const since = Date.now() - days * 86_400_000;

  for (const a of articles) {
    const t = new Date(a.at).getTime();
    if (t < since) continue;
    const day = a.at.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }

  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => ({ d, v }));
}
