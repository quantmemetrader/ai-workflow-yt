/**
 * The platforms the Trends strip can switch between, in a form the browser
 * may hold.
 *
 * `lib/research/platforms.ts` reads the lists and is `server-only`; the strip
 * has to draw the tabs before anybody has picked one, so the names live here
 * where both sides can import them. `HotRow` is here for the same reason: the
 * readers in `lib/social/tikhub.ts` produce it and the strip draws it.
 */
export const PLATFORMS = [
  { key: "google", label: "Google", zh: "Google 热搜", kind: "search", metered: false, unavailable: false },
  { key: "youtube", label: "YouTube", zh: "YouTube", kind: "video", metered: false, unavailable: false },
  /* The four 抖音 creator billboards: real videos with plays, likes, like
     rate and the account's follower count, filtered to the studio's own
     verticals (财经, 科技). The breakout list is videos from small accounts
     that took off, which is the earliest sign a topic works. */
  { key: "dy_breakout", label: "Breakouts", zh: "低粉爆款", kind: "video", metered: true, unavailable: false },
  { key: "dy_finance", label: "Douyin finance", zh: "抖音财经", kind: "video", metered: true, unavailable: false },
  { key: "dy_tech", label: "Douyin tech", zh: "抖音科技", kind: "video", metered: true, unavailable: false },
  { key: "dy_rising", label: "Rising", zh: "上升热点", kind: "search", metered: true, unavailable: false },
  { key: "douyin", label: "Douyin", zh: "抖音", kind: "search", metered: true, unavailable: false },
  { key: "xiaohongshu", label: "Rednote", zh: "小红书", kind: "note", metered: true, unavailable: false },
  { key: "weibo", label: "Weibo", zh: "微博", kind: "search", metered: true, unavailable: false },
  { key: "bilibili", label: "Bilibili", zh: "B站", kind: "search", metered: true, unavailable: false },
  { key: "tiktok", label: "TikTok", zh: "TikTok", kind: "video", metered: true, unavailable: false },
  { key: "wechat", label: "WeChat", zh: "微信", kind: "search", metered: false, unavailable: true },
] as const;

export type PlatformKey = (typeof PLATFORMS)[number]["key"];
export const isPlatformKey = (v: unknown): v is PlatformKey =>
  typeof v === "string" && PLATFORMS.some((p) => p.key === v);

/* ------------------------------------------------------------ the beats */

/**
 * The four subjects the studio makes videos about.
 *
 * The owner's words: "keep it related to business and tech & crypto, AI and
 * stuff". Business and tech alone was the first cut (`Relevance` below still
 * reads those marks); AI and crypto are their own beats now because they are
 * most of what the channel films and a viewer looking for "加密" should not
 * have to find it under 科技.
 */
export type Beat = "ai" | "crypto" | "tech" | "biz";
export const BEATS: readonly { key: Beat; zh: string; en: string }[] = [
  { key: "ai", zh: "AI", en: "AI" },
  { key: "crypto", zh: "加密", en: "Crypto" },
  { key: "tech", zh: "科技", en: "Tech" },
  { key: "biz", zh: "商业", en: "Business" },
];
export const isBeat = (v: unknown): v is Beat => v === "ai" || v === "crypto" || v === "tech" || v === "biz";

/**
 * The beat feeds: per platform, what the studio's own subjects are doing
 * there, searched at the source rather than filtered out of a hot list.
 *
 * Why these exist. A platform's hot list is that platform's everything, and
 * filtering it on screen left "抖音财经 3 / 28", "小红书 0 / 20", "YouTube 0 /
 * 24": three rows of business on a good day. The owner: "in content don't
 * just have 2-3 stuff … frontend filtered, don't do that". So every three
 * hours `lib/research/beat-feeds.ts` searches each platform for the beats
 * (paid TikHub search, the YouTube Data API, Google News, CoinGecko), keeps
 * the thirty that did best recently, marks them and stores them here under
 * these keys, next to the platforms' own lists (`hot_snapshots`).
 *
 * `tab` is the platform tab on the Research page the feed fills; `hot` are
 * that platform's own hourly lists, whose on-beat rows are shown at the top
 * of the tab as 上榜 ("on the platform's chart") — the lists stay what they
 * were, the proof that a subject is not only searchable but pushed.
 */
export const BEAT_FEEDS = [
  { key: "beat_douyin", tab: "douyin", mark: "douyin", label: "Douyin", zh: "抖音", kind: "video", hot: ["dy_breakout", "dy_finance", "dy_tech", "dy_rising", "douyin"] },
  { key: "beat_xiaohongshu", tab: "xiaohongshu", mark: "xiaohongshu", label: "Rednote", zh: "小红书", kind: "note", hot: ["xiaohongshu"] },
  { key: "beat_weibo", tab: "weibo", mark: "weibo", label: "Weibo", zh: "微博", kind: "post", hot: ["weibo"] },
  { key: "beat_bilibili", tab: "bilibili", mark: "bilibili", label: "Bilibili", zh: "B站", kind: "video", hot: ["bilibili"] },
  { key: "beat_tiktok", tab: "tiktok", mark: "tiktok", label: "TikTok", zh: "TikTok", kind: "video", hot: ["tiktok"] },
  { key: "beat_youtube", tab: "youtube", mark: "youtube", label: "YouTube", zh: "YouTube", kind: "video", hot: ["youtube"] },
  { key: "beat_news", tab: "news", mark: "google", label: "News", zh: "新闻", kind: "news", hot: ["google"] },
  { key: "beat_crypto", tab: "crypto", mark: "crypto", label: "Crypto market", zh: "加密市场", kind: "market", hot: [] },
] as const satisfies readonly { key: string; tab: string; mark: string; label: string; zh: string; kind: string; hot: readonly PlatformKey[] }[];

export type BeatFeedKey = (typeof BEAT_FEEDS)[number]["key"];
export type BeatTab = (typeof BEAT_FEEDS)[number]["tab"];
export const isBeatFeedKey = (v: unknown): v is BeatFeedKey => typeof v === "string" && BEAT_FEEDS.some((f) => f.key === v);

/** Any stored list: a platform's own, or a beat feed. */
export type ListKey = PlatformKey | BeatFeedKey;
export const isListKey = (v: unknown): v is ListKey => isPlatformKey(v) || isBeatFeedKey(v);

/** A list's name in the studio's language, whichever kind it is. */
export function listName(key: string, zh: boolean): string {
  const p = PLATFORMS.find((x) => x.key === key);
  if (p) return zh ? p.zh : p.label;
  const f = BEAT_FEEDS.find((x) => x.key === key);
  if (f) return zh ? `${f.zh}赛道` : `${f.label} beats`;
  return key;
}

/**
 * One row of a platform's own hot list, in one shape.
 *
 * Five platforms, five ideas of what "hot" is: 抖音 counts views, 微博 a
 * search index, 小红书 "people looking", TikTok plays. The number is kept as
 * the platform gave it and labelled in its own words where it had any,
 * because a heat score from 微博 and a view count from 抖音 are not the same
 * unit and pretending they are would be inventing a statistic.
 */
export type HotRow = {
  phrase: string;
  heat: number | null;
  /** The platform's own wording of the number, when it wrote one. */
  heatLabel: string | null;
  url: string | null;
  thumbnail: string | null;
  /** A second line: the creator, the hashtag, the category. */
  extra: string | null;
  /** The numbers the platform gave for this row, when it is a video or
   *  a topic with counts. Absent fields were not given, never zero-filled. */
  stats?: HotStats | null;
  /* ---- beat feeds only (`BEAT_FEEDS`); absent on the platforms' own lists */
  /** The beat the row was marked as when it was stored. */
  beat?: Beat | null;
  /** How it got here: found by a beat search, or read off a platform's own
   *  chart (微博's 科技 hot list, CoinGecko's trending coins). */
  origin?: "search" | "hot" | null;
  /** The words searched for, when it was found by a search. */
  query?: string | null;
  /** When these numbers were read (a row kept from an earlier run keeps the
   *  numbers it had then, and says when). ISO. */
  seenAt?: string | null;
  /** In the cross-platform top ("beat_all") only: the feed the row is from,
   *  and its rank there. */
  list?: string | null;
  listRank?: number | null;
};

export type HotStats = {
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  /** likes ÷ views, as the platform computed it or from the two above. */
  likeRate?: number | null;
  /** The account's followers, so views ÷ followers says how far past its
   *  own audience a video travelled. */
  fans?: number | null;
  /** ISO time the video was published or the topic first appeared. */
  publishedAt?: string | null;
  /** Videos made about a topic. */
  videos?: number | null;
  /** Places climbed on the platform's list since the last snapshot. */
  rankUp?: number | null;
  /** Saves / collects (小红书 收藏, B站 收藏, 抖音 收藏). */
  saves?: number | null;
  /** A coin's market numbers (the 加密市场 feed), in US dollars. */
  price?: number | null;
  /** Percent, e.g. 12.4 for +12.4% over 24 hours. */
  change24h?: number | null;
  marketCap?: number | null;
  volume?: number | null;
  /** Market-cap rank. */
  capRank?: number | null;
};

/**
 * Whether a row is on one of the studio's beats (AI, crypto, tech,
 * business) or none.
 *
 * The studio makes business and tech videos, and most of what a platform
 * calls hot is neither — on the day this was written, 86% of 374 stored rows
 * were concerts, sport, festival greetings and memes, and even 抖音's
 * "finance" billboard led with a joke about a gold bar, because it filters by
 * the account's category rather than by what the video is about. So every
 * row is marked once, when the list is collected (`lib/research/relevance.ts`),
 * and the screen, the morning brief and the Research agent read the mark.
 *
 *   t  ai · crypto · tech · biz · other. Lists marked before AI and crypto
 *      were beats of their own say only biz or tech; `beatOf` reads those.
 *   s  how squarely: 0 unrelated, 1 touches it (a summit that may move trade,
 *      a tycoon's gossip), 2 plainly on the beat, 3 the channel could film it
 *      today (a rate move, a chip price, a model launch, a bitcoin high)
 *   tag  two to four characters naming the corner of it: 宏观, 芯片, 大模型
 *
 * Here rather than in the classifier because the browser draws the filter.
 */
export type Relevance = { t: Beat | "other"; s: 0 | 1 | 2 | 3; tag?: string };
/** Keyed by the row's phrase, the same way `judged` is. */
export type RelevanceMap = Record<string, Relevance>;

/**
 * A mark's beat, reading marks from before AI and crypto had their own.
 *
 * Lists stored before the four beats say only `biz` or `tech`; the corner
 * was in the tag ("科技 · AI", "科技 · 加密"). Those read as the beat the tag
 * names, so an old AI row still answers to the AI chip and nothing stored
 * has to be marked again.
 */
export function beatOf(r: Relevance | null | undefined): Beat | null {
  if (!r || r.t === "other" || r.s < 1) return null;
  if (r.t === "tech" || r.t === "biz") {
    const tag = (r.tag ?? "").toLowerCase();
    if (/加密|币|区块链|web3|crypto|bitcoin|nft|稳定币/.test(tag)) return "crypto";
    if (/^ai$|^ai|人工智能|大模型|aigc|智能体|机器学习/.test(tag)) return "ai";
  }
  return r.t;
}

/**
 * On the studio's beat at or above `min`.
 *
 * The screen's default view asks for 2 (plainly business or tech); the
 * morning brief's evidence pool asks for 1, so a summit that may move trade
 * can still back a topic without showing up as a row about a banquet.
 * A missing mark is not on the beat. A list with no marks at all (collected
 * before this existed, or the classifier failed) is the caller's to handle:
 * show everything, never nothing.
 */
export const onFocus = (r: Relevance | null | undefined, min: 1 | 2 | 3 = 2): boolean => !!r && r.t !== "other" && r.s >= min;

/** The words a mark is shown in: 商业 · 宏观, AI · 大模型, 加密 · 比特币. */
export function relevanceLabel(r: Relevance, zh: boolean): string {
  const b = beatOf(r);
  const meta = b ? BEATS.find((x) => x.key === b)! : null;
  const kind = meta ? (zh ? meta.zh : meta.en) : zh ? "其他" : "Other";
  // A tag that only repeats the kind ("科技 · 科技", "AI · AI") is left off.
  return r.tag && !/^(财经|商业|科技|其他|ai|加密)$/i.test(r.tag) ? `${kind} · ${r.tag}` : kind;
}
