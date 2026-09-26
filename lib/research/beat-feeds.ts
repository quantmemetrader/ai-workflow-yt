import "server-only";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { hotSnapshots } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { env } from "@/lib/env";
import {
  bilibiliSearchVideos,
  douyinBillboardSearch,
  douyinVideoSearch,
  tiktokVideoSearch,
  weiboHotPosts,
  weiboHotSearch,
  xiaohongshuSearchNotes,
} from "@/lib/social/tikhub";
import { channelsById, searchVideos } from "@/lib/research/youtube";
import { cryptoMarket, googleNewsSearch, type NewsEdition } from "@/lib/research/beat-sources";
import { BEAT_EVERY_HOURS_DEFAULT, beatSlot, planBeatRun, planNews, planYouTube, type PlannedSearch } from "@/lib/research/beats";
import { BEAT_FEEDS, BEATS, beatOf, type Beat, type BeatFeedKey, type HotRow, type RelevanceMap } from "@/lib/research/platform-catalog";
import { acrossPlatforms, foreignScript, type Lists } from "@/lib/research/beat-view";
import { FOCUS_FALLBACK, channelFocus, classifyHot } from "@/lib/research/relevance";
import { summarizeHot } from "@/lib/research/summary";
import { judgeHot, type Judged } from "@/lib/research/judge";
import { studioBrief, type StudioBrief } from "@/lib/research/studio";
import { HOT_TENANT, latestStored, meterFor, storedAll } from "@/lib/research/platforms";

/**
 * The beat feeds: each platform searched for the studio's subjects, stored
 * full.
 *
 * The owner, on the Research tabs reading "抖音财经 3 / 28", "小红书 0 / 20",
 * "YouTube 0 / 24": "for the research, keep it related to business and tech
 * & crypto, AI and stuff, and in content don't just have 2-3 stuff — i.e.
 * frontend filtered, don't do that. I have given you paid APIs of
 * everything, so make it perfect."
 *
 * So instead of reading each platform's whole hot list and hiding most of it,
 * the collector asks each platform for the beats directly (the words live in
 * `lib/research/beats.ts`):
 *
 *   抖音    creator billboard filtered by keyword (TikHub): plays, likes, fans
 *   小红书  note search, most liked, last week (TikHub)
 *   B站     video search, most played, last 72 hours (TikHub)
 *   TikTok  video search, most liked, last week, English words (TikHub)
 *   微博    its own 科技 hot list, plus 热门 post search (TikHub)
 *   YouTube Data API search, most viewed, last 72 hours, then video stats
 *   新闻    Google News search, Hong Kong and Taiwan editions (free)
 *   加密市场 CoinGecko trending and the day's movers (free)
 *
 * Each feed merges its searches with the rows its last run found that are
 * still recent, drops duplicates, ranks by how each post did against the
 * others from the same search (plays on 抖音 and likes on 小红书 are not one
 * unit, so each is ranked among its own) and by age, has the classifier
 * (`lib/research/relevance.ts`) mark what is left — dropping what a search
 * word dragged in, an AI-drawn cat found by "AI" — and keeps thirty, no
 * beat more than twelve of them, so every chip has rows. The researcher's
 * line and marks are written over the thirty, and the whole is one
 * `hot_snapshots` row under the feed's key (`beat_douyin` …), so a page
 * reads it in one query.
 *
 * Cost, by design (the numbers the log line prints each run):
 *
 *   TikHub   17 requests a run (5 抖音, 3 小红书, 3 B站, 3 TikTok, 2 微博
 *            searches and 微博's 科技 list), plus one per 抖音 word its
 *            billboard has little for (up to 22), with a hard cap per run
 *            (`RESEARCH_BEAT_TIKHUB_CAP`, default 30) checked before every
 *            call. Every third hour: 8 runs, 136 to 176 requests a day
 *            (about 145 typical, 4,400 a month), on top of the hourly
 *            charts' ~176 a day. At the account's observed average of about
 *            $0.0017 a request, roughly $0.25 a day. A feed that fails
 *            waits its three hours like one that worked (`RUN_KEY`), so an
 *            outage does not multiply the count.
 *   YouTube  2 searches a run at 102 units each (search, then the videos'
 *            numbers and their channels' subscribers): 204 units, 1,632 a
 *            day of the key's 10,000.
 *   Google News, CoinGecko: free, 8 and 2 requests a run.
 *   Models   the classifier on new rows only (rows kept from the last run
 *            keep their marks), one summary and one set of marks per feed.
 */

const FEED_SIZE = 30;
/** Rows ranked before classifying: enough to fill thirty after the classifier
 *  drops what a word dragged in, without paying to mark the tail. */
const CLASSIFY_TOP = 60;
/** No beat takes more than this share of a feed while others have rows. */
const BEAT_CAP = 12;

/** How recent a post has to be to stay in the feed, per feed. */
const FRESH_DAYS: Record<BeatFeedKey, number> = {
  beat_douyin: 7,
  beat_xiaohongshu: 7,
  beat_bilibili: 4,
  beat_tiktok: 7,
  beat_weibo: 7,
  beat_youtube: 3,
  beat_news: 2,
  beat_crypto: 0,
};
/** Feeds whose earlier rows are carried forward (the rotated searches). News
 *  is searched for every beat every run, and prices are only worth the
 *  latest read, so those two start fresh each time. */
const CARRY = new Set<BeatFeedKey>(["beat_douyin", "beat_xiaohongshu", "beat_bilibili", "beat_tiktok", "beat_weibo", "beat_youtube"]);
/* `OTHER_SCRIPT` (in `beat-view.ts`, shared with the page's 上榜 rows): a
   title or account name in a script the studio's audience does not read. */

/** A TikTok caption of hashtags and nothing else ("#iphone18 #apple") says
 *  what it is tagged, not what it is; there is nothing to research in it. */
const hashtagsOnly = (phrase: string) => phrase.replace(/[#@]\S+/g, "").replace(/[\s\p{P}\p{S}]+/gu, "").length < 4;

/** A carried row's numbers are at most this old. */
const CARRY_MS = 24 * 3_600_000;

type Candidate = HotRow & {
  /** The beat the search was for: the fallback when the classifier is down. */
  hint: Beat | null;
  /** Which search produced it; rows are ranked among their own group. */
  group: string;
  carried?: boolean;
};

export type BeatReport = {
  feed: BeatFeedKey;
  rows: number;
  byBeat: Record<Beat, number>;
  /** Candidates the classifier looked at, and how many it kept on a beat. */
  classified: number;
  kept: number;
  carried: number;
  tikhub: number;
  youtubeUnits: number;
  free: number;
  model: number;
  skipped?: string;
  note?: string | null;
  examples: HotRow[];
  errors: string[];
};

/** The per-run spend, checked before every paid call. */
class Budget {
  tikhub = 0;
  ytSearches = 0;
  free = 0;
  refused: string[] = [];
  constructor(
    readonly tikhubCap: number,
    readonly ytCap: number,
  ) {}
  takeTikhub(what: string): boolean {
    if (this.tikhub >= this.tikhubCap) {
      this.refused.push(what);
      return false;
    }
    this.tikhub++;
    return true;
  }
  takeYouTube(what: string): boolean {
    if (this.ytSearches >= this.ytCap) {
      this.refused.push(what);
      return false;
    }
    this.ytSearches++;
    return true;
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const lg = (v: unknown) => Math.log10(1 + Math.max(0, num(v)));

/** How a post did, in its own units: plays first, then likes, then heat. */
function engagement(r: HotRow): number {
  const s = r.stats ?? {};
  const talk = num(s.comments) + num(s.shares) + num(s.saves);
  if (s.views != null) return lg(s.views) + 0.6 * lg(s.likes) + 0.4 * lg(talk);
  if (s.likes != null) return lg(s.likes) + 0.6 * lg(talk);
  if (r.heat != null) return lg(r.heat);
  return 0;
}

/** Hours since it went up, or null when the platform did not say. */
function ageHours(r: HotRow, now: number): number | null {
  const at = r.stats?.publishedAt ? Date.parse(r.stats.publishedAt) : NaN;
  return Number.isFinite(at) ? Math.max(0, (now - at) / 3_600_000) : null;
}

/** The unit a row's engagement is in. Rows are ranked against rows in the
 *  same unit: plays against plays, likes against likes, a chart's heat
 *  against its heat. */
function unitOf(r: HotRow): string {
  const s = r.stats ?? {};
  if (s.views != null) return "views";
  if (s.likes != null) return "likes";
  if (r.heat != null) return r.origin === "hot" ? "chart" : "heat";
  return "none";
}

/**
 * Below these, a post is "found" rather than "doing well": a 小红书 note with
 * 40 likes, a B站 video with 800 plays. Such rows are not dropped — a quiet
 * day on a beat still gets its rows — but they rank after every row that
 * cleared the bar, so they only fill what is left.
 */
const FLOOR: Partial<Record<BeatFeedKey, { views?: number; likes?: number }>> = {
  beat_douyin: { views: 50_000, likes: 1_000 },
  beat_bilibili: { views: 5_000 },
  beat_tiktok: { views: 50_000 },
  beat_youtube: { views: 5_000 },
  beat_xiaohongshu: { likes: 200 },
  beat_weibo: { likes: 300 },
};
function belowFloor(feed: BeatFeedKey, r: HotRow): boolean {
  const f = FLOOR[feed];
  const s = r.stats ?? {};
  if (!f || r.origin === "hot") return false;
  if (s.views != null && f.views != null) return s.views < f.views;
  if (s.likes != null && f.likes != null) return s.likes < f.likes;
  return false;
}

/**
 * Rank a feed's candidates: 65% how a post did against the feed's other
 * posts in the same unit (its percentile, so a group of likes and a group
 * of plays each spread from 0 to 1), 35% how recent (halving every two
 * days; a row with no date counts as middling). News has no engagement;
 * the number of outlets carrying a story, then Google's own order, stand in.
 * Rows under the feed's floor go after the rest.
 */
function rank(feed: BeatFeedKey, cands: Candidate[], now: number): Candidate[] {
  const groups = new Map<string, Candidate[]>();
  for (const c of cands) {
    const g = feed === "beat_news" ? c.group : unitOf(c);
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  const pct = new Map<Candidate, number>();
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => engagement(b) - engagement(a));
    sorted.forEach((c, i) => pct.set(c, list.length > 1 ? 1 - i / (list.length - 1) : 0.5));
  }
  /* A row with likes but no plays (抖音's own search, the fallback for a
     word the billboard has little for) is measured against the likes of
     every row that has them, plays or not — not only against the few other
     fallback rows. Ranked among eight of its own, a video with 6,000 likes
     came out at the top of its group and sat at #2 of the 抖音 feed, above
     billboard videos with millions of plays and a hundred times its likes. */
  if (feed !== "beat_news" && groups.has("likes") && groups.has("views")) {
    /* Likes alone: the billboard rows carry plays and likes but no
       comments or shares, so counting those would favour the fallback. */
    const likeScore = (c: Candidate) => lg(c.stats?.likes);
    const pool = cands.filter((c) => c.stats?.likes != null).map(likeScore).sort((a, b) => a - b);
    for (const c of groups.get("likes")!) {
      const below = pool.filter((v) => v < likeScore(c)).length;
      pct.set(c, pool.length > 1 ? below / (pool.length - 1) : 0.5);
    }
  }
  const score = (c: Candidate) => {
    const h = ageHours(c, now);
    const recency = h === null ? 0.5 : Math.pow(0.5, h / 48);
    return 0.65 * (pct.get(c) ?? 0.5) + 0.35 * recency - (belowFloor(feed, c) ? 1 : 0);
  };
  return [...cands].sort((a, b) => score(b) - score(a));
}

/* The whole link, query included: a YouTube video is `watch?v=…` and a
   微博 topic `weibo?q=…`, so cutting the query made every video one video
   (the first run kept one YouTube row of fifty). */
const linkKey = (url: string | null | undefined) => (url ? url.replace(/^https?:\/\/(www\.)?/, "").replace(/#.*$/, "").replace(/\/$/, "") : null);
const wordsKey = (phrase: string) =>
  phrase
    .toLowerCase()
    .replace(/#\S+/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .slice(0, 28);

/** One copy per post: by link, then by the opening words. The first seen
 *  wins, so fresh rows go in before carried ones. */
function dedupe(cands: Candidate[]): Candidate[] {
  const links = new Set<string>();
  const words = new Set<string>();
  const out: Candidate[] = [];
  for (const c of cands) {
    const lk = linkKey(c.url);
    const wk = wordsKey(c.phrase);
    if ((lk && links.has(lk)) || (wk && words.has(wk))) continue;
    if (lk) links.add(lk);
    if (wk) words.add(wk);
    out.push(c);
  }
  return out;
}

/**
 * The top `n`, taken in turn from each search, then put back in rank order.
 * Without it one search's strong results fill the rows sent to the
 * classifier and another beat's never get marked (the first news run kept
 * three tech stories to eleven business ones for exactly that reason).
 */
function spread(ranked: Candidate[], n: number): Candidate[] {
  const byGroup = new Map<string, Candidate[]>();
  for (const c of ranked) byGroup.set(c.group, [...(byGroup.get(c.group) ?? []), c]);
  const queues = [...byGroup.values()];
  const chosen = new Set<Candidate>();
  for (let i = 0; chosen.size < n && queues.some((q) => i < q.length); i++) {
    for (const q of queues) if (q[i] && chosen.size < n) chosen.add(q[i]);
  }
  return ranked.filter((c) => chosen.has(c));
}

/** Two-character pieces of a headline, for telling one story from another. */
function bigrams(text: string): Set<string> {
  const t = text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

/**
 * One row per news story, with how many outlets carried it.
 *
 * Google News lists the same story once per outlet ("比爾蓋茨警告AI…" from
 * 橙新聞, 經濟日報 and 881903 on the first run). Headlines sharing most of
 * their two-character pieces are one story; the first (Google's own
 * placing) stands for it, and the count of outlets becomes its heat — the
 * nearest thing a news story has to a view count.
 */
function clusterNews(cands: Candidate[]): Candidate[] {
  const heads: { c: Candidate; grams: Set<string>; outlets: string[] }[] = [];
  for (const c of cands) {
    const grams = bigrams(c.phrase);
    const outlet = (c.extra ?? "").split(" · ")[0];
    const same = heads.find((h) => {
      let both = 0;
      for (const g of grams) if (h.grams.has(g)) both++;
      return both / Math.max(1, grams.size + h.grams.size - both) >= 0.34;
    });
    if (same) {
      if (outlet && !same.outlets.includes(outlet)) same.outlets.push(outlet);
    } else heads.push({ c, grams, outlets: outlet ? [outlet] : [] });
  }
  return heads.map(({ c, outlets }) =>
    outlets.length > 1 ? { ...c, heat: outlets.length, heatLabel: `${outlets.length} 家报道`, extra: `${outlets[0]} 等 ${outlets.length} 家` } : c,
  );
}

/** Words to compare two titles by: two-character pieces of a Chinese title's
 *  opening, or the first dozen words of one in English (character pairs of
 *  English are shared by nearly any two headlines). */
const STOP = new Set("the and for with that this you your are was were has have had from what when why how who its not but all any can will just about into out our they them their his her she him new now more most than then there here one two get got".split(" "));
function storyTokens(phrase: string): Set<string> {
  const clean = phrase.toLowerCase().replace(/[#@]\S+/g, " ").replace(/【[^】]*】/g, " ");
  const latin = (clean.match(/[a-z]/g) ?? []).length;
  const han = (clean.match(/\p{Script=Han}/gu) ?? []).length;
  const out = new Set<string>();
  if (latin > han * 2) {
    for (const w of clean.split(/[^a-z0-9$%.]+/).filter((w) => w.length >= 3 && !STOP.has(w)).slice(0, 12)) out.add(w);
  } else {
    const t = clean.replace(/[\s\p{P}\p{S}]+/gu, "").slice(0, 32);
    for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  }
  return out;
}

/**
 * The rows that retell a story a better-ranked row already tells.
 *
 * `dedupe` only catches the same post. 微博's 科技 hot list gives one phone
 * launch seven topics ("华为Mate90系列定档", "…发布会定档", "…定档10月1日",
 * "知情人士回应…"), and on 抖音 one company's matrix accounts post the same
 * smuggling story under five titles; on 09-26 that was seven of 微博's thirty
 * rows and five of 抖音's. Titles sharing most of their opening (two-character
 * pieces for Chinese, words for English, overlap ≥ 0.4), directly or through
 * another retelling, are one story. The retellings are not dropped: they go
 * after every row that tells a story of its own, so they only fill a feed
 * that would otherwise be short.
 */
function echoesOf(ranked: Candidate[]): Set<Candidate> {
  const seen: Set<string>[] = [];
  const echoes = new Set<Candidate>();
  for (const c of ranked) {
    const t = storyTokens(c.phrase);
    if (t.size < 3) continue;
    const same = seen.some((s) => {
      let both = 0;
      for (const g of t) if (s.has(g)) both++;
      return both / (s.size + t.size - both) >= 0.4;
    });
    if (same) echoes.add(c);
    seen.push(t);
  }
  return echoes;
}

/** What each feed will ask this run, for the dry run and the log. */
export type PlannedRequest = { feed: BeatFeedKey; paid: "tikhub" | "youtube" | "free"; what: string; beat: Beat | null };

function planned(slot: number, pillars: string[]): { requests: PlannedRequest[]; searches: PlannedSearch[] } {
  const searches = planBeatRun(slot, pillars);
  const requests: PlannedRequest[] = [];
  const feedOf: Record<PlannedSearch["source"], BeatFeedKey> = {
    douyin: "beat_douyin",
    xiaohongshu: "beat_xiaohongshu",
    bilibili: "beat_bilibili",
    weibo: "beat_weibo",
    tiktok: "beat_tiktok",
    youtube: "beat_youtube",
    news: "beat_news",
  };
  const endpoint: Record<string, string> = {
    douyin: "POST /api/v1/douyin/billboard/fetch_hot_total_video_list {keyword, date_window:168, page_size:30} (+ fetch_video_search_v1 when under 10 come back)",
    xiaohongshu: "GET /api/v1/xiaohongshu/app_v2/search_notes {keyword, sort_type:popularity_descending, time_filter:一周内}",
    bilibili: "GET /api/v1/bilibili/web/fetch_general_search {keyword, order:click, page_size:42, pubtime last 72h}",
    tiktok: "GET /api/v1/tiktok/app/v3/fetch_video_search_result {keyword, sort_type:1, publish_time:7, count:30, region:US}",
    weibo: "GET /api/v1/weibo/app/fetch_search_all {query, search_type:60}",
  };
  requests.push({ feed: "beat_weibo", paid: "tikhub", what: "GET /api/v1/weibo/app/fetch_hot_search {category:technologynav, count:50}", beat: "tech" });
  for (const s of searches) requests.push({ feed: feedOf[s.source], paid: "tikhub", what: `${endpoint[s.source]} · "${s.query}"`, beat: s.beat });
  for (const y of planYouTube(slot)) requests.push({ feed: "beat_youtube", paid: "youtube", what: `search.list q="${y.q}" publishedAfter=72h order=viewCount regionCode=HK relevanceLanguage=${y.lang === "zh" ? "zh-Hant" : "en"} + videos.list + channels.list`, beat: null });
  for (const n of planNews(slot)) for (const ed of ["HK", "TW"]) requests.push({ feed: "beat_news", paid: "free", what: `Google News ${ed} "${n.q}"`, beat: n.beat });
  requests.push({ feed: "beat_crypto", paid: "free", what: "CoinGecko /coins/markets top 100 + /search/trending", beat: "crypto" });
  return { requests, searches };
}

/** Run one paid or free call, counting it and never letting it throw. */
async function call(label: string, errors: string[], fn: () => Promise<HotRow[]>): Promise<HotRow[]> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[beats] ${label}`, msg.slice(0, 300));
    errors.push(`${label}: ${msg.slice(0, 120)}`);
    return [];
  }
}

/** Read one feed's sources this run. */
async function fetchFeed(
  feed: BeatFeedKey,
  ctx: { searches: PlannedSearch[]; slot: number; budget: Budget; errors: string[] },
): Promise<{ rows: Candidate[]; tikhub: number; youtubeUnits: number; free: number }> {
  const { budget, errors } = ctx;
  const out: Candidate[] = [];
  let tikhub = 0;
  let youtubeUnits = 0;
  let free = 0;
  const add = (rows: HotRow[], hint: Beat | null, group: string, query: string | null, origin: "search" | "hot") => {
    for (const r of rows) out.push({ ...r, hint, group, query, origin: r.origin ?? origin });
  };
  const mine = (source: PlannedSearch["source"]) => ctx.searches.filter((s) => s.source === source);
  const paid = async (s: PlannedSearch, fn: () => Promise<HotRow[]>) => {
    if (!env.tikhub.configured) return [];
    if (!budget.takeTikhub(`${feed} "${s.query}"`)) return [];
    tikhub++;
    return call(`${feed} "${s.query}"`, errors, fn);
  };

  switch (feed) {
    case "beat_douyin":
      for (const s of mine("douyin")) {
        const rows = await paid(s, () => douyinBillboardSearch(s.query, { hours: 168, size: 30 }));
        add(rows, s.beat, `douyin:${s.query}`, s.query, "search");
        /* The billboard only has what its titles literally contain; a
           narrow word ("AI失业") can come back with a handful. Then 抖音's
           own search for the same word, most liked this week — eight
           videos by what they are about, without play counts. One more
           request, only when needed, still inside the run's cap. */
        if (rows.length < 10) add(await paid(s, () => douyinVideoSearch(s.query, { days: 7 })), s.beat, `douyin-search:${s.query}`, s.query, "search");
      }
      break;
    case "beat_xiaohongshu":
      for (const s of mine("xiaohongshu")) add(await paid(s, () => xiaohongshuSearchNotes(s.query, { sort: "popularity_descending", time: "一周内" })), s.beat, `xhs:${s.query}`, s.query, "search");
      break;
    case "beat_bilibili":
      for (const s of mine("bilibili")) add(await paid(s, () => bilibiliSearchVideos(s.query, { order: "click", sinceHours: 72, size: 42 })), s.beat, `bili:${s.query}`, s.query, "search");
      break;
    case "beat_tiktok":
      for (const s of mine("tiktok")) add(await paid(s, () => tiktokVideoSearch(s.query, { days: 7, count: 30 })), s.beat, `tiktok:${s.query}`, s.query, "search");
      break;
    case "beat_weibo": {
      /* 微博's own 科技 hot list: fifty tech topics with their search index,
         the platform's own answer to "what in tech is hot". */
      const list: PlannedSearch = { source: "weibo", beat: "tech", query: "科技热搜", lang: "zh" };
      add(await paid(list, () => weiboHotSearch("technologynav", 50)), "tech", "weibo:hot", null, "hot");
      for (const s of mine("weibo")) add(await paid(s, () => weiboHotPosts(s.query)), s.beat, `weibo:${s.query}`, s.query, "search");
      break;
    }
    case "beat_youtube":
      if (!env.youtube.configured) break;
      for (const y of planYouTube(ctx.slot)) {
        if (!budget.takeYouTube(`${feed} "${y.q}"`)) continue;
        youtubeUnits += 102;
        const vids = await call(`youtube "${y.q}"`, errors, async () => {
          const found = await searchVideos(y.q, { hours: 72, limit: 50, regionCode: "HK", relevanceLanguage: y.lang === "zh" ? "zh-Hant" : "en" });
          /* The channels' subscriber counts, one more unit for up to fifty:
             what "×N 粉丝量" is measured against, as on 抖音 and TikTok. A
             channel that hides its count reads 0 and gets none. */
          const subs = new Map((await channelsById(found.map((v) => v.channelId)).catch(() => [])).map((c) => [c.id, c.subscribers]));
          return found.map((v) => ({
            phrase: v.title,
            heat: v.views,
            heatLabel: null,
            url: `https://www.youtube.com/watch?v=${v.id}`,
            thumbnail: v.thumbnail,
            extra: v.channelTitle,
            stats: { views: v.views, likes: v.likes, comments: v.comments, likeRate: v.views ? v.likes / v.views : null, fans: subs.get(v.channelId) || null, publishedAt: v.publishedAt },
          }));
        });
        add(vids, null, `youtube:${y.lang}`, y.q, "search");
      }
      break;
    case "beat_news":
      for (const n of planNews(ctx.slot)) {
        for (const ed of ["HK", "TW"] as NewsEdition[]) {
          free++;
          add(await call(`news ${ed} "${n.q}"`, errors, () => googleNewsSearch(n.q, ed, 30)), n.beat, `news:${n.beat}`, n.q, "search");
        }
      }
      break;
    case "beat_crypto":
      free += 2;
      add(await call("coingecko", errors, () => cryptoMarket(FEED_SIZE)), "crypto", "crypto", null, "hot");
      break;
  }
  return { rows: out, tikhub, youtubeUnits, free };
}

/** Pick thirty in order, no beat past its cap while others still have rows. */
function balanced<T extends { beat?: Beat | null }>(rows: T[], size = FEED_SIZE, cap = BEAT_CAP): T[] {
  const out: T[] = [];
  const n: Partial<Record<string, number>> = {};
  for (const r of rows) {
    if (out.length >= size) break;
    const b = r.beat ?? "none";
    if ((n[b] ?? 0) >= cap) continue;
    n[b] = (n[b] ?? 0) + 1;
    out.push(r);
  }
  // Not enough of the other beats to fill it: top up in order, caps off.
  for (const r of rows) {
    if (out.length >= size) break;
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

const NOTES: Partial<Record<BeatFeedKey, string>> = {
  beat_youtube: "YouTube 近三天播放最多的赛道视频（中英文各一组关键词轮换）。",
  beat_tiktok: "TikTok 在香港用不了，这里是美国区英文关键词的热门视频。",
  beat_news: "港台新闻，近两天。",
};

/**
 * One feed, end to end: read, merge with the last run's recent rows, rank,
 * mark, keep thirty, write the researcher's line and marks, store.
 */
async function buildFeed(
  feed: BeatFeedKey,
  ctx: {
    searches: PlannedSearch[];
    slot: number;
    budget: Budget;
    pillars: string[];
    seen: RelevanceMap;
    tenantId: string;
    brief: () => Promise<StudioBrief>;
    now: number;
  },
): Promise<BeatReport> {
  const errors: string[] = [];
  const got = await fetchFeed(feed, { searches: ctx.searches, slot: ctx.slot, budget: ctx.budget, errors });
  const report: BeatReport = {
    feed,
    rows: 0,
    byBeat: { ai: 0, crypto: 0, tech: 0, biz: 0 },
    classified: 0,
    kept: 0,
    carried: 0,
    tikhub: got.tikhub,
    youtubeUnits: got.youtubeUnits,
    free: got.free,
    model: 0,
    examples: [],
    errors,
  };
  const prev = await latestStored(feed).catch(() => null);
  const seenAt = new Date(ctx.now).toISOString();
  const fresh: Candidate[] = got.rows.map((r) => ({ ...r, seenAt }));

  /* Last run's rows that are still recent: what the rotation found for the
     beats this run did not search. Only rows found by a search; a chart row
     that has left the chart is no longer hot. Their numbers are as they
     were then, and `seenAt` says when. */
  const carried: Candidate[] =
    CARRY.has(feed) && prev
      ? prev.rows
          .filter((r) => r.origin !== "hot" && r.seenAt && ctx.now - Date.parse(r.seenAt) < CARRY_MS)
          .map((r) => ({ ...r, hint: r.beat ?? null, group: `carried:${r.query ?? ""}`, carried: true }))
      : [];

  const windowMs = FRESH_DAYS[feed] * 86_400_000;
  /* YouTube and TikTok searches in English reach Hindi stock tips and
     Burmese AI-tool clips; the studio's audience reads Chinese and
     English, so a title or an account in another script is not theirs
     (`foreignScript`). */
  const merged = dedupe([...fresh, ...carried]).filter((c) => !foreignScript(c) && !hashtagsOnly(c.phrase));
  const all = (feed === "beat_news" ? clusterNews(merged) : merged).filter((c) => {
    if (!windowMs) return true;
    const h = ageHours(c, ctx.now);
    // A chart row has no date; it is on the chart now, which is the point.
    return h === null || h * 3_600_000 <= windowMs;
  });
  if (!all.length) {
    report.note = got.rows.length ? "这次搜到的都不够新。" : errors.length ? "这个平台这次没给数据。" : "这次什么都没搜到。";
    return report;
  }

  /* A carried row is ranked with the group it came from last time; mixing
     groups across runs is fine, since each group is ranked in itself. */
  const ranked = rank(feed, all, ctx.now);
  /* Retellings of a story a better row tells go last (`echoesOf`), before
     the rows sent to the classifier are chosen, so they are marked last too. */
  const echoes = feed === "beat_crypto" ? new Set<Candidate>() : echoesOf(ranked);
  const ordered = [...ranked.filter((c) => !echoes.has(c)), ...ranked.filter((c) => echoes.has(c))];
  const top = feed === "beat_crypto" ? ranked.slice(0, FEED_SIZE) : spread(ordered, CLASSIFY_TOP);
  const pillars = ctx.pillars.length ? ctx.pillars : FOCUS_FALLBACK;
  const { relevance, counts } = await classifyHot(feed, top, {
    prev: { ...ctx.seen, ...(prev?.relevance ?? {}) },
    pillars,
    onUsage: meterFor(ctx.tenantId),
  });
  report.model = counts.model;
  report.classified = top.length;
  report.carried = top.filter((c) => c.carried).length;

  /* On a beat at score 2 or more first; score 1 ("touches it") only to fill.
     With no marks at all (the classifier was down), the search's own beat
     stands, and the list is stored unmarked so the screen says so. */
  const marked = top
    .map((c) => {
      const mark = relevance?.[c.phrase] ?? null;
      const beat = relevance ? beatOf(mark) : c.hint;
      return { c, mark, beat };
    })
    .filter((x) => x.beat !== null);
  report.kept = marked.length;
  const strong = marked.filter((x) => !relevance || (x.mark?.s ?? 0) >= 2);
  const weak = marked.filter((x) => relevance && (x.mark?.s ?? 0) < 2);
  /* Stories of their own first, squarest first; retellings only to fill. */
  const own = (x: { c: Candidate }) => !echoes.has(x.c);
  const chosen = balanced(
    [...strong.filter(own), ...weak.filter(own), ...strong.filter((x) => !own(x)), ...weak.filter((x) => !own(x))].map((x) => ({ ...x, beat: x.beat })),
    FEED_SIZE,
    feed === "beat_crypto" ? FEED_SIZE : BEAT_CAP,
  );
  const rows: HotRow[] = chosen.map(({ c, beat }) => {
    /* The candidate's working fields stay out of storage. */
    const { hint: _hint, group: _group, carried: _carried, ...row } = c;
    void _hint;
    void _group;
    void _carried;
    return { ...row, beat };
  });
  const rel: RelevanceMap | null = relevance ? Object.fromEntries(rows.filter((r) => relevance[r.phrase]).map((r) => [r.phrase, relevance[r.phrase]])) : null;
  for (const r of rows) if (r.beat) report.byBeat[r.beat]++;
  report.rows = rows.length;
  report.examples = rows.slice(0, 3);
  if (!rows.length) {
    report.note = "搜到的内容都不在四个赛道上。";
    return report;
  }

  const [summary, judged] = await Promise.all([
    summarizeHot(feed, rows, rel),
    feed === "beat_crypto" ? Promise.resolve<Judged>({}) : judgeHot(ctx.tenantId, feed, rows, ctx.now, { brief: ctx.brief }).catch(() => null),
  ]);
  const note = [NOTES[feed], ctx.budget.refused.some((w) => w.startsWith(feed)) ? "本轮请求额度用完，部分关键词没搜。" : null].filter(Boolean).join(" ") || null;
  report.note = note;
  await db.insert(hotSnapshots).values({ id: newId("hot"), platform: feed, rows, note, summary, judged, relevance: rel, fetchedAt: new Date(ctx.now) });
  Object.assign(ctx.seen, rel ?? {});
  return report;
}

/**
 * The run's own row in `hot_snapshots`: platform "beat_run", no rows, the
 * feeds it set out to read in `note` (comma-separated) and, once it is done,
 * its request counts in `summary` — the cost log, one row per run.
 *
 * Written before the first request, because the age guard reads it. A feed
 * that comes back with nothing stores no row of its own (a platform down,
 * TikHub refusing, every word dragging in only off-beat posts), and the
 * guard used to look at the feed's own row alone: that feed was due again
 * the next hour, and the next, buying the same failing searches up to 24
 * times a day instead of eight. Now a feed waits its three hours from the
 * last time it was tried, whatever came of it.
 */
const RUN_KEY = "beat_run";

/** When a feed was last stored, or last tried by a run, whichever is later. */
async function lastTried(feed: string): Promise<{ at: number; stored: boolean } | null> {
  const [row] = await db
    .select({ at: hotSnapshots.fetchedAt, platform: hotSnapshots.platform })
    .from(hotSnapshots)
    .where(or(eq(hotSnapshots.platform, feed), and(eq(hotSnapshots.platform, RUN_KEY), sql`(',' || ${hotSnapshots.note} || ',') like ${`%,${feed},%`}`)))
    // On a tie (the run's row and the feed's carry the same time) the feed's own row wins.
    .orderBy(desc(hotSnapshots.fetchedAt), sql`${hotSnapshots.platform} = ${feed} desc`)
    .limit(1);
  return row ? { at: row.at.getTime(), stored: row.platform === feed } : null;
}

export type BeatRunResult = {
  slot: number;
  /** The channel's subjects this run searched with (Creator voice note). */
  pillars: string[];
  reports: BeatReport[];
  tikhub: number;
  tikhubCap: number;
  youtubeUnits: number;
  free: number;
  planned: PlannedRequest[];
  refused: string[];
};

/**
 * Every beat feed that is due, then the cross-platform top.
 *
 *   everyHours  how often the feeds are refreshed (default 3, env
 *               `RESEARCH_BEAT_EVERY_HOURS`); a feed stored or tried more
 *               recently than that, less ten minutes of slack, is left alone
 *               unless `force`
 *   tikhubCap   the most TikHub requests this run may make (default 30, env
 *               `RESEARCH_BEAT_TIKHUB_CAP`); checked before each call
 *   ytSearches  the most YouTube searches this run (default 2, env
 *               `RESEARCH_BEAT_YOUTUBE_SEARCHES`)
 *   dry         plan only: the requests that would be made, none made
 *   only        just these feeds
 *   seen        marks made earlier in the same run (the hourly charts), reused
 *   slot        the rotation slot to plan (default: now's); for previewing or
 *               replaying which words a run asks
 */
export async function collectBeats(
  opts: { force?: boolean; dry?: boolean; only?: BeatFeedKey[]; everyHours?: number; tikhubCap?: number; ytSearches?: number; seen?: RelevanceMap; tenantId?: string; now?: number; slot?: number } = {},
): Promise<BeatRunResult> {
  const now = opts.now ?? Date.now();
  const everyHours = opts.everyHours ?? (Number(process.env.RESEARCH_BEAT_EVERY_HOURS) || BEAT_EVERY_HOURS_DEFAULT);
  const tikhubCap = opts.tikhubCap ?? (Number(process.env.RESEARCH_BEAT_TIKHUB_CAP) || 30);
  const ytCap = opts.ytSearches ?? (Number(process.env.RESEARCH_BEAT_YOUTUBE_SEARCHES) || 2);
  const tenantId = opts.tenantId ?? HOT_TENANT;
  const slot = opts.slot ?? beatSlot(now, everyHours);
  const pillars = await channelFocus(tenantId).catch(() => FOCUS_FALLBACK);
  const { requests, searches } = planned(slot, pillars);

  const gap = Math.max(20, everyHours * 60 - 10) * 60_000;
  const feeds = BEAT_FEEDS.map((f) => f.key).filter((k) => !opts.only?.length || opts.only.includes(k));
  const due: BeatFeedKey[] = [];
  const skipped: BeatReport[] = [];
  for (const feed of feeds) {
    const last = opts.force ? null : await lastTried(feed).catch(() => null);
    if (last && now - last.at < gap) {
      const ago = Math.round((now - last.at) / 60_000);
      skipped.push({ feed, rows: 0, byBeat: { ai: 0, crypto: 0, tech: 0, biz: 0 }, classified: 0, kept: 0, carried: 0, tikhub: 0, youtubeUnits: 0, free: 0, model: 0, skipped: last.stored ? `stored ${ago} min ago` : `tried ${ago} min ago (nothing stored)`, examples: [], errors: [] });
    } else due.push(feed);
  }
  const plannedDue = requests.filter((r) => due.includes(r.feed));
  const budget = new Budget(tikhubCap, ytCap);
  if (opts.dry || !due.length) {
    return { slot, pillars, reports: skipped, tikhub: 0, tikhubCap, youtubeUnits: 0, free: 0, planned: plannedDue, refused: [] };
  }

  /* The studio's brief for the researcher's marks, read once for the run. */
  let brief: Promise<StudioBrief> | null = null;
  const briefOnce = () =>
    (brief ??= studioBrief(tenantId).catch((err: unknown) => {
      brief = null;
      throw err;
    }));
  const seen: RelevanceMap = opts.seen ?? {};
  /* The run's row, before any request (see `RUN_KEY`). If it cannot be
     written the run does not go ahead: without it a failing feed would be
     retried every hour. */
  const runId = newId("hot");
  await db.insert(hotSnapshots).values({ id: runId, platform: RUN_KEY, rows: [], note: due.join(","), summary: `slot ${slot}: running`, judged: null, relevance: null, fetchedAt: new Date(now) });
  /* The feeds in parallel (each one's own requests in turn): a run is a
     couple of minutes rather than ten. The budget is checked and taken in
     one synchronous step before each call, so parallel feeds cannot
     overspend it. */
  const reports = await Promise.all(
    due.map((feed) =>
      buildFeed(feed, { searches, slot, budget, pillars, seen, tenantId, brief: briefOnce, now }).catch((err: unknown) => {
        console.error(`[beats] ${feed} failed`, err);
        return { feed, rows: 0, byBeat: { ai: 0, crypto: 0, tech: 0, biz: 0 }, classified: 0, kept: 0, carried: 0, tikhub: 0, youtubeUnits: 0, free: 0, model: 0, note: "failed", examples: [], errors: [String(err).slice(0, 200)] } as BeatReport;
      }),
    ),
  );

  /* The first tab's top across platforms, with its own line, stored as
     "beat_all" so the page and the brief read it in one query. Built from
     what is now stored (charts and feeds), the same way the page builds it. */
  try {
    const lists = (await storedAll()) as Lists;
    const top = acrossPlatforms(lists, { limit: 40 }).map((r) => {
      const { from, rank: listRank, mark: _m, chart: _c, feedRank: _f, ...row } = r;
      void _m;
      void _c;
      void _f;
      return { ...row, list: from, listRank };
    });
    if (top.length) {
      const summary = await summarizeHot("beat_all", top, null);
      const byBeat = BEATS.map((b) => `${b.zh} ${top.filter((r) => r.beat === b.key).length}`).join(" · ");
      await db.insert(hotSnapshots).values({ id: newId("hot"), platform: "beat_all", rows: top, note: byBeat, summary, judged: null, relevance: null, fetchedAt: new Date(now) });
    }
  } catch (err) {
    console.error("[beats] beat_all", err);
  }

  const youtubeUnits = reports.reduce((n, r) => n + r.youtubeUnits, 0);
  const stored = reports.filter((r) => r.rows > 0).map((r) => r.feed);
  await db
    .update(hotSnapshots)
    .set({
      summary: `slot ${slot}: TikHub ${budget.tikhub}/${tikhubCap} · YouTube ${youtubeUnits}u · stored ${stored.length}/${due.length}${stored.length < due.length ? ` (none for ${due.filter((f) => !stored.includes(f)).join(", ")})` : ""}${budget.refused.length ? ` · over the cap: ${budget.refused.length}` : ""}`,
    })
    .where(eq(hotSnapshots.id, runId))
    .catch((err: unknown) => console.error("[beats] run row", err));

  return {
    slot,
    pillars,
    reports: [...reports, ...skipped],
    tikhub: budget.tikhub,
    tikhubCap,
    youtubeUnits,
    free: reports.reduce((n, r) => n + r.free, 0),
    planned: plannedDue,
    refused: budget.refused,
  };
}
