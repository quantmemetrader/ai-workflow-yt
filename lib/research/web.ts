import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * More of the web for the writer and the researcher (15 Oct: "文章不够深度，搜索不了网上的新闻 … 除了 YouTube，
 * 可以增加更多 source"). Free sources that answer from the server: Bing News (real article links, Chinese and
 * English editions), Wikipedia (zh and en), Hacker News; and reading an article's own text, so a script can
 * stand on what the reporting says rather than on headlines.
 */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

export type WebHit = { title: string; url: string; source: string; date: string | null; snippet: string };

const decodeEntities = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const tag = (item: string, name: string) => decodeEntities((item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) ?? [])[1] ?? "").replace(/<[^>]+>/g, "").trim();
const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Bing News: the newest reporting with each article's real address. `zh` reads the Hong Kong edition in Chinese. */
export async function bingNews(q: string, lang: "zh" | "en", limit = 10): Promise<WebHit[]> {
  const url = `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&${lang === "zh" ? "cc=hk&setlang=zh-hans" : "cc=us&setlang=en-us"}`;
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!res.ok) return [];
  const xml = await res.text();
  const out: WebHit[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const raw = tag(it, "link");
    const real = (raw.match(/[?&]url=([^&]+)/) ?? [])[1];
    const link = real ? decodeURIComponent(real) : raw;
    const date = tag(it, "pubDate");
    out.push({ title: tag(it, "title"), url: link, source: tag(it, "News:Source").replace(/ on MSN$/, "") || host(link), date: date ? new Date(date).toISOString().slice(0, 10) : null, snippet: tag(it, "description").slice(0, 200) });
    if (out.length >= limit) break;
  }
  return out;
}

/** Wikipedia's summary of the best match, as background (who, what, when). */
export async function wikiSummary(q: string, lang: "zh" | "en"): Promise<WebHit | null> {
  const base = `https://${lang}.wikipedia.org`;
  const s = await fetch(`${base}/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&srlimit=1`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10_000) });
  if (!s.ok) return null;
  const title = ((await s.json()) as { query?: { search?: { title: string }[] } }).query?.search?.[0]?.title;
  if (!title) return null;
  /* Background only when it is about the subject: a phrase search ("香港 AI 创业 融资") matched a founder's page. */
  const norm = (x: string) => x.toLowerCase().replace(/[\s·・()（）_-]/g, "");
  if (!norm(q).includes(norm(title)) && !norm(title).includes(norm(q))) return null;
  const r = await fetch(`${base}/api/rest_v1/page/summary/${encodeURIComponent(title)}${lang === "zh" ? "?variant=zh-cn" : ""}`, { headers: { "User-Agent": UA, ...(lang === "zh" ? { "Accept-Language": "zh-CN" } : {}) }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return null;
  const j = (await r.json()) as { title?: string; extract?: string; content_urls?: { desktop?: { page?: string } } };
  if (!j.extract) return null;
  return { title: j.title ?? title, url: j.content_urls?.desktop?.page ?? `${base}/wiki/${encodeURIComponent(title)}`, source: `Wikipedia (${lang})`, date: null, snippet: j.extract.slice(0, 700) };
}

/** Hacker News stories: what the tech crowd is arguing about, with points and comments. */
export async function hackerNews(q: string, limit = 5): Promise<WebHit[]> {
  const r = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=${limit}`, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) return [];
  const j = (await r.json()) as { hits?: { title: string; url: string | null; objectID: string; points: number; num_comments: number; created_at: string }[] };
  return (j.hits ?? []).map((h) => ({ title: h.title, url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`, source: `Hacker News · ${h.points} 分 · ${h.num_comments} 评论`, date: h.created_at?.slice(0, 10) ?? null, snippet: "" }));
}

/* ------------------------------------------------------------- reading a page */

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) return ip === "::1" || /^(fc|fd|fe80)/i.test(ip) || ip.startsWith("::ffff:") && privateAddress(ip.slice(7));
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** Only public web pages: the address is the model's choice, so nothing on this machine or its network. */
async function safeUrl(raw: string): Promise<URL | null> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  if (u.port && !["80", "443", ""].includes(u.port)) return null;
  const addrs = isIP(u.hostname) ? [{ address: u.hostname }] : await lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length || addrs.some((a) => privateAddress(a.address))) return null;
  return u;
}

/** An article's own text (title and paragraphs), up to `max` characters. Follows at most three redirects, each checked. */
export async function readArticle(raw: string, max = 6000): Promise<{ title: string; text: string; url: string } | null> {
  let url = await safeUrl(raw);
  for (let hop = 0; url && hop < 4; hop++) {
    const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" }, redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!res) return null;
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = await safeUrl(new URL(res.headers.get("location")!, url).toString());
      continue;
    }
    if (!res.ok || !/text\/html|xml/.test(res.headers.get("content-type") ?? "text/html")) return null;
    const buf = new Uint8Array(await res.arrayBuffer()).slice(0, 3_000_000);
    const head = new TextDecoder("latin1").decode(buf.slice(0, 4000));
    const charset = (res.headers.get("content-type")?.match(/charset=([\w-]+)/i)?.[1] ?? head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? "utf-8").toLowerCase();
    let html: string;
    try {
      html = new TextDecoder(charset === "gb2312" ? "gbk" : charset).decode(buf);
    } catch {
      html = new TextDecoder("utf-8").decode(buf);
    }
    html = html.replace(/<(script|style|noscript|svg|nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, " ");
    const title = decodeEntities((html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? "").replace(/\s+/g, " ").trim();
    const paras = [...html.matchAll(/<(p|h2|h3|li)[^>]*>([\s\S]*?)<\/\1>/gi)]
      .map((m) => decodeEntities(m[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim())
      .filter((t) => t.length >= 28 && !/(版权所有|copyright|cookie|订阅|subscribe|登录|sign in|责任编辑|免责声明|广告)/i.test(t));
    const seen = new Set<string>();
    const text = paras.filter((t) => (seen.has(t) ? false : (seen.add(t), true))).join("\n").slice(0, max);
    return text.length > 200 ? { title, text, url: url.toString() } : null;
  }
  return null;
}

/**
 * A subject researched for a script: the newest reporting in both languages, the background, and the text of
 * the leading articles — written out as notes the writer may cite (with outlet and date).
 */
export async function researchNotes(subject: string, opts: { articles?: number } = {}): Promise<string> {
  const within = <T,>(p: Promise<T>, ms: number): Promise<T | null> => Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  const [zh, en, wzh, wen] = await Promise.all([within(bingNews(subject, "zh", 8), 13_000), within(bingNews(subject, "en", 8), 13_000), within(wikiSummary(subject, "zh"), 11_000), within(wikiSummary(subject, "en"), 11_000)]);
  const news = [...(zh ?? []), ...(en ?? [])];
  const lines: string[] = [];
  if (news.length) {
    lines.push("【最新报道】");
    for (const n of news) lines.push(`- ${n.date ?? ""} · ${n.source} — ${n.title}${n.snippet ? `：${n.snippet.slice(0, 120)}` : ""} (${n.url})`);
  }
  for (const w of [wzh, wen]) if (w) lines.push(`【背景 · ${w.source}】${w.title}：${w.snippet}`);
  const want = opts.articles ?? 3;
  if (want > 0 && news.length) {
    const bodies = await Promise.all(news.slice(0, want + 3).map((n) => within(readArticle(n.url, 1800), 16_000).then((a) => (a ? { ...a, source: n.source, date: n.date } : null))));
    const got = bodies.filter((b): b is NonNullable<typeof b> => Boolean(b)).slice(0, want);
    for (const b of got) lines.push(`【原文摘录 · ${b.source} ${b.date ?? ""}】${b.title}\n${b.text}`);
  }
  return lines.join("\n");
}
