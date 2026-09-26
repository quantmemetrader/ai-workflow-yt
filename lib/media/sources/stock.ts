import "server-only";
import { searchStock, searchStockClips, searchStockPhotos, type StockImage } from "@/lib/video/stock";
import { orientationOf, type Candidate, type SearchOpts } from "@/lib/media/types";
import { withTimeout } from "@/lib/media/tools";

/**
 * The licensed libraries the director already uses — Pexels clips and
 * photographs, Unsplash photographs, the Openverse Creative Commons index —
 * read into the same candidate shape as the platform sources.
 *
 * `lib/video/stock.ts` stays the owner of the API calls and of
 * `attributionFor`; this only reshapes. These are the candidates that carry
 * a real licence, which is why the dispatcher always includes them: when a
 * platform clip and a Pexels clip say the same thing, the editor can prefer
 * the one the studio may reuse outright.
 */
const TIMEOUT_MS = 9_000;

function slugTitle(pageUrl: string): string | null {
  const slug = pageUrl.match(/\/video\/([a-z0-9-]+?)-\d+\/?$/i)?.[1];
  if (!slug) return null;
  const words = slug.replace(/-/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

function licenceOf(image: StockImage): string {
  if (image.license === "pexels") return "Pexels License";
  if (image.license === "unsplash") return "Unsplash License";
  return `CC ${image.license.toUpperCase()}${image.licenseVersion ? ` ${image.licenseVersion}` : ""}`;
}

function fromImage(image: StockImage): Candidate | null {
  const platform = image.provider === "pexels" ? "pexels" : image.provider === "unsplash" ? "unsplash" : "openverse";
  const nativeId = image.id.replace(/^(pexels|unsplash):/, "");
  const who = image.creator?.trim() || null;
  const licence = licenceOf(image);
  const label = platform === "pexels" ? "Pexels" : platform === "unsplash" ? "Unsplash" : "Openverse";
  return {
    id: `${platform}:${nativeId}`,
    kind: "image",
    platform,
    title: image.title,
    url: image.source,
    author: { name: who ?? label },
    thumb: image.thumbnail ?? image.url,
    width: image.width ?? undefined,
    height: image.height ?? undefined,
    orientation: orientationOf(image.width, image.height),
    handle: { via: "image", url: image.url },
    licence,
    credit: platform === "openverse" ? `Openverse · ${who ?? image.provider ?? "unknown"} (${licence})` : `${label} · ${who ?? label}`,
  };
}

export async function searchStockImages(query: string, opts: SearchOpts): Promise<Candidate[]> {
  if (opts.kind !== "image") return [];
  const q = query.trim();
  if (!q) return [];
  const [cc, libs] = await Promise.all([
    withTimeout(searchStock(q, opts.limit).catch(() => []), TIMEOUT_MS, []),
    withTimeout(searchStockPhotos(q, opts.limit).catch(() => []), TIMEOUT_MS, []),
  ]);
  const out: Candidate[] = [];
  for (const image of [...libs, ...cc]) {
    const c = fromImage(image);
    if (!c) continue;
    if (opts.orientation && opts.orientation !== "any" && c.orientation && c.orientation !== opts.orientation) continue;
    out.push(c);
  }
  return out;
}

export async function searchStockVideo(query: string, opts: SearchOpts): Promise<Candidate[]> {
  if (opts.kind !== "video") return [];
  const q = query.trim();
  if (!q) return [];
  const clips = await withTimeout(
    searchStockClips(q, { orientation: opts.orientation && opts.orientation !== "any" ? opts.orientation : undefined, limit: opts.limit }).catch(() => []),
    TIMEOUT_MS,
    [],
  );
  const out: Candidate[] = [];
  for (const clip of clips) {
    if (opts.maxDurationS !== undefined && clip.durationSec > opts.maxDurationS) continue;
    const who = clip.creator?.trim() || "Pexels";
    out.push({
      id: `pexels:v${clip.id}`,
      kind: "video",
      platform: "pexels",
      /* Pexels gives a clip no title, so `stock.ts` repeats the query; the
         page's slug ("factory-industrial-area-30899596") says what is in
         it, which is what a judge needs to read. */
      title: slugTitle(clip.source) ?? clip.title,
      url: clip.source,
      author: { name: who },
      thumb: clip.thumbnail ?? clip.url,
      durationMs: Math.round(clip.durationSec * 1000),
      width: clip.width,
      height: clip.height,
      orientation: orientationOf(clip.width, clip.height),
      handle: { via: "direct", url: clip.url },
      licence: clip.license,
      credit: `Pexels · ${who}`,
    });
  }
  return out.slice(0, opts.limit);
}
