/**
 * How the stored lists are put together for reading: one platform's tab, or
 * the first tab across every platform.
 *
 * Shared by the Research page (`components/research/LiveNow.tsx`, in the
 * browser) and the server readers (the morning brief's evidence, Home's
 * ideas, the Research agent's `trending_now`), so a row is on the same tab,
 * with the same rank and the same 上榜 badge, wherever it is read.
 *
 * A tab is two things (see `BEAT_FEEDS`):
 *
 *   上榜  the rows of the platform's own hourly charts that are on a beat —
 *         the platform itself is pushing them. First, with the chart's name
 *         and the rank on it.
 *   feed  the platform's beat feed: what searching it for AI, crypto, tech
 *         and business found, thirty of them, ranked by how they did and how
 *         recent they are. The rank shown is the feed's own.
 *
 * A post on both is shown once, among the 上榜 rows, with its feed rank too.
 *
 * Pure functions over plain data; no fetching, safe in the browser.
 */
import {
  BEAT_FEEDS,
  beatOf,
  onFocus,
  type Beat,
  type BeatFeedKey,
  type BeatTab,
  type HotRow,
  type ListKey,
  type PlatformKey,
  type Relevance,
  type RelevanceMap,
} from "@/lib/research/platform-catalog";

export type StoredList = {
  rows: HotRow[];
  relevance?: RelevanceMap | null;
  fetchedAt?: number | null;
  summary?: string | null;
  note?: string | null;
};
export type Lists = Partial<Record<string, StoredList>>;

export type BeatRow = HotRow & {
  /** The list the row is on (the feed, or the chart for a 上榜 row). */
  from: ListKey;
  /** Its place on that list. */
  rank: number;
  mark: Relevance | null;
  beat: Beat | null;
  /** On a platform's own chart: which, and where. */
  chart: { list: PlatformKey; rank: number } | null;
  /** Its rank in the beat feed as well, when a 上榜 row is also there. */
  feedRank: number | null;
};

/** The tab order: the platforms the studio's audience is on first. */
export const BEAT_TABS: readonly BeatTab[] = ["douyin", "xiaohongshu", "weibo", "bilibili", "youtube", "tiktok", "news", "crypto"];

export const feedOfTab = (tab: BeatTab) => BEAT_FEEDS.find((f) => f.tab === tab)!;

/** Same post: same link, or the same opening words once spacing, tags and
 *  punctuation are gone (a headline syndicated to two outlets, a video on
 *  two 抖音 charts with a slightly different title). */
export function sameKey(r: Pick<HotRow, "phrase" | "url">): string {
  const words = r.phrase
    .toLowerCase()
    .replace(/#\S+/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .slice(0, 28);
  return words || (r.url ?? "").replace(/[?#].*$/, "");
}
/* The whole link, query and all (a YouTube video is `watch?v=…`); a link
   that only searches the phrase again says nothing about which post it is. */
const linkKey = (url: string | null | undefined) =>
  url && !/\/search|search_result|[?&]q=|keyword=/.test(url) ? url.replace(/^https?:\/\/(www\.)?/, "").replace(/#.*$/, "").replace(/\/$/, "") : null;

/** The feed's rows, ranked as stored, with their marks. */
export function feedRows(feed: BeatFeedKey, lists: Lists): BeatRow[] {
  const l = lists[feed];
  if (!l?.rows?.length) return [];
  return l.rows.map((r, i) => {
    const mark = l.relevance?.[r.phrase] ?? null;
    return { ...r, from: feed, rank: i + 1, mark, beat: r.beat ?? beatOf(mark), chart: null, feedRank: i + 1 };
  });
}

/** The on-beat rows of a feed's platform charts, squarest first, then by rank. */
export function chartRows(feed: BeatFeedKey, lists: Lists): BeatRow[] {
  const meta = BEAT_FEEDS.find((f) => f.key === feed)!;
  const out: BeatRow[] = [];
  for (const key of meta.hot as readonly PlatformKey[]) {
    const l = lists[key];
    if (!l?.rows?.length || !l.relevance) continue;
    l.rows.forEach((r, i) => {
      const mark = l.relevance![r.phrase] ?? null;
      if (!onFocus(mark)) return;
      out.push({ ...r, from: key, rank: i + 1, mark, beat: beatOf(mark), chart: { list: key, rank: i + 1 }, feedRank: null });
    });
  }
  return out.sort((a, b) => (b.mark?.s ?? 0) - (a.mark?.s ?? 0) || a.rank - b.rank);
}

/**
 * One platform tab: its 上榜 rows, then its feed, each post once.
 *
 * `beat` narrows both to one beat (the chips). `chartCap` keeps the 上榜
 * block from pushing the feed off the first screen on a day 抖音's five
 * charts all carry the beat; the rest are in the raw charts.
 */
export function tabRows(tab: BeatTab, lists: Lists, opts: { beat?: Beat | null; chartCap?: number } = {}): { charted: BeatRow[]; feed: BeatRow[]; chartedHidden: number } {
  const meta = feedOfTab(tab);
  const feed = feedRows(meta.key, lists);
  const byLink = new Map<string, BeatRow>();
  const byWords = new Map<string, BeatRow>();
  for (const r of feed) {
    const lk = linkKey(r.url);
    if (lk) byLink.set(lk, r);
    byWords.set(sameKey(r), r);
  }
  const taken = new Set<BeatRow>();
  const seenChart = new Set<string>();
  const charted: BeatRow[] = [];
  for (const c of chartRows(meta.key, lists)) {
    const k = sameKey(c);
    if (seenChart.has(k)) continue;
    seenChart.add(k);
    const lk = linkKey(c.url);
    const inFeed = (lk && byLink.get(lk)) || byWords.get(k) || null;
    if (inFeed) {
      taken.add(inFeed);
      // The feed's copy has the richer numbers (a search result carries
      // comments and shares a chart row may not); the chart gives the badge.
      charted.push({ ...inFeed, chart: c.chart, feedRank: inFeed.rank, mark: inFeed.mark ?? c.mark, beat: inFeed.beat ?? c.beat });
    } else charted.push(c);
  }
  const want = (r: BeatRow) => !opts.beat || r.beat === opts.beat;
  const chartedAll = charted.filter(want);
  const cap = opts.chartCap ?? chartedAll.length;
  return {
    charted: chartedAll.slice(0, cap),
    chartedHidden: Math.max(0, chartedAll.length - cap),
    feed: feed.filter((r) => !taken.has(r) && want(r)),
  };
}

/** How many rows of a tab are on each beat, for the chips. */
export function beatCounts(rows: BeatRow[]): Record<Beat | "all", number> {
  const out: Record<Beat | "all", number> = { all: rows.length, ai: 0, crypto: 0, tech: 0, biz: 0 };
  for (const r of rows) if (r.beat) out[r.beat]++;
  return out;
}

/**
 * The first tab: the top of every platform's tab together.
 *
 * Round-robin over the platforms, each contributing its tab in order (上榜
 * first, then the feed), so the day's biggest post on 小红书 sits next to
 * the biggest on 抖音 rather than below thirty 抖音 rows — plays on 抖音 and
 * likes on 小红书 are not one unit, and interleaving by rank avoids
 * pretending they are. One copy of each post across platforms. The coin
 * market is its own tab and not mixed in: it is prices, not content.
 */
export function acrossPlatforms(lists: Lists, opts: { beat?: Beat | null; limit?: number } = {}): BeatRow[] {
  const queues = BEAT_TABS.filter((t) => t !== "crypto").map((t) => {
    const { charted, feed } = tabRows(t, lists, { beat: opts.beat });
    return [...charted, ...feed];
  });
  const out: BeatRow[] = [];
  const seen = new Set<string>();
  const limit = opts.limit ?? 40;
  for (let i = 0; out.length < limit && queues.some((q) => i < q.length); i++) {
    for (const q of queues) {
      const r = q[i];
      if (!r || out.length >= limit) continue;
      const k = sameKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}

/** Whether any beat feed is stored yet (before the first beat run, the page
 *  falls back to the platforms' own charts). */
export const anyFeed = (lists: Lists) => BEAT_FEEDS.some((f) => (lists[f.key]?.rows?.length ?? 0) > 0);
