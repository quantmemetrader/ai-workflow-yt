import "server-only";
import { XMLParser } from "fast-xml-parser";
import type { HotRow } from "@/lib/research/platform-catalog";

/**
 * The two free sources the beat feeds read besides the paid platforms.
 *
 *   Google News search, as RSS: the Hong Kong and Taiwan editions, one
 *   query per beat ("比特幣 OR 以太坊 OR 加密貨幣 when:2d"). The day's
 *   reporting on the studio's subjects, in the region's own outlets. No
 *   engagement numbers exist for a news story; the feed ranks these by how
 *   recent they are and where Google placed them.
 *
 *   CoinGecko's public API: what crypto traders are looking up right now
 *   (`/search/trending`) and the day's biggest moves among the top hundred
 *   coins (`/coins/markets`). The 加密市场 tab, and the numbers behind a
 *   "bitcoin at a new high" topic.
 *
 * Neither needs a key. Both are read at most once per beat run (every three
 * hours), far inside their public rate limits.
 */

const UA = "Mozilla/5.0 (compatible; Tengya/1.0; +studio research)";

/* ----------------------------------------------------------- Google News */

export type NewsEdition = "HK" | "TW";
const EDITION: Record<NewsEdition, string> = {
  HK: "hl=zh-HK&gl=HK&ceid=HK:zh-Hant",
  TW: "hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
};

const text = (v: unknown): string | null => {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "#text" in v) return text((v as { "#text": unknown })["#text"]);
  return null;
};

/**
 * One Google News search, newest reporting first as Google ranks it.
 *
 * The feed's title is "headline - Outlet"; the outlet is split off into the
 * row's second line. The link is Google's own redirect to the story.
 */
export async function googleNewsSearch(q: string, edition: NewsEdition = "HK", limit = 40): Promise<HotRow[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${EDITION[edition]}`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!res.ok) throw new Error(`Google News answered ${res.status}`);
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(await res.text()) as {
    rss?: { channel?: { item?: unknown } };
  };
  const raw = doc.rss?.channel?.item;
  const items = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];
  const out: HotRow[] = [];
  for (const item of items.slice(0, limit)) {
    const title = text(item.title);
    // Quote pages ("… 股價、新聞、報價和記錄", "$美光科技 (MU.US)$") are not news.
    if (!title || /(股價|報價)[、，,].*(新聞|記錄|报价)|^\$[^$]+\$/.test(title)) continue;
    const outlet = text(item.source);
    const headline = outlet && title.endsWith(` - ${outlet}`) ? title.slice(0, -(outlet.length + 3)) : title.replace(/\s+-\s+[^-]{1,30}$/, "");
    const at = text(item.pubDate);
    const when = at ? new Date(at) : null;
    out.push({
      phrase: headline.trim().slice(0, 140),
      heat: null,
      heatLabel: null,
      url: text(item.link),
      thumbnail: null,
      extra: [outlet, edition === "TW" ? "台湾" : null].filter(Boolean).join(" · ") || null,
      stats: { publishedAt: when && !Number.isNaN(when.getTime()) ? when.toISOString() : null },
    });
  }
  return out;
}

/* ------------------------------------------------------------- CoinGecko */

const CG = "https://api.coingecko.com/api/v3";

async function cg<T>(path: string): Promise<T> {
  const res = await fetch(CG + path, { headers: { "User-Agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!res.ok) throw new Error(`CoinGecko ${path.split("?")[0]} answered ${res.status}`);
  return (await res.json()) as T;
}

type Market = {
  id: string;
  symbol: string;
  name: string;
  image?: string;
  current_price?: number | null;
  market_cap?: number | null;
  market_cap_rank?: number | null;
  total_volume?: number | null;
  price_change_percentage_24h?: number | null;
};
type Trending = {
  coins?: {
    item?: {
      id?: string;
      name?: string;
      symbol?: string;
      market_cap_rank?: number | null;
      thumb?: string;
      large?: string;
      slug?: string;
      score?: number;
      data?: { price?: number | string; price_change_percentage_24h?: { usd?: number }; market_cap?: string; total_volume?: string };
    };
  }[];
};

/** "$1,546,713,482" → 1546713482. */
const dollars = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^\d.]/g, "")) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Stablecoins move by fractions of a cent; a "biggest mover" list of them is noise. */
const STABLE = /^(usdt|usdc|dai|fdusd|usde|usds|tusd|pyusd|usdd|busd|frax|gusd|lusd|susds|usdtb|usd1|rlusd|bsc-usd|eurc|xaut|paxg)$/i;

const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

/**
 * The 加密市场 list: bitcoin and ether first (the market everything else is
 * read against), then what traders are searching on CoinGecko right now,
 * then the day's biggest moves among the top hundred coins, to thirty.
 * Each row carries price, 24-hour change, market cap and its rank.
 */
export async function cryptoMarket(limit = 30): Promise<HotRow[]> {
  const [markets, trending] = await Promise.all([
    cg<Market[]>("/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&price_change_percentage=24h"),
    cg<Trending>("/search/trending").catch(() => ({ coins: [] }) as Trending),
  ]);
  const byId = new Map(markets.map((m) => [m.id, m]));
  const rows: HotRow[] = [];
  const seen = new Set<string>();
  const push = (id: string, fallback: Partial<Market> & { name: string; symbol: string }, why: string, origin: "hot" | "search") => {
    if (seen.has(id) || rows.length >= limit) return;
    seen.add(id);
    const m = byId.get(id);
    const price = m?.current_price ?? fallback.current_price ?? null;
    const change = m?.price_change_percentage_24h ?? fallback.price_change_percentage_24h ?? null;
    const cap = m?.market_cap ?? fallback.market_cap ?? null;
    const capRank = m?.market_cap_rank ?? fallback.market_cap_rank ?? null;
    rows.push({
      phrase: `${fallback.name} (${fallback.symbol.toUpperCase()})`,
      heat: cap,
      heatLabel: change != null ? pct(change) : null,
      url: `https://www.coingecko.com/en/coins/${id}`,
      thumbnail: m?.image ?? fallback.image ?? null,
      extra: why,
      origin,
      stats: { price, change24h: change, marketCap: cap, volume: m?.total_volume ?? fallback.total_volume ?? null, capRank },
    });
  };
  for (const id of ["bitcoin", "ethereum"]) {
    const m = byId.get(id);
    if (m) push(id, m, "市值前二", "hot");
  }
  (trending.coins ?? []).forEach((c, i) => {
    const it = c.item;
    if (!it?.id || !it.name || !it.symbol) return;
    push(
      it.id,
      {
        name: it.name,
        symbol: it.symbol,
        image: it.large ?? it.thumb,
        current_price: dollars(it.data?.price),
        price_change_percentage_24h: it.data?.price_change_percentage_24h?.usd ?? null,
        market_cap: dollars(it.data?.market_cap),
        market_cap_rank: it.market_cap_rank ?? null,
        total_volume: dollars(it.data?.total_volume),
      },
      `CoinGecko 热搜第 ${i + 1}`,
      "hot",
    );
  });
  const movers = markets
    .filter((m) => !STABLE.test(m.symbol) && typeof m.price_change_percentage_24h === "number")
    .sort((a, b) => Math.abs(b.price_change_percentage_24h!) - Math.abs(a.price_change_percentage_24h!));
  for (const m of movers) push(m.id, m, (m.price_change_percentage_24h ?? 0) >= 0 ? "24 小时涨幅居前" : "24 小时跌幅居前", "hot");
  return rows;
}
