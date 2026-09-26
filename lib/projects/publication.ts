/**
 * "已发布": the record of where a finished project went.
 *
 * The owner uploads the cut to YouTube, 抖音, 小红书 … by hand, then presses
 * 「已发布 · 标记完成」 on the project page. That marks the project done
 * (`work_projects.status = "done"`, the same status every list already reads)
 * and keeps what was said about it — which platforms, the links, who pressed
 * it and when, a note — so the project stops sitting in Home's "in progress"
 * lists, reads 已发布 everywhere, and the links are one press away.
 *
 * **Where it lives.** Inside the project's own jsonb snapshot, at
 * `work_projects.source -> 'published'`: no new table, no migration, and it
 * travels with the row every list already selects. Undoing it removes the key
 * and puts the status back to active. To read it in SQL — one row per platform:
 *
 *   select w.id, w.title,
 *          (w.source -> 'published' ->> 'at')::timestamptz as published_at,
 *          p ->> 'key' as platform, p ->> 'url' as url
 *     from work_projects w
 *     cross join lateral jsonb_array_elements(w.source -> 'published' -> 'platforms') p
 *    where w.deleted_at is null and w.status = 'done' and w.source ? 'published';
 *
 * In code, `recentPublications` (lib/projects/published.ts) returns exactly
 * those rows for the morning brief or 研究员 to read.
 *
 * Client-safe on purpose (no database, no `server-only`): the project page's
 * popover and every card that draws the badge need the platform list and the
 * parsing, and the server needs the same rules to clean what the page sends.
 */

/** The places a video goes, in the order the popover offers them. */
export const PUBLISH_PLATFORMS = [
  { key: "youtube", zh: "YouTube", en: "YouTube" },
  { key: "douyin", zh: "抖音", en: "Douyin" },
  { key: "xiaohongshu", zh: "小红书", en: "Rednote" },
  { key: "bilibili", zh: "B站", en: "Bilibili" },
  { key: "weibo", zh: "微博", en: "Weibo" },
  { key: "tiktok", zh: "TikTok", en: "TikTok" },
  { key: "shipinhao", zh: "视频号", en: "WeChat Channels" },
  { key: "linkedin", zh: "LinkedIn", en: "LinkedIn" },
  { key: "other", zh: "其他", en: "Other" },
] as const;

export type PublishPlatform = (typeof PUBLISH_PLATFORMS)[number]["key"];

const KEYS = new Set<string>(PUBLISH_PLATFORMS.map((p) => p.key));

export function isPublishPlatform(v: unknown): v is PublishPlatform {
  return typeof v === "string" && KEYS.has(v);
}

/** A platform's name as the studio says it (抖音, 小红书, B站 …). */
export function publishPlatformName(key: string, zh: boolean): string {
  const p = PUBLISH_PLATFORMS.find((x) => x.key === key);
  return p ? (zh ? p.zh : p.en) : key;
}

/** One place it went, with the post's link when somebody gave one. */
export type PublishedPlace = { key: PublishPlatform; url: string | null };

/** The record kept at `work_projects.source.published`. */
export type Publication = {
  /** When it was marked published (ISO). */
  at: string;
  /** Who pressed it: their user id and name at the time. */
  by: string;
  byName: string;
  platforms: PublishedPlace[];
  note: string | null;
  /** The render that was out when it was marked; null when it was marked done without one. */
  fileId: string | null;
};

/** The longest link and note kept. */
export const LINK_MAX = 600;
export const NOTE_MAX = 500;

/**
 * A link as typed, cleaned: trimmed, "https://" put in front of a bare
 * "youtu.be/…", and only http(s). Empty is null (no link, which is fine);
 * anything that is not a web address is `undefined`, so the popover can say
 * so and the server can refuse it rather than store a `javascript:` link.
 */
export function cleanLink(raw: unknown): string | null | undefined {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : /^[\w-]+(\.[\w-]+)+([/?#].*)?$/.test(s) ? `https://${s}` : null;
  if (!withScheme || withScheme.length > LINK_MAX) return undefined;
  try {
    const u = new URL(withScheme);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The record out of a project's snapshot, or null. Defensive: it is jsonb a
 * hand or an older build may have written, and a card must never crash on it.
 */
export function readPublication(source: unknown): Publication | null {
  const raw = source && typeof source === "object" ? (source as { published?: unknown }).published : null;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.at !== "string" || !Number.isFinite(Date.parse(r.at))) return null;
  const platforms = Array.isArray(r.platforms)
    ? (r.platforms as unknown[])
        .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : null))
        .filter((p): p is Record<string, unknown> => p !== null && isPublishPlatform(p.key))
        .map((p) => ({ key: p.key as PublishPlatform, url: cleanLink(p.url) ?? null }))
    : [];
  return {
    at: r.at,
    by: typeof r.by === "string" ? r.by : "",
    byName: typeof r.byName === "string" ? r.byName : "",
    platforms,
    note: typeof r.note === "string" && r.note.trim() ? r.note.trim().slice(0, NOTE_MAX) : null,
    fileId: typeof r.fileId === "string" ? r.fileId : null,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "9月26日" / "Sep 26", on the studio's clock (Hong Kong, UTC+8, no summer
 * time). Plain arithmetic on a fixed offset rather than `Intl`, so the
 * server's HTML and the browser's hydration print the same thing.
 */
export function publishedDay(iso: string, zh: boolean): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const d = new Date(at + 8 * 3_600_000);
  return zh ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日` : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "YouTube、抖音" — the platforms in words, for a line of text. */
export function platformsLine(platforms: readonly { key: string }[], zh: boolean): string {
  return platforms.map((p) => publishPlatformName(p.key, zh)).join(zh ? "、" : ", ");
}

/**
 * Which platform a pasted link is on, from its address, so a link typed into
 * the one box (no platform picked) still lands on the right mark. Null when
 * the address is none the list knows.
 */
export function guessPlatform(url: string): PublishPlatform | null {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const on = (...domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));
  if (on("youtube.com", "youtu.be")) return "youtube";
  if (on("douyin.com", "iesdouyin.com")) return "douyin";
  if (on("xiaohongshu.com", "xhslink.com")) return "xiaohongshu";
  if (on("bilibili.com", "b23.tv")) return "bilibili";
  if (on("weibo.com", "weibo.cn")) return "weibo";
  if (on("tiktok.com")) return "tiktok";
  if (host === "channels.weixin.qq.com") return "shipinhao";
  if (on("linkedin.com", "lnkd.in")) return "linkedin";
  return null;
}
