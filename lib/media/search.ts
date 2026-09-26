import "server-only";
import { createHash } from "node:crypto";
import type { Candidate, MediaKind, Orientation, Platform, SearchOpts, SearchProvider } from "@/lib/media/types";
import { searchDouyin } from "@/lib/media/sources/douyin";
import { searchTikTok } from "@/lib/media/sources/tiktok";
import { searchBilibili } from "@/lib/media/sources/bilibili";
import { searchYouTube } from "@/lib/media/sources/youtube";
import { searchPinterest } from "@/lib/media/sources/pinterest";
import { searchBing } from "@/lib/media/sources/bing";
import { searchStockImages, searchStockVideo } from "@/lib/media/sources/stock";

/**
 * One search, every relevant source at once.
 *
 * The editor asks for "a portrait clip of the Optimus factory" or "a
 * picture of 张一鸣" and gets candidates from whichever sites are good for
 * that shape of thing, in parallel, inside one time budget. Which sites:
 *
 *   portrait video      抖音, TikTok, Pinterest pin videos, Pexels
 *   landscape / any     YouTube, B站, Pexels
 *   pictures            Bing, Pinterest, the stock libraries (Pexels,
 *                       Unsplash, Openverse)
 *
 * The query can be given in both languages. 抖音 and B站 are searched in
 * Chinese; Pinterest and the stock libraries in English, because their
 * relevance for a Chinese name is poor; Bing and YouTube take Chinese when
 * there is Chinese, since both handle it well. A single string goes to
 * everybody as it is.
 *
 * Nothing here throws. A source that fails or runs past the budget simply
 * contributes nothing, and says so in the report, so the editor never
 * waits on the slowest site for the fastest one's answer.
 */

export type MediaQuery = string | { zh?: string; en?: string };

/** Which group of sources answered a row of the report; "stock" bundles the three libraries. */
export type ProviderKey = Platform | "stock";

export type SearchMediaOpts = {
  kind: MediaKind;
  orientation?: Orientation | "any";
  /** Per source; 5 by default. */
  limit?: number;
  /** Drop anything longer. Unset: 60 s for portrait short-form, no limit for the landscape sources, whose clips are windowed at fetch time. */
  maxDurationS?: number;
  /** For the whole fan-out; 8 s by default. */
  budgetMs?: number;
  /** Override the plan with exactly these sources. */
  providers?: ProviderKey[];
  /** YouTube: "cc" asks for Creative Commons uploads (one metered request). */
  licence?: "any" | "cc";
};

export type ProviderReport = { provider: ProviderKey; query: string; count: number; ms: number; error?: string; timedOut?: boolean };

export type SearchMediaResult = {
  candidates: Candidate[];
  providers: ProviderReport[];
  ms: number;
};

const PROVIDERS: Record<ProviderKey, { video?: SearchProvider; image?: SearchProvider; lang: "zh" | "en" | "zh-first" }> = {
  douyin: { video: searchDouyin, lang: "zh" },
  bilibili: { video: searchBilibili, lang: "zh" },
  tiktok: { video: searchTikTok, lang: "en" },
  youtube: { video: searchYouTube, lang: "zh-first" },
  pinterest: { video: searchPinterest, image: searchPinterest, lang: "en" },
  bing: { image: searchBing, lang: "zh-first" },
  stock: { video: searchStockVideo, image: searchStockImages, lang: "en" },
  /* The three libraries answer as "stock"; these keys exist so a caller can name one and get the bundle. */
  pexels: { video: searchStockVideo, image: searchStockImages, lang: "en" },
  unsplash: { image: searchStockImages, lang: "en" },
  openverse: { image: searchStockImages, lang: "en" },
};

export function planFor(kind: MediaKind, orientation: Orientation | "any" | undefined): ProviderKey[] {
  if (kind === "image") return ["bing", "pinterest", "stock"];
  if (orientation === "portrait") return ["douyin", "tiktok", "pinterest", "stock"];
  return ["youtube", "bilibili", "stock"];
}

function queryFor(q: MediaQuery, lang: "zh" | "en" | "zh-first"): { text: string; lang: "zh" | "en" } {
  if (typeof q === "string") return { text: q.trim(), lang: /[㐀-鿿]/.test(q) ? "zh" : "en" };
  const zh = q.zh?.trim() ?? "";
  const en = q.en?.trim() ?? "";
  if (lang === "en") return en ? { text: en, lang: "en" } : { text: zh, lang: "zh" };
  return zh ? { text: zh, lang: "zh" } : { text: en, lang: "en" };
}

/* Tracking noise a permalink may carry without being a different page. */
const TRACKING = /^(utm_|fbclid$|gclid$|ref$|source$|feature$|si$|spm_id_from$|vd_source$)/;

/**
 * Two permalinks for the same page read the same. Host case and a trailing
 * slash do not matter; the query does, because YouTube (`/watch?v=`) and
 * B站's search links keep the id there — dropping it once made every
 * YouTube result "the same page" and kept one of ten.
 */
const permalinkKey = (url: string) => {
  try {
    const u = new URL(url);
    const params = Array.from(u.searchParams.entries())
      .filter(([k]) => !TRACKING.test(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${params ? `?${params}` : ""}`;
  } catch {
    return url;
  }
};

/* The same picture pinned twice comes with the same thumbnail address; the
   address is hashed whole, since Bing's thumbnails keep their id in the query
   and a signed CDN address that differs is not known to be the same picture. */
const thumbKey = (url: string) => createHash("sha1").update(url).digest("hex");

export async function searchMedia(query: MediaQuery, opts: SearchMediaOpts): Promise<SearchMediaResult> {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 8_000;
  const limit = Math.max(1, Math.min(20, opts.limit ?? 5));
  const orientation = opts.orientation ?? "any";
  const keys = Array.from(new Set(opts.providers ?? planFor(opts.kind, orientation)));
  const maxDurationS = opts.maxDurationS ?? (opts.kind === "video" && orientation === "portrait" ? 60 : undefined);

  /* One controller for the fan-out: at the deadline every child process
     still searching is killed rather than left to finish for nobody. */
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), budgetMs);

  const rows = await Promise.all(
    keys.map(async (key): Promise<{ report: ProviderReport; candidates: Candidate[] }> => {
      const provider = PROVIDERS[key];
      const search = opts.kind === "video" ? provider.video : provider.image;
      const { text, lang } = queryFor(query, provider.lang);
      const t0 = Date.now();
      if (!search || !text) return { report: { provider: key, query: text, count: 0, ms: 0, error: search ? "no query" : "no such search" }, candidates: [] };
      const searchOpts: SearchOpts = { kind: opts.kind, limit, maxDurationS, orientation, lang, licence: opts.licence, signal: controller.signal };
      let timedOut = false;
      let error: string | undefined;
      const late = new Promise<Candidate[]>((resolve) => {
        controller.signal.addEventListener("abort", () => {
          timedOut = true;
          resolve([]);
        });
      });
      const candidates = await Promise.race([
        search(text, searchOpts).catch((err) => {
          error = err instanceof Error ? err.message : String(err);
          return [] as Candidate[];
        }),
        late,
      ]);
      return { report: { provider: key, query: text, count: candidates.length, ms: Date.now() - t0, error, timedOut: timedOut || undefined }, candidates };
    }),
  );
  clearTimeout(deadline);

  /* The same clip found twice — once by its page, once by its cover — is one candidate. */
  const seenUrl = new Set<string>();
  const seenThumb = new Set<string>();
  const candidates: Candidate[] = [];
  for (const row of rows) {
    let kept = 0;
    for (const c of row.candidates) {
      const u = permalinkKey(c.url);
      /* No thumbnail is no evidence of sameness; without the guard every thumb-less candidate would be "the same" as the first. */
      const t = c.thumb ? thumbKey(c.thumb) : null;
      if (seenUrl.has(u) || (t && seenThumb.has(t))) continue;
      seenUrl.add(u);
      if (t) seenThumb.add(t);
      candidates.push(c);
      kept++;
    }
    row.report.count = kept;
  }

  return { candidates, providers: rows.map((r) => r.report), ms: Date.now() - started };
}
