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
};
