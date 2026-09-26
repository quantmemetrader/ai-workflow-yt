import "server-only";
import { createHash } from "node:crypto";
import type { Candidate, SearchOpts } from "@/lib/media/types";
import { cleanTitle, fetchText, hostOf, withTimeout, BROWSER_UA } from "@/lib/media/tools";

/**
 * Bing image search, free, by reading its results page.
 *
 * The best source for the pictures a business video needs and the stock
 * libraries do not have: a named person, a company's logo, a headline.
 * Chinese queries work as well as English ones ("张一鸣" returns the man,
 * from Chinese news sites), which Pinterest cannot say.
 *
 * The main `/images/search` page serves this server a challenge with no
 * results in it; the `/images/async` fragment the page itself scrolls with
 * does not, and it carries the same result blocks — an `m` attribute on
 * each with a small JSON: `murl` the picture, `purl` the page it is on, `t`
 * the title. Thirty-five a page. There is no author field; credit is the
 * site the picture was found on, and the permalink is that page.
 *
 * Every picture from here is somebody's: the studio's owner has ruled
 * "any source, with credit", and the credit is what this provides. A
 * caller that needs a licence uses the stock provider instead.
 */
const TIMEOUT_MS = 7_000;

type Block = { murl?: string; purl?: string; turl?: string; t?: string; md5?: string; desc?: string };

const unescapeHtml = (s: string) => s.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'");

export async function searchBing(query: string, opts: SearchOpts): Promise<Candidate[]> {
  if (opts.kind !== "image") return [];
  const q = query.trim();
  if (!q) return [];

  const url = new URL("https://www.bing.com/images/async");
  url.searchParams.set("q", q.slice(0, 200));
  url.searchParams.set("first", "0");
  url.searchParams.set("count", "35");
  url.searchParams.set("mmasync", "1");
  /* Bing's own filters: a large picture, and the frame's shape when asked. */
  const filters = ["+filterui:imagesize-large"];
  if (opts.orientation === "portrait") filters.push("+filterui:aspect-tall");
  if (opts.orientation === "landscape") filters.push("+filterui:aspect-wide");
  if (opts.orientation === "square") filters.push("+filterui:aspect-square");
  url.searchParams.set("qft", filters.join(""));
  if (opts.lang === "zh") url.searchParams.set("setlang", "zh-hans");

  const html = await withTimeout(fetchText(url.toString(), { headers: { "user-agent": BROWSER_UA, accept: "text/html" }, timeoutMs: TIMEOUT_MS }), TIMEOUT_MS, null);
  if (!html) return [];

  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/class="iusc"[^>]*\sm="([^"]+)"/g)) {
    let b: Block;
    try {
      b = JSON.parse(unescapeHtml(m[1])) as Block;
    } catch {
      continue;
    }
    if (!b.murl || !b.purl || !/^https?:/.test(b.murl)) continue;
    const key = b.md5 ?? createHash("sha1").update(b.murl).digest("hex").slice(0, 16);
    if (seen.has(key)) continue;
    seen.add(key);
    const host = hostOf(b.purl) ?? hostOf(b.murl) ?? "web";
    out.push({
      id: `bing:${key}`,
      kind: "image",
      platform: "bing",
      title: cleanTitle(b.t, host),
      description: b.desc ? cleanTitle(b.desc) : undefined,
      url: b.purl,
      author: { name: host, url: b.purl },
      thumb: b.turl ?? b.murl,
      orientation: opts.orientation && opts.orientation !== "any" ? opts.orientation : undefined,
      /* Some sites only serve the picture to a visitor coming from their own page. */
      handle: { via: "image", url: b.murl, headers: { referer: b.purl } },
      credit: `图片 · ${host}`,
    });
    if (out.length >= opts.limit) break;
  }
  return out;
}
