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
};

/**
 * Whether a row is the studio's beat: business, tech, or neither.
 *
 * The studio makes business and tech videos, and most of what a platform
 * calls hot is neither — on the day this was written, 86% of 374 stored rows
 * were concerts, sport, festival greetings and memes, and even 抖音's
 * "finance" billboard led with a joke about a gold bar, because it filters by
 * the account's category rather than by what the video is about. So every
 * row is marked once, when the list is collected (`lib/research/relevance.ts`),
 * and the screen, the morning brief and the Research agent read the mark.
 *
 *   t  biz · tech · other
 *   s  how squarely: 0 unrelated, 1 touches it (a summit that may move trade,
 *      a tycoon's gossip), 2 plainly business or tech, 3 the channel could
 *      film it today (a rate move, a chip price, an oil price change)
 *   tag  two to four characters naming the corner of it: 宏观, 芯片, 楼市
 *
 * Here rather than in the classifier because the browser draws the filter.
 */
export type Relevance = { t: "biz" | "tech" | "other"; s: 0 | 1 | 2 | 3; tag?: string };
/** Keyed by the row's phrase, the same way `judged` is. */
export type RelevanceMap = Record<string, Relevance>;

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

/** The words a mark is shown in: 财经 · 宏观, 科技 · 芯片. */
export function relevanceLabel(r: Relevance, zh: boolean): string {
  const kind = r.t === "biz" ? (zh ? "财经" : "Business") : r.t === "tech" ? (zh ? "科技" : "Tech") : zh ? "其他" : "Other";
  // A tag that only repeats the kind ("科技 · 科技") is left off.
  return r.tag && !/^(财经|商业|科技|其他)$/.test(r.tag) ? `${kind} · ${r.tag}` : kind;
}
