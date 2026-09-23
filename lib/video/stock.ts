import "server-only";
import { env } from "@/lib/env";

/**
 * Pictures from outside the studio, with their licence attached.
 *
 * The assistant used to answer "I cannot fetch an image" and it was right: the
 * only pictures it could reach were the ones somebody in the studio had
 * uploaded. That is a real limit for a studio cutting a video about a place it
 * has no footage of.
 *
 * This is the fix, and the shape of it is the point. It searches **Openverse**
 * — the Creative Commons search index over Flickr, Wikimedia, museums and the
 * rest — filtered to licences that permit commercial use and modification, and
 * every result carries its licence, its creator and the page it came from. A
 * picture is only ever taken into the studio's own store together with that
 * record, so a video that ships with somebody else's photograph on it can
 * always answer "whose, and under what".
 *
 * What it deliberately is not: a way to pull any image off the open web. A
 * search engine's image tab is full of pictures nobody may republish, and a
 * work assistant is not the right place to decide that risk.
 */
const ENDPOINT = "https://api.openverse.org/v1/images/";

export type StockImage = {
  id: string;
  title: string;
  creator: string | null;
  /** "by", "by-sa", "cc0", "pdm"… as Openverse reports it. */
  license: string;
  licenseVersion: string | null;
  /** The full-size file. */
  url: string;
  /** A small version, for showing candidates before committing. */
  thumbnail: string | null;
  /** Where it lives, which is what attribution has to point at. */
  source: string;
  provider: string | null;
  width: number | null;
  height: number | null;
};

/** Attribution as it should be written down, in one line. */
export function attributionFor(image: StockImage): string {
  const licence =
    image.license === "pexels"
      ? "Pexels License"
      : image.license === "unsplash"
        ? "Unsplash License"
        : `CC ${image.license.toUpperCase()}${image.licenseVersion ? ` ${image.licenseVersion}` : ""}`;
  const who = image.creator ? ` by ${image.creator}` : "";
  return `“${image.title}”${who} — ${licence} — ${image.source}`;
}

/** Licences that need a credit on screen or in the description. */
export function needsCredit(image: StockImage): boolean {
  return image.license !== "cc0" && image.license !== "pdm" && image.license !== "pexels";
}

export async function searchStock(query: string, limit = 8): Promise<StockImage[]> {
  const text = query.trim();
  if (!text) return [];

  const url = new URL(ENDPOINT);
  url.searchParams.set("q", text.slice(0, 200));
  url.searchParams.set("page_size", String(Math.min(20, Math.max(1, limit))));
  /* Commercial use and modification only. A studio's video is commercial work
     and every picture on it is cropped, scaled or overlaid — a licence that
     forbids either is a licence this cannot honour. */
  url.searchParams.set("license_type", "commercial,modification");
  url.searchParams.set("mature", "false");

  const res = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "Tengya/1.0 (studio video tool)" },
    // Openverse is a search index: a slow answer is better than a stale one,
    // but nobody should wait more than a few seconds for one.
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  }).catch(() => null);

  if (!res?.ok) return [];

  const body = (await res.json().catch(() => null)) as {
    results?: {
      id: string;
      title?: string;
      creator?: string | null;
      license: string;
      license_version?: string | null;
      url: string;
      thumbnail?: string | null;
      foreign_landing_url?: string;
      provider?: string | null;
      width?: number | null;
      height?: number | null;
    }[];
  } | null;

  return (body?.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({
      id: r.id,
      title: r.title?.trim() || "untitled",
      creator: r.creator ?? null,
      license: r.license,
      licenseVersion: r.license_version ?? null,
      url: r.url,
      thumbnail: r.thumbnail ?? null,
      source: r.foreign_landing_url ?? r.url,
      provider: r.provider ?? null,
      width: r.width ?? null,
      height: r.height ?? null,
    }));
}

/** One result by its Openverse id, for the moment it is actually taken. */
export async function stockById(id: string): Promise<StockImage | null> {
  /* A library photo carries its provider in the id; it is fetched again by
     the same search rather than by a detail call, so one code path serves
     both libraries. */
  if (/^(pexels|unsplash):/.test(id)) {
    const hit = (await searchStockPhotos(id.split(":")[1] ?? "", 1).catch(() => [])).find((p) => p.id === id);
    return hit ?? null;
  }
  if (!/^[0-9a-f-]{16,64}$/i.test(id)) return null;
  const res = await fetch(`${ENDPOINT}${id}/`, {
    headers: { accept: "application/json", "user-agent": "Tengya/1.0 (studio video tool)" },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok) return null;

  /* The detail endpoint names things differently from the search one: its
     `source` is the provider ("flickr"), and the page a credit must point at
     is `foreign_landing_url`. Reading the wrong one wrote "flickr" where an
     attribution needs a link. */
  const r = (await res.json().catch(() => null)) as {
    id: string;
    title?: string;
    creator?: string | null;
    license: string;
    license_version?: string | null;
    url: string;
    thumbnail?: string | null;
    foreign_landing_url?: string;
    source?: string | null;
    provider?: string | null;
    width?: number | null;
    height?: number | null;
  } | null;
  if (!r?.url) return null;

  return {
    id: r.id,
    title: r.title?.trim() || "untitled",
    creator: r.creator ?? null,
    license: r.license,
    licenseVersion: r.license_version ?? null,
    url: r.url,
    thumbnail: r.thumbnail ?? null,
    source: r.foreign_landing_url ?? r.url,
    provider: r.provider ?? r.source ?? null,
    width: r.width ?? null,
    height: r.height ?? null,
  };
}


/* ------------------------------------------------------------ Pexels */

/**
 * Stock photographs and clips from Pexels and Unsplash, through their own
 * APIs, when the keys are set.
 *
 * The Creative Commons index above is right for a picture of a specific
 * thing: a product, a place, a person in the news. It is thin on the generic
 * cutaway a business video lives on — money being counted, a trading screen,
 * a factory line — and it holds no video at all. These libraries license
 * exactly that for commercial use, with the photographer named, which is the
 * only kind of "from the internet" this product will do.
 */
export type StockClip = {
  id: string;
  title: string;
  creator: string | null;
  /** The MP4 chosen for this frame, and its size. */
  url: string;
  width: number;
  height: number;
  durationSec: number;
  thumbnail: string | null;
  source: string;
  provider: "pexels";
  license: string;
};

export function stockConfigured(): { pexels: boolean; unsplash: boolean } {
  return { pexels: env.pexels.configured, unsplash: env.unsplash.configured };
}

/** Video clips for a cutaway. `orientation` matches the frame being made. */
export async function searchStockClips(
  query: string,
  opts: { orientation?: "landscape" | "portrait" | "square"; limit?: number } = {},
): Promise<StockClip[]> {
  if (!env.pexels.configured) return [];
  const text = query.trim();
  if (!text) return [];

  const url = new URL("https://api.pexels.com/videos/search");
  url.searchParams.set("query", text.slice(0, 120));
  url.searchParams.set("per_page", String(Math.min(15, Math.max(1, opts.limit ?? 6))));
  if (opts.orientation) url.searchParams.set("orientation", opts.orientation);

  const res = await fetch(url, {
    headers: { Authorization: env.pexels.apiKey, "user-agent": "Tengya/1.0 (studio video tool)" },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok) return [];

  const body = (await res.json().catch(() => null)) as {
    videos?: {
      id: number;
      url: string;
      duration: number;
      image?: string;
      user?: { name?: string };
      video_files?: { link: string; width?: number | null; height?: number | null; quality?: string; file_type?: string }[];
    }[];
  } | null;

  return (body?.videos ?? [])
    .map((v) => {
      // The file nearest 1080 on its long edge: enough for the frame, and not
      // a 4K download for a four-second cutaway.
      const files = (v.video_files ?? []).filter((f) => f.file_type === "video/mp4" && f.width && f.height);
      const pick = files
        .slice()
        .sort((a, b) => Math.abs(Math.max(a.width!, a.height!) - 1080) - Math.abs(Math.max(b.width!, b.height!) - 1080))[0];
      if (!pick) return null;
      return {
        id: String(v.id),
        title: text,
        creator: v.user?.name ?? null,
        url: pick.link,
        width: pick.width!,
        height: pick.height!,
        durationSec: v.duration,
        thumbnail: v.image ?? null,
        source: v.url,
        provider: "pexels" as const,
        license: "Pexels License",
      };
    })
    .filter((c): c is StockClip => c !== null && c.durationSec >= 3);
}

/** Photographs, from Pexels and Unsplash, as the same shape the CC index returns. */
export async function searchStockPhotos(query: string, limit = 6): Promise<StockImage[]> {
  const text = query.trim();
  if (!text) return [];
  const out: StockImage[] = [];

  if (env.pexels.configured) {
    const url = new URL("https://api.pexels.com/v1/search");
    url.searchParams.set("query", text.slice(0, 120));
    url.searchParams.set("per_page", String(Math.min(10, limit)));
    const res = await fetch(url, {
      headers: { Authorization: env.pexels.apiKey, "user-agent": "Tengya/1.0 (studio video tool)" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    }).catch(() => null);
    const body = res?.ok
      ? ((await res.json().catch(() => null)) as {
          photos?: { id: number; url: string; alt?: string; photographer?: string; width?: number; height?: number; src?: { large2x?: string; large?: string; medium?: string } }[];
        } | null)
      : null;
    for (const p of body?.photos ?? []) {
      const src = p.src?.large2x ?? p.src?.large;
      if (!src) continue;
      out.push({
        id: `pexels:${p.id}`,
        title: p.alt?.trim() || text,
        creator: p.photographer ?? null,
        license: "pexels",
        licenseVersion: null,
        url: src,
        thumbnail: p.src?.medium ?? null,
        source: p.url,
        provider: "pexels",
        width: p.width ?? null,
        height: p.height ?? null,
      });
    }
  }

  if (env.unsplash.configured) {
    const url = new URL("https://api.unsplash.com/search/photos");
    url.searchParams.set("query", text.slice(0, 120));
    url.searchParams.set("per_page", String(Math.min(10, limit)));
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${env.unsplash.accessKey}`, "Accept-Version": "v1" },
      signal: AbortSignal.timeout(12_000),
      cache: "no-store",
    }).catch(() => null);
    const body = res?.ok
      ? ((await res.json().catch(() => null)) as {
          results?: { id: string; alt_description?: string | null; width?: number; height?: number; urls?: { regular?: string; small?: string }; user?: { name?: string }; links?: { html?: string; download_location?: string } }[];
        } | null)
      : null;
    for (const r of body?.results ?? []) {
      if (!r.urls?.regular) continue;
      out.push({
        id: `unsplash:${r.id}`,
        title: r.alt_description?.trim() || text,
        creator: r.user?.name ?? null,
        license: "unsplash",
        licenseVersion: null,
        url: r.urls.regular,
        thumbnail: r.urls.small ?? null,
        source: r.links?.html ?? "https://unsplash.com",
        provider: "unsplash",
        width: r.width ?? null,
        height: r.height ?? null,
      });
    }
  }

  return out.slice(0, limit);
}

/** A picture of something specific first from the studio's usual index, then the stock libraries. */
export async function searchAnyPicture(query: string, limit = 6): Promise<StockImage[]> {
  const [cc, stock] = await Promise.all([searchStock(query, limit).catch(() => []), searchStockPhotos(query, limit).catch(() => [])]);
  // The CC index is the better source for a *named* thing (a product, a
  // company, a place); the libraries for the generic scene. Both are offered,
  // the named-thing source first.
  return [...cc, ...stock].slice(0, limit * 2);
}

/** One stock clip by its id, for the moment it is taken. */
export async function stockClipById(id: string): Promise<StockClip | null> {
  if (!/^\d{1,12}$/.test(id) || !env.pexels.configured) return null;
  const res = await fetch(`https://api.pexels.com/videos/videos/${id}`, {
    headers: { Authorization: env.pexels.apiKey },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  }).catch(() => null);
  if (!res?.ok) return null;
  const v = (await res.json().catch(() => null)) as {
    id: number;
    url: string;
    duration: number;
    image?: string;
    user?: { name?: string };
    video_files?: { link: string; width?: number | null; height?: number | null; file_type?: string }[];
  } | null;
  if (!v) return null;
  const files = (v.video_files ?? []).filter((f) => f.file_type === "video/mp4" && f.width && f.height);
  const pick = files.slice().sort((a, b) => Math.abs(Math.max(a.width!, a.height!) - 1080) - Math.abs(Math.max(b.width!, b.height!) - 1080))[0];
  if (!pick) return null;
  return {
    id: String(v.id),
    title: `Pexels ${v.id}`,
    creator: v.user?.name ?? null,
    url: pick.link,
    width: pick.width!,
    height: pick.height!,
    durationSec: v.duration,
    thumbnail: v.image ?? null,
    source: v.url,
    provider: "pexels",
    license: "Pexels License",
  };
}

export function clipAttribution(clip: StockClip): string {
  return `Stock clip${clip.creator ? ` by ${clip.creator}` : ""} — ${clip.license} — ${clip.source}`;
}
