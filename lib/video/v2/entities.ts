import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Beat } from "@/lib/video/v2/types";
import type { Candidate } from "@/lib/video/v2/media-adapter";

/**
 * The picture of a named thing, from the record that names it.
 *
 * For a company, a product, a publication, the most relevant picture is its
 * logo; for a person, their portrait; for an agency, its building. Wikidata
 * holds exactly these — P154 (logo) and P18 (image) — on the item the
 * Wikipedia page points to, and Wikimedia Commons holds the file with its
 * author and licence in machine-readable form. So the route is: the
 * Wikipedia page by its **title** (the Chinese title first; a label search
 * for 张一鸣 returns a Go player), its `wikibase_item`, the claims, the
 * Commons file's `extmetadata`. Every result carries the licence and the
 * artist, which is what the credits need and what a Bing picture never
 * says.
 *
 * Order of preference is by the entity's kind (PLAN.md §2 W3): logo first
 * for a company, product or publication; the P18 image first for a person
 * or an agency — the seal of a US agency is lawful to show but reads as an
 * official notice, so it comes last and the plan prefers the building or a
 * designed card. Everything is cached on disk by URL for a day, and every
 * request identifies itself as Wikimedia's policy asks.
 *
 * `ogImageCandidate` is the small cousin for a headline: the page's own
 * `og:image`, credited to its site, for the times the outline gives a URL.
 */

export type Entity = NonNullable<Beat["entity"]>;

export type EntityVisual = {
  candidate: Candidate;
  via: "P154" | "P18" | "pageimage";
  qid?: string;
  file: string;
  /** A logo, seal, emblem or flag rather than a photograph — by the claim it came from or by the file's name. */
  isMark: boolean;
};

const MARK = /seal|emblem|logo|coat[_ ]of[_ ]arms|insignia|\bflag\b|wordmark|icon|徽|标志|旗/i;

export type EntityCtx = { cacheDir?: string; signal?: AbortSignal; timeoutMs?: number };

export const WIKI_UA = process.env.DV2_WIKI_UA || "Tengya/1.0 (director v2 sourcing; +https://yt.okbro.xyz) node";

const TTL_MS = 24 * 3600_000;
const sha = (s: string) => createHash("sha1").update(s).digest("hex");

async function getJson<T>(url: string, ctx: EntityCtx): Promise<T | null> {
  const cache = ctx.cacheDir ? path.join(ctx.cacheDir, "entities", `${sha(url)}.json`) : null;
  if (cache) {
    try {
      const hit = JSON.parse(await readFile(cache, "utf8")) as { at: number; body: T };
      if (Date.now() - hit.at < TTL_MS) return hit.body;
    } catch {
      /* miss */
    }
  }
  let body: T | null = null;
  try {
    const res = await fetch(url, { headers: { "user-agent": WIKI_UA, accept: "application/json" }, signal: ctx.signal ?? AbortSignal.timeout(ctx.timeoutMs ?? 8_000), cache: "no-store" });
    if (res.ok) body = (await res.json()) as T;
  } catch {
    body = null;
  }
  if (cache && body) {
    await mkdir(path.dirname(cache), { recursive: true }).catch(() => {});
    await writeFile(cache, JSON.stringify({ at: Date.now(), body })).catch(() => {});
  }
  return body;
}

type PageInfo = { qid?: string; image?: string; title: string; lang: "zh" | "en" };

/** The page for a title, with its Wikidata item and its lead image's file name, or null when there is no such page. */
async function resolvePage(lang: "zh" | "en", title: string, ctx: EntityCtx): Promise<PageInfo | null> {
  const url = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  url.search = new URLSearchParams({ action: "query", titles: title, prop: "pageprops|pageimages", ppprop: "wikibase_item", piprop: "original|name", redirects: "1", format: "json", formatversion: "2" }).toString();
  const body = await getJson<{ query?: { pages?: { missing?: boolean; title?: string; pageprops?: { wikibase_item?: string }; original?: { source?: string }; pageimage?: string }[] } }>(url.toString(), ctx);
  const page = body?.query?.pages?.[0];
  if (!page || page.missing) return null;
  const source = page.original?.source;
  const image = page.pageimage ?? (source ? decodeURIComponent(source.split("/").pop() ?? "") : undefined);
  return { qid: page.pageprops?.wikibase_item, image: image || undefined, title: page.title ?? title, lang };
}

async function claim(qid: string, property: "P154" | "P18", ctx: EntityCtx): Promise<string | null> {
  const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${encodeURIComponent(qid)}&property=${property}&format=json`;
  const body = await getJson<{ claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]> }>(url, ctx);
  const v = body?.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
  return typeof v === "string" && v ? v : null;
}

type ImageInfo = { url: string; descriptionurl: string; thumburl?: string; thumbwidth?: number; thumbheight?: number; width?: number; height?: number; mime?: string; extmetadata?: Record<string, { value?: string }> };

async function commonsInfo(file: string, ctx: EntityCtx): Promise<ImageInfo | null> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    titles: `File:${file.replace(/^File:/i, "")}`,
    prop: "imageinfo",
    iiprop: "url|extmetadata|size|mime",
    iiurlwidth: "1200",
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|Credit|Attribution",
    format: "json",
    formatversion: "2",
  }).toString();
  const body = await getJson<{ query?: { pages?: { missing?: boolean; imageinfo?: ImageInfo[] }[] } }>(url.toString(), ctx);
  const page = body?.query?.pages?.[0];
  if (!page || page.missing) return null;
  return page.imageinfo?.[0] ?? null;
}

const stripHtml = (s: string | undefined) => (s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

function candidateFrom(entity: Entity, file: string, info: ImageInfo, via: EntityVisual["via"]): Candidate | null {
  const big = info.thumburl ?? info.url;
  if (!big) return null;
  const licence = stripHtml(info.extmetadata?.LicenseShortName?.value) || undefined;
  if (!licence) return null;
  const artistRaw = stripHtml(info.extmetadata?.Artist?.value) || stripHtml(info.extmetadata?.Credit?.value);
  const artist = artistRaw && artistRaw.length <= 60 && !/^unknown|不明|佚名$/i.test(artistRaw) ? artistRaw : "";
  const name = file.replace(/^File:/i, "").replace(/_/g, " ");
  const pretty = name.replace(/\.[a-z0-9]+$/i, "");
  const raster = /\.(jpe?g|png|webp|gif)$/i.test(info.url);
  return {
    id: `wikimedia:${name.replace(/\s+/g, "_")}`,
    kind: "image",
    platform: "wikimedia",
    title: via === "P154" ? `${entity.name} 标志` : pretty,
    description: entity.descriptorZh,
    url: info.descriptionurl,
    author: { name: artist || "Wikimedia Commons", url: info.descriptionurl },
    /* A 640-wide rendition for the judge; Commons thumb addresses carry their width. */
    thumb: big.replace(/\/1200px-/, "/640px-"),
    width: info.thumbwidth ?? info.width,
    height: info.thumbheight ?? info.height,
    orientation: info.width && info.height ? (info.width > info.height ? "landscape" : info.width < info.height ? "portrait" : "square") : undefined,
    handle: { via: "image", url: big, fallbackUrl: raster && info.url !== big ? info.url : undefined, headers: { "user-agent": WIKI_UA } },
    licence,
    credit: artist ? `Wikimedia Commons · ${artist}` : `Wikimedia Commons (${licence})`,
  };
}

const uniq = (list: (string | undefined)[]) => Array.from(new Set(list.map((s) => s?.trim()).filter((s): s is string => Boolean(s))));

/**
 * The entity's pictures from the record, best first for its kind. Empty
 * when no Wikipedia page is found or the files carry no licence the
 * credits can print.
 */
export async function entityVisual(entity: Entity, ctx: EntityCtx = {}): Promise<EntityVisual[]> {
  const zhTitles = uniq([entity.wikiTitleZh, entity.name]);
  const enTitles = uniq([entity.wikiTitleEn, entity.romanised, entity.name]);
  const pages: PageInfo[] = [];
  const first = async (lang: "zh" | "en", titles: string[]) => {
    for (const t of titles) {
      const p = await resolvePage(lang, t, ctx);
      if (p) return p;
    }
    return null;
  };
  const [zh, en] = await Promise.all([first("zh", zhTitles), first("en", enTitles)]);
  if (zh) pages.push(zh);
  if (en) pages.push(en);
  const qid = pages.find((p) => p.qid)?.qid;

  const files: { file: string; via: EntityVisual["via"] }[] = [];
  if (qid) {
    const [logo, image] = await Promise.all([claim(qid, "P154", ctx), claim(qid, "P18", ctx)]);
    const logoFirst = entity.kind === "company" || entity.kind === "product" || entity.kind === "publication";
    const ordered: { file: string | null; via: EntityVisual["via"] }[] = logoFirst
      ? [{ file: logo, via: "P154" }, { file: image, via: "P18" }]
      : [{ file: image, via: "P18" }, { file: logo, via: "P154" }];
    for (const o of ordered) if (o.file) files.push({ file: o.file, via: o.via });
  }
  for (const p of pages) if (p.image) files.push({ file: p.image, via: "pageimage" });
  /* An agency's seal last, whatever route it came by: the building or the page image is the shot. */
  const mark = (f: { file: string; via: string }) => f.via === "P154" || MARK.test(f.file);
  if (entity.kind === "agency" || entity.kind === "legislature") files.sort((a, b) => Number(mark(a)) - Number(mark(b)));

  const seen = new Set<string>();
  const out: EntityVisual[] = [];
  for (const f of files) {
    const key = f.file.replace(/^File:/i, "").replace(/\s+/g, "_");
    if (seen.has(key)) continue;
    seen.add(key);
    const info = await commonsInfo(f.file, ctx);
    if (!info) continue;
    const candidate = candidateFrom(entity, f.file, info, f.via);
    if (candidate) out.push({ candidate, via: f.via, qid, file: key, isMark: f.via === "P154" || MARK.test(key) });
    if (out.length >= 3) break;
  }
  return out;
}

/** A headline's own picture: the page's `og:image`, credited to the site. Null when the page has none or cannot be read. */
export async function ogImageCandidate(pageUrl: string, ctx: EntityCtx = {}): Promise<Candidate | null> {
  let host: string;
  try {
    host = new URL(pageUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  let html = "";
  try {
    const res = await fetch(pageUrl, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36", accept: "text/html" },
      signal: ctx.signal ?? AbortSignal.timeout(ctx.timeoutMs ?? 8_000),
      redirect: "follow",
      cache: "no-store",
    });
    if (!res.ok) return null;
    html = (await res.text()).slice(0, 512 * 1024);
  } catch {
    return null;
  }
  const meta = (prop: string) => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i"))?.[0] ?? html.match(new RegExp(`<meta[^>]+content=["'][^"']*["'][^>]+(?:property|name)=["']${prop}["'][^>]*>`, "i"))?.[0];
    return m?.match(/content=["']([^"']+)["']/i)?.[1]?.trim();
  };
  const image = meta("og:image");
  if (!image || !/^https?:/.test(image)) return null;
  const title = meta("og:title") ?? html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ?? host;
  const site = meta("og:site_name") ?? host;
  return {
    id: `bing:og-${sha(pageUrl).slice(0, 16)}`,
    kind: "image",
    platform: "bing",
    title: title.replace(/\s+/g, " ").slice(0, 200),
    url: pageUrl,
    author: { name: site, url: pageUrl },
    thumb: image,
    handle: { via: "image", url: image, headers: { referer: pageUrl } },
    credit: `图片 · ${host}`,
  };
}
