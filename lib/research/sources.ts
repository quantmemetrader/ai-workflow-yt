import "server-only";

/**
 * The sources the studio reads (spec §4.3, and the Sources picker the client
 * asked for on the Trends and Compare screens).
 *
 * Two kinds, and the difference matters on screen:
 *   — a **signal** gives a number over time (how much the world is talking
 *     about something);
 *   — a **news site** gives articles, which is what "links to primary sources"
 *     means and what a producer actually opens.
 *
 * Everything here is a public feed, used as published. The contract forbids
 * scraping and unofficial interfaces (Schedule A3(1)), so a source that has no
 * feed is listed as `unconfigured` with the reason, rather than quietly
 * scraped.
 */
export type SourceKind = "news" | "signal" | "platform";

export type SourceDef = {
  key: string;
  name: string;
  kind: SourceKind;
  homepage: string;
  /** A feed of everything the source publishes, if it has one. */
  feed?: string;
  /** A feed for one query. `{q}` is replaced with the encoded query. */
  search?: string;
  /** Present when the source cannot be used yet, and why. */
  blocked?: string;
  /**
   * Environment variables this source needs, any one of which will do. Unlike
   * `blocked`, which is a permanent property of the source, this is a property
   * of *this* deployment: the same source is live where the key is set and
   * unconfigured where it is not, and the sidebar should say which rather than
   * guessing.
   */
  requires?: string[];
};

export const SOURCES: SourceDef[] = [
  {
    key: "gdelt",
    name: "GDELT",
    kind: "signal",
    homepage: "https://www.gdeltproject.org",
    // Volume of worldwide coverage, normalised. Public, commercial use allowed.
    search: "https://api.gdeltproject.org/api/v2/doc/doc?query={q}&mode=timelinevol&timespan={span}&format=json",
  },
  {
    key: "googlenews",
    name: "Google News",
    kind: "news",
    homepage: "https://news.google.com",
    search: "https://news.google.com/rss/search?q={q}&hl=en-HK&gl=HK&ceid=HK:en",
  },
  {
    key: "hackernews",
    name: "Hacker News",
    kind: "signal",
    homepage: "https://news.ycombinator.com",
    search: "https://hn.algolia.com/api/v1/search_by_date?query={q}",
  },
  {
    key: "scmp",
    name: "SCMP",
    kind: "news",
    homepage: "https://www.scmp.com",
    feed: "https://www.scmp.com/rss/91/feed",
  },
  {
    key: "techcrunch",
    name: "TechCrunch",
    kind: "news",
    homepage: "https://techcrunch.com",
    feed: "https://techcrunch.com/feed/",
  },
  {
    key: "verge",
    name: "The Verge",
    kind: "news",
    homepage: "https://www.theverge.com",
    feed: "https://www.theverge.com/rss/index.xml",
  },
  {
    key: "coindesk",
    name: "CoinDesk",
    kind: "news",
    homepage: "https://www.coindesk.com",
    feed: "https://www.coindesk.com/arc/outboundfeeds/rss/",
  },
  {
    key: "nikkei",
    name: "Nikkei Asia",
    kind: "news",
    homepage: "https://asia.nikkei.com",
    // Nikkei's public feed returns an empty document from outside Japan; the
    // paid API is the supported route.
    blocked: "Nikkei's public feed returns nothing here. Needs their licensed API.",
  },
  {
    key: "bloomberg",
    name: "Bloomberg",
    kind: "news",
    homepage: "https://www.bloomberg.com",
    blocked: "No public feed. Needs a Bloomberg data licence; headlines reach us through Google News in the meantime.",
  },
  {
    key: "reuters",
    name: "Reuters",
    kind: "news",
    homepage: "https://www.reuters.com",
    blocked: "Retired their public RSS. Needs a Reuters Connect licence; headlines reach us through Google News in the meantime.",
  },
  {
    /**
     * The studio's own channels: comments, views, engagement.
     *
     * Zernio holds the OAuth grants the studio gave it, which is why this is
     * the only source here that can *write* as well as read. It is what backs
     * Content performance and the Comment inbox.
     */
    key: "zernio",
    name: "Our own channels",
    kind: "platform",
    homepage: "https://zernio.com",
    requires: ["ZERNIO_API_KEY"],
  },
  {
    /**
     * Everybody else's channels. Replaces what used to be listed here as
     * "YouTube mostPopular — needs a YouTube Data API key": that key was never
     * the blocker, and TikHub reads the same public numbers across sixteen
     * platforms rather than one.
     */
    key: "tikhub",
    name: "Other channels",
    kind: "platform",
    homepage: "https://tikhub.io",
    // Both spellings, because the client's credentials document used the
    // first one and a corrected environment should not turn the source off.
    requires: ["TIKHUB_TOKEN", "TICKHUB_TOKEN"],
  },
  {
    key: "gtrends",
    name: "Google Trends",
    kind: "signal",
    homepage: "https://trends.google.com",
    blocked:
      "Google publishes no official Trends API, and the contract rules out scrapers such as pytrends. Needs the client to confirm a licensed feed.",
  },
];

export const SOURCE_BY_KEY = new Map(SOURCES.map((s) => [s.key, s]));

/**
 * Why a source cannot be read here, or null if it can.
 *
 * Kept as one function so the sidebar, the Sources picker and the worker all
 * agree: a source is either usable, permanently blocked, or missing a key in
 * *this* environment, and the third is the only one an operator can fix.
 */
export function unavailableReason(s: SourceDef): string | null {
  if (s.blocked) return s.blocked;
  if (s.requires?.length && !s.requires.some((name) => process.env[name])) {
    return `Needs ${s.requires[0]} in the environment (Admin, Channels and credentials).`;
  }
  return null;
}

/** The sources that can actually be read today. */
export const usableSources = () => SOURCES.filter((s) => !unavailableReason(s));
