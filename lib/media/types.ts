/**
 * Media from the internet, one shape whichever site it came from.
 *
 * The AI editor needs, for each spoken line, the most relevant clip or
 * picture it can find anywhere — 抖音, TikTok, B站, YouTube, Pinterest, an
 * image search, the stock libraries — and it needs to say where every one of
 * them came from. Nine sources, nine payloads; this is the one record they
 * are all read into, so the editor ranks and picks without knowing which
 * site answered, and the credits can be written from the record alone.
 *
 * The rule the studio's owner set is "any source, credits given". So a
 * candidate always carries an author and a permalink, and a ready-made
 * credit string, before it can be fetched at all.
 */

export type MediaKind = "video" | "image";

export type Platform = "douyin" | "tiktok" | "bilibili" | "youtube" | "pinterest" | "bing" | "pexels" | "unsplash" | "openverse";

export type Orientation = "portrait" | "landscape" | "square";

/**
 * How the bytes are actually obtained. Opaque to the editor: only
 * `lib/media/fetch.ts` reads it.
 *
 *   direct  a file URL on the platform's CDN (抖音 play address, a Pexels
 *           MP4). Some expire within the hour, hence `expiresAt`.
 *   yt-dlp  a page yt-dlp knows how to take apart (YouTube, B站, TikTok, a
 *           Pinterest pin video). `fallbackUrl` is a direct file to try if
 *           the tool fails.
 *   image   a picture URL; `fallbackUrl` is a smaller rendition for when the
 *           original is not something a browser can show (Pinterest serves
 *           HEIC originals now and then).
 */
export type FetchHandle =
  | { via: "direct"; url: string; headers?: Record<string, string>; expiresAt?: string }
  | { via: "yt-dlp"; url: string; fallbackUrl?: string }
  | { via: "image"; url: string; fallbackUrl?: string; headers?: Record<string, string> };

export type Candidate = {
  /** `<platform>:<the platform's own id>` — stable across searches. */
  id: string;
  kind: MediaKind;
  platform: Platform;
  title: string;
  description?: string;
  /** The permalink a person can open, never a CDN address. */
  url: string;
  author: { name: string; url?: string; id?: string };
  /** A thumbnail that can be fetched right now, for a judge or a picker. */
  thumb: string;
  durationMs?: number;
  width?: number;
  height?: number;
  orientation?: Orientation;
  stats?: { views?: number; likes?: number };
  /** ISO date, when the platform said. */
  publishedAt?: string;
  handle: FetchHandle;
  /**
   * What the source says may be done with it, when it says anything:
   * "Pexels License", "Unsplash License", "CC BY 4.0". Absent for a platform
   * clip, which is quoted with credit rather than licensed. A Pinterest pin
   * whose original lives on a stock-photo site carries "stock:<domain>" so
   * the editor can steer clear.
   */
  licence?: string;
  /** Ready to print: "抖音 @作者", "YouTube · 频道", "Pinterest · pinner (via domain)". */
  credit: string;
};

/** A candidate that has been taken into the studio's own Files. */
export type Asset = {
  fileId: string;
  candidate: Candidate;
  /** The normalised file on this machine, while it is still there. */
  localPath?: string;
  credit: string;
  fetchedAt: string;
  /** Measured from the bytes actually taken, which for a windowed clip is
   * shorter than the candidate. */
  durationMs?: number;
  width?: number;
  height?: number;
  window?: { start: number; end: number };
  /** True when this run had already fetched the same clip and window. */
  cached?: boolean;
};

export type SearchOpts = {
  kind: MediaKind;
  /** Per provider. */
  limit: number;
  /** Drop anything longer, in seconds. Unset means the provider's own idea of short. */
  maxDurationS?: number;
  orientation?: Orientation | "any";
  lang?: "zh" | "en";
  /** YouTube only: "cc" asks for Creative Commons uploads through TikHub. */
  licence?: "any" | "cc";
  signal?: AbortSignal;
};

export type SearchProvider = (query: string, opts: SearchOpts) => Promise<Candidate[]>;

export function orientationOf(width?: number | null, height?: number | null): Orientation | undefined {
  if (!width || !height) return undefined;
  if (Math.abs(width - height) <= Math.max(width, height) * 0.05) return "square";
  return width > height ? "landscape" : "portrait";
}
