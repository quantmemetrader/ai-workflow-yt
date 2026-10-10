import "server-only";
import "@/lib/keys/boot";
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
        : image.license === "pixabay"
          ? "Pixabay Content License"
          : image.provider === "nasa"
            ? "Public domain (NASA)"
            : `CC ${image.license.toUpperCase()}${image.licenseVersion ? ` ${image.licenseVersion}` : ""}`;
  const who = image.creator ? ` by ${image.creator}` : "";
  return `“${image.title}”${who} — ${licence} — ${image.source}`;
}

/** Licences that need a credit on screen or in the description. */
export function needsCredit(image: StockImage): boolean {
  return image.license !== "cc0" && image.license !== "pdm" && image.license !== "pexels" && image.license !== "pixabay";
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
  if (/^(pixabay|nasa|wikimedia):/.test(id)) return poolById(id);
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

/* ------------------------------------------------------------ the other free pools (10 Oct) */

const UA = { accept: "application/json", "user-agent": "Tengya/1.0 (studio video tool)" };
const strip = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** "CC BY-SA 4.0" → by-sa 4.0; "Public domain" → pdm; NC, ND or unknown → null (not usable here). */
function licenseCode(short: string): { license: string; version: string | null } | null {
  const s = short.toLowerCase().trim();
  if (!s) return null;
  if (/cc0/.test(s)) return { license: "cc0", version: null };
  if (/public domain|^pd\b|pdm/.test(s)) return { license: "pdm", version: null };
  if (/-nc|-nd|non-?commercial|no ?deriv/.test(s)) return null;
  const m = /cc[ -]?by(-sa)?\s*([0-9.]+)?/.exec(s);
  return m ? { license: m[1] ? "by-sa" : "by", version: m[2] ?? null } : null;
}

type CommonsPage = { pageid: number; title: string; imageinfo?: { url: string; thumburl?: string; descriptionurl?: string; width?: number; height?: number; extmetadata?: Record<string, { value?: string }> }[] };

function fromCommons(p: CommonsPage): StockImage | null {
  const ii = p.imageinfo?.[0];
  if (!ii?.url) return null;
  const code = licenseCode(ii.extmetadata?.LicenseShortName?.value ?? "");
  if (!code) return null;
  const artist = ii.extmetadata?.Artist?.value ? strip(ii.extmetadata.Artist.value).slice(0, 80) : null;
  return {
    id: `wikimedia:${p.pageid}`,
    title: p.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""),
    creator: artist || null,
    license: code.license,
    licenseVersion: code.version,
    url: ii.thumburl ?? ii.url,
    thumbnail: ii.thumburl ?? null,
    source: ii.descriptionurl ?? ii.url,
    provider: "wikimedia",
    width: ii.width ?? null,
    height: ii.height ?? null,
  };
}

async function commons(params: Record<string, string>): Promise<CommonsPage[]> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [k, v] of Object.entries({ action: "query", format: "json", prop: "imageinfo", iiprop: "url|size|extmetadata", iiurlwidth: "1600", iiextmetadatafilter: "LicenseShortName|Artist", origin: "*", ...params })) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000), cache: "no-store" }).catch(() => null);
  if (!res?.ok) return [];
  const body = (await res.json().catch(() => null)) as { query?: { pages?: Record<string, CommonsPage> } } | null;
  return Object.values(body?.query?.pages ?? {});
}

/** Wikimedia Commons: the named thing (a person, a company, a building, a chart). No key, CC or public domain only. */
export async function searchWikimedia(query: string, limit = 6): Promise<StockImage[]> {
  const text = query.trim();
  if (!text) return [];
  const pages = await commons({ generator: "search", gsrsearch: `filetype:bitmap ${text.slice(0, 120)}`, gsrnamespace: "6", gsrlimit: String(Math.min(20, limit * 2)) });
  return pages.map(fromCommons).filter((x): x is StockImage => x !== null).slice(0, limit);
}

/** Pixabay: a second big library of free-to-use photographs, when its (free) key is set. */
export async function searchPixabay(query: string, limit = 6): Promise<StockImage[]> {
  const text = query.trim();
  if (!text || !env.pixabay.configured) return [];
  const url = new URL("https://pixabay.com/api/");
  for (const [k, v] of Object.entries({ key: env.pixabay.apiKey, q: text.slice(0, 100), image_type: "photo", per_page: String(Math.max(3, Math.min(20, limit))), safesearch: "true", min_width: "1280" })) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000), cache: "no-store" }).catch(() => null);
  if (!res?.ok) return [];
  const body = (await res.json().catch(() => null)) as { hits?: { id: number; pageURL: string; tags?: string; user?: string; largeImageURL?: string; webformatURL?: string; imageWidth?: number; imageHeight?: number }[] } | null;
  return (body?.hits ?? [])
    .filter((h) => h.largeImageURL)
    .map((h) => ({ id: `pixabay:${h.id}`, title: h.tags?.trim() || text, creator: h.user ?? null, license: "pixabay", licenseVersion: null, url: h.largeImageURL!, thumbnail: h.webformatURL ?? null, source: h.pageURL, provider: "pixabay", width: h.imageWidth ?? null, height: h.imageHeight ?? null }));
}

const SPACE = /space|nasa|planet|earth|moon|mars|rocket|satellite|galaxy|star|astronaut|orbit|solar|太空|航天|火箭|地球|月球|火星|卫星|星球|银河|宇航/i;

/** NASA's image library: public domain, and the only place for the real thing when the subject is space. */
export async function searchNasa(query: string, limit = 4): Promise<StockImage[]> {
  const text = query.trim();
  if (!text || !SPACE.test(text)) return [];
  const url = new URL("https://images-api.nasa.gov/search");
  url.searchParams.set("q", text.slice(0, 100));
  url.searchParams.set("media_type", "image");
  url.searchParams.set("page_size", String(Math.min(20, limit)));
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12_000), cache: "no-store" }).catch(() => null);
  if (!res?.ok) return [];
  const body = (await res.json().catch(() => null)) as { collection?: { items?: { data?: { nasa_id?: string; title?: string; photographer?: string; secondary_creator?: string }[]; links?: { href?: string; rel?: string }[] }[] } } | null;
  const out: StockImage[] = [];
  for (const it of body?.collection?.items ?? []) {
    const d = it.data?.[0];
    const thumb = it.links?.find((l) => l.rel === "preview")?.href ?? it.links?.[0]?.href;
    if (!d?.nasa_id || !thumb) continue;
    out.push({ id: `nasa:${d.nasa_id}`, title: d.title?.trim() || text, creator: d.photographer ?? d.secondary_creator ?? "NASA", license: "pdm", licenseVersion: null, url: thumb.replace(/~(thumb|small|medium)\./, "~large."), thumbnail: thumb, source: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`, provider: "nasa", width: null, height: null });
  }
  return out.slice(0, limit);
}

/** One picture of the newer pools by its id, for the moment it is taken. */
async function poolById(id: string): Promise<StockImage | null> {
  const [pool, ...rest] = id.split(":");
  const native = rest.join(":");
  if (pool === "wikimedia" && /^\d+$/.test(native)) return commons({ pageids: native }).then((p) => (p[0] ? fromCommons(p[0]) : null));
  if (pool === "pixabay" && /^\d+$/.test(native) && env.pixabay.configured) {
    const res = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(env.pixabay.apiKey)}&id=${native}`, { headers: UA, signal: AbortSignal.timeout(12_000) }).catch(() => null);
    const body = res?.ok ? ((await res.json().catch(() => null)) as { hits?: { id: number; pageURL: string; tags?: string; user?: string; largeImageURL?: string; webformatURL?: string; imageWidth?: number; imageHeight?: number }[] } | null) : null;
    const h = body?.hits?.[0];
    return h?.largeImageURL ? { id, title: h.tags?.trim() || "pixabay", creator: h.user ?? null, license: "pixabay", licenseVersion: null, url: h.largeImageURL, thumbnail: h.webformatURL ?? null, source: h.pageURL, provider: "pixabay", width: h.imageWidth ?? null, height: h.imageHeight ?? null } : null;
  }
  if (pool === "nasa" && /^[A-Za-z0-9._-]+$/.test(native)) {
    const res = await fetch(`https://images-api.nasa.gov/asset/${encodeURIComponent(native)}`, { headers: UA, signal: AbortSignal.timeout(12_000) }).catch(() => null);
    const body = res?.ok ? ((await res.json().catch(() => null)) as { collection?: { items?: { href?: string }[] } } | null) : null;
    const hrefs = (body?.collection?.items ?? []).map((i) => i.href ?? "").filter((h) => /\.(jpe?g|png)$/i.test(h));
    const best = hrefs.find((h) => /~large\./.test(h)) ?? hrefs.find((h) => /~medium\./.test(h)) ?? hrefs[0];
    if (!best) return null;
    const meta = await fetch(`https://images-api.nasa.gov/search?nasa_id=${encodeURIComponent(native)}`, { headers: UA, signal: AbortSignal.timeout(12_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as { collection?: { items?: { data?: { title?: string; photographer?: string; secondary_creator?: string }[] }[] } } | null;
    const d = meta?.collection?.items?.[0]?.data?.[0];
    return { id, title: d?.title?.trim() || native, creator: d?.photographer ?? d?.secondary_creator ?? "NASA", license: "pdm", licenseVersion: null, url: best.replace(/^http:/, "https:"), thumbnail: hrefs.find((h) => /~thumb\./.test(h)) ?? null, source: `https://images.nasa.gov/details/${encodeURIComponent(native)}`, provider: "nasa", width: null, height: null };
  }
  return null;
}

/* ------------------------------------------------------------ a picture that does not exist yet */

export type MadePicture = { bytes: Uint8Array; mime: string; width: number; height: number; prompt: string; source: string; engine: "local" | "pollinations" };

const LOCAL_GEN = "http://127.0.0.1:7861";

/** Whether the server's own generator (Z-Image-Turbo under pm2) is up. */
export async function localGeneratorUp(): Promise<{ up: boolean; busy: boolean }> {
  try {
    const r = await fetch(`${LOCAL_GEN}/health`, { signal: AbortSignal.timeout(2_500), cache: "no-store" });
    const j = r.ok ? ((await r.json()) as { ok?: boolean; busy?: boolean }) : null;
    return { up: Boolean(j?.ok), busy: Boolean(j?.busy) };
  } catch {
    return { up: false, busy: false };
  }
}

/**
 * A picture made from words, free, through Pollinations (FLUX): the cinematic
 * still a reel cuts to when no photograph of the idea exists (10 Oct: "the
 * high-end images on Varun Mayya's reels, without paying for them").
 */
export async function generatePicture(
  prompt: string,
  aspect: "portrait" | "landscape" | "square" = "portrait",
  opts: { engine?: "local" | "pollinations"; onProgress?: (f: number) => void } = {},
): Promise<MadePicture> {
  const words = prompt.trim().slice(0, 600);
  if (!words) throw new Error("先描述画面");
  if (opts.engine === "local") {
    /* Z-Image-Turbo on this machine: the best picture, free, about five minutes; progress is time against that. */
    const [w, h] = aspect === "portrait" ? [768, 1344] : aspect === "square" ? [1024, 1024] : [1344, 768];
    const started = Date.now();
    const tick = setInterval(() => opts.onProgress?.(Math.min(0.95, 0.05 + ((Date.now() - started) / 340_000) * 0.9)), 5000);
    try {
      const res = await fetch(`${LOCAL_GEN}/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: words, width: w, height: h, steps: 8 }), signal: AbortSignal.timeout(20 * 60_000) }).catch(() => null);
      if (!res?.ok) throw new Error(`本机生成器没有出图${res ? `（${res.status}）` : "（没在运行）"}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength < 10_000) throw new Error("本机生成器出的图是空的，再试一次");
      return { bytes, mime: "image/jpeg", width: w, height: h, prompt: words, source: "local://z-image-turbo", engine: "local" };
    } finally {
      clearInterval(tick);
    }
  }
  const [width, height] = aspect === "portrait" ? [1080, 1920] : aspect === "square" ? [1080, 1080] : [1920, 1080];
  const seed = Math.floor(Math.random() * 1_000_000);
  const source = `https://image.pollinations.ai/prompt/${encodeURIComponent(words)}?width=${width}&height=${height}&model=flux&nologo=true&enhance=true&seed=${seed}`;
  const res = await fetch(source, { headers: { accept: "image/*", "user-agent": "Tengya/1.0 (studio video tool)", ...(env.pollinations.token ? { authorization: `Bearer ${env.pollinations.token}` } : {}) }, signal: AbortSignal.timeout(120_000) }).catch(() => null);
  if (!res?.ok) throw new Error(`图片没生成出来${res ? `（${res.status}）` : ""}，换个描述再试一次`);
  const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!mime.startsWith("image/") || bytes.byteLength < 10_000) throw new Error("图片没生成出来，再试一次");
  return { bytes, mime, width, height, prompt: words, source, engine: "pollinations" };
}

/**
 * A picture of something, from every free pool at once: Wikimedia Commons
 * and the Openverse index for a named thing (a product, a company, a place,
 * a person in the news), the libraries (Pexels, Pixabay, Unsplash) for the
 * generic scene, NASA when the subject is space. Named-thing sources first.
 */
export async function searchAnyPicture(query: string, limit = 6): Promise<StockImage[]> {
  const [wiki, cc, stock, pix, nasa] = await Promise.all([
    searchWikimedia(query, Math.ceil(limit / 2)).catch(() => []),
    searchStock(query, limit).catch(() => []),
    searchStockPhotos(query, limit).catch(() => []),
    searchPixabay(query, limit).catch(() => []),
    searchNasa(query, 3).catch(() => []),
  ]);
  const seen = new Set<string>();
  return [...nasa, ...wiki, ...cc, ...stock, ...pix].filter((p) => (seen.has(p.url) ? false : (seen.add(p.url), true))).slice(0, limit * 3);
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
