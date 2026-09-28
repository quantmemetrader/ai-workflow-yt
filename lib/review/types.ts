/**
 * The shapes the 复盘 pages draw. Client-safe (no database): the page and
 * the server both import these.
 */

export type Stats = {
  plays: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  collects: number | null;
  /** 0–1, only where a platform says so (or somebody typed it). */
  completion?: number | null;
};

export const EMPTY_STATS: Stats = { plays: null, likes: null, comments: null, shares: null, collects: null, completion: null };

export const STAT_KEYS = ["plays", "likes", "comments", "shares", "collects"] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export const STAT_LABEL: Record<StatKey | "completion", { zh: string; en: string }> = {
  plays: { zh: "播放", en: "Plays" },
  likes: { zh: "点赞", en: "Likes" },
  comments: { zh: "评论", en: "Comments" },
  shares: { zh: "转发", en: "Shares" },
  collects: { zh: "收藏", en: "Saves" },
  completion: { zh: "完播率", en: "Completion" },
};

export type AccountStats = { followers: number | null; likes: number | null; works: number | null; views: number | null };

export type AccountPost = { id: string; title: string; url: string | null; at: string | null; stats: Stats };

export type AccountView = {
  platform: "douyin" | "xiaohongshu" | "wechat_channels" | "bilibili" | "youtube" | "linkedin" | "tiktok" | "instagram" | "facebook" | "x" | "threads";
  /** A channel connected through Zernio (YouTube, LinkedIn…), read from its own sync, not TikHub. */
  connected?: boolean;
  zh: string;
  en: string;
  name: string;
  accountId: string;
  url: string | null;
  /** The newest reading with numbers, or null if there has never been one. */
  stats: AccountStats | null;
  source: "tikhub" | "manual" | null;
  at: string | null;
  /** Followers at the reading before this one (for "+12"), when there is one. */
  prevFollowers: number | null;
  /** Followers over time, oldest first (at most 30 readings). */
  followersSeries: { at: string; v: number }[];
  posts: AccountPost[];
  /** The newest attempt failed with this, and when. */
  error: string | null;
  errorAt: string | null;
  /** TikHub cannot read this account; numbers are typed in. */
  manualOnly: boolean;
};

export type PostView = {
  platform: string;
  url: string | null;
  title: string | null;
  stats: Stats | null;
  source: string | null;
  at: string | null;
  error: string | null;
  /** Likes (or plays when the platform gives plays) over time, oldest first. */
  series: { at: string; v: number }[];
  /** The account's typical post on this platform (median of its latest posts), to compare against. */
  median: Stats | null;
};

export type ReviewIdea = { title: string; why: string };

export type ProjectReview = {
  at: string;
  by: string;
  byName: string;
  verdict: string;
  good: string[];
  improve: string[];
  ideas: ReviewIdea[];
  /** When the ideas were handed to 选题 (research), if they were. */
  handedAt: string | null;
  handedBy?: string | null;
};

export function readReview(source: unknown): ProjectReview | null {
  const r = source && typeof source === "object" ? (source as { review?: unknown }).review : null;
  if (!r || typeof r !== "object" || typeof (r as ProjectReview).verdict !== "string") return null;
  const v = r as ProjectReview;
  return { ...v, good: Array.isArray(v.good) ? v.good : [], improve: Array.isArray(v.improve) ? v.improve : [], ideas: Array.isArray(v.ideas) ? v.ideas : [], handedAt: v.handedAt ?? null };
}

/** 12345 → "1.2万" in Chinese, "12.3k" otherwise; null → "—". */
export function fmtNum(n: number | null | undefined, zh: boolean): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (zh) {
    if (n >= 1e8) return `${(n / 1e8).toFixed(n >= 1e9 ? 0 : 1)}亿`;
    if (n >= 1e4) return `${(n / 1e4).toFixed(n >= 1e5 ? 0 : 1)}万`;
    return n.toLocaleString("zh-CN");
  }
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString("en-US");
}

/** Which platform a post link is on, from its address. */
export function platformOfUrl(url: string): string | null {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (/(^|\.)(douyin\.com|iesdouyin\.com)$/.test(host)) return "douyin";
  if (/(^|\.)(xiaohongshu\.com|xhslink\.com|xhslink\.cn)$/.test(host)) return "xiaohongshu";
  if (/(^|\.)(bilibili\.com|b23\.tv)$/.test(host)) return "bilibili";
  if (host === "weixin.qq.com" || host.endsWith("channels.weixin.qq.com")) return "shipinhao";
  if (/(^|\.)(youtube\.com|youtu\.be)$/.test(host)) return "youtube";
  if (/(^|\.)tiktok\.com$/.test(host)) return "tiktok";
  return null;
}

/** A publish-platform key → the own account it is posted to. */
export const ACCOUNT_OF_PLATFORM: Record<string, AccountView["platform"]> = {
  douyin: "douyin",
  xiaohongshu: "xiaohongshu",
  shipinhao: "wechat_channels",
  bilibili: "bilibili",
};

/** One upload on one of the studio's accounts, with its numbers (账号数据 · 每条视频). */
export type VideoRow = {
  /** `${platform}_${id}`, the address of its own page. */
  key: string;
  platform: string;
  title: string;
  url: string | null;
  thumb: string | null;
  at: string | null;
  stats: Stats;
  /** Plays over time (likes where the platform gives no plays), oldest first. */
  series: { at: string; v: number }[];
  seriesOf: "plays" | "likes";
  project: { id: string; title: string } | null;
};

/** Likes + comments + shares + saves over plays, when there are plays. */
export function engagement(s: Stats): number | null {
  if (!s.plays) return null;
  const n = (s.likes ?? 0) + (s.comments ?? 0) + (s.shares ?? 0) + (s.collects ?? 0);
  return n / s.plays;
}
