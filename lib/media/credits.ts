import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { videoProjects } from "@/lib/db/schema";
import type { Asset, MediaKind, Platform } from "@/lib/media/types";

/**
 * Credits, written from the assets a video used.
 *
 * Three outputs, for the three places a credit goes:
 *
 *   creditLine    one line for the end card — "素材来源：抖音 @作者 ·
 *                 YouTube · 频道 · Pinterest · pinner"
 *   creditsBlock  the full list for the publish copy, one asset a line
 *                 with its permalink, plus the takedown line the owner's
 *                 "any source, credits given" rule needs under it
 *   recordUsedAssets / usedAssets
 *                 the record itself, on the project
 *
 * **Where the record lives.** `video_projects.director` is a free-form
 * jsonb the director already patches key by key (`{ state, step, log,
 * result, … }`, see `patch()` in `lib/video/director.ts`; every writer
 * spreads the old value first). A `media` key rides along in it with no
 * migration, and it is reset with the rest when `requestDirector` starts a
 * new run, which is the right lifetime for "what this cut used". The
 * per-item pointer stays where it is: `timeline_items.options.credit`.
 */

export const PLATFORM_LABEL: Record<Platform, string> = {
  douyin: "抖音",
  bilibili: "B站",
  tiktok: "TikTok",
  youtube: "YouTube",
  pinterest: "Pinterest",
  bing: "图片",
  pexels: "Pexels",
  unsplash: "Unsplash",
  openverse: "Openverse",
};

/* The order credits read in: Chinese platforms, then the global ones, then pictures and libraries. */
const ORDER: Platform[] = ["douyin", "bilibili", "tiktok", "youtube", "pinterest", "bing", "pexels", "unsplash", "openverse"];

export const TAKEDOWN_LINE = "平台视频与图片素材仅作评论引用，版权归原作者所有；如有异议请联系我们删除。";

/** What is kept on the project for each asset a cut used: enough to print every credit again without the file. */
export type UsedAsset = {
  fileId: string;
  platform: Platform;
  kind: MediaKind;
  title: string;
  author: { name: string; url?: string };
  permalink: string;
  credit: string;
  licence?: string;
  window?: { start: number; end: number };
  fetchedAt: string;
  /** The spoken line it was found for, when the editor says. */
  forLine?: string;
};

export function toUsed(asset: Asset, forLine?: string): UsedAsset {
  const c = asset.candidate;
  return {
    fileId: asset.fileId,
    platform: c.platform,
    kind: c.kind,
    title: c.title,
    author: { name: c.author.name, url: c.author.url },
    permalink: c.url,
    credit: asset.credit,
    licence: c.licence,
    window: asset.window,
    fetchedAt: asset.fetchedAt,
    forLine,
  };
}

type Creditable = Asset | UsedAsset;
const isAsset = (x: Creditable): x is Asset => "candidate" in x;
const used = (x: Creditable): UsedAsset => (isAsset(x) ? toUsed(x) : x);

function sorted(items: Creditable[]): UsedAsset[] {
  return items.map(used).sort((a, b) => ORDER.indexOf(a.platform) - ORDER.indexOf(b.platform));
}

/** The end card's line. One entry per source account, in reading order, never repeated. */
export function creditLine(assets: Creditable | Creditable[]): string {
  const list = sorted(Array.isArray(assets) ? assets : [assets]);
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const a of list) {
    if (seen.has(a.credit)) continue;
    seen.add(a.credit);
    parts.push(a.credit);
  }
  return parts.length ? `素材来源：${parts.join(" · ")}` : "";
}

function lineFor(a: UsedAsset): string {
  const title = a.title ? `《${a.title.slice(0, 80)}》` : "";
  /* A licensed picture names its licence, as CC BY asks; a platform clip names its account. */
  const licence = a.licence && !a.licence.startsWith("stock:") ? ` — ${a.licence}` : "";
  return `· ${a.credit}${title}${licence} ${a.permalink}`;
}

/** The publish copy's list: videos, then pictures, one a line with its link, and the takedown line. */
export function creditsBlock(assets: Creditable[]): string {
  const list = sorted(assets);
  if (!list.length) return "";
  const seen = new Set<string>();
  const videos: string[] = [];
  const pictures: string[] = [];
  for (const a of list) {
    if (seen.has(a.permalink)) continue;
    seen.add(a.permalink);
    (a.kind === "video" ? videos : pictures).push(lineFor(a));
  }
  const out = ["素材来源 / Sources"];
  if (videos.length) out.push("视频", ...videos);
  if (pictures.length) out.push("图片", ...pictures);
  out.push(TAKEDOWN_LINE);
  return out.join("\n");
}

type MediaRecord = { assets?: UsedAsset[]; updatedAt?: string };

/**
 * Remember what a project used. Merged by file id, so recording the same
 * asset twice — a clip on two lines — keeps one entry, the later `forLine`
 * winning. `replace` starts the list over, for a re-cut.
 */
export async function recordUsedAssets(projectId: string, assets: (Asset | UsedAsset)[], opts: { forLine?: string; replace?: boolean } = {}): Promise<UsedAsset[]> {
  const [row] = await db.select({ director: videoProjects.director }).from(videoProjects).where(eq(videoProjects.id, projectId)).limit(1);
  if (!row) throw new Error("That project does not exist");
  const director = (row.director ?? {}) as Record<string, unknown> & { media?: MediaRecord };
  const current = opts.replace ? [] : (director.media?.assets ?? []);
  const byFile = new Map<string, UsedAsset>(current.map((a) => [a.fileId, a]));
  for (const a of assets) {
    const u = isAsset(a) ? toUsed(a, opts.forLine) : { ...a, forLine: a.forLine ?? opts.forLine };
    byFile.set(u.fileId, { ...byFile.get(u.fileId), ...u });
  }
  const merged = Array.from(byFile.values());
  await db
    .update(videoProjects)
    .set({ director: { ...director, media: { assets: merged, updatedAt: new Date().toISOString() } }, updatedAt: new Date() })
    .where(eq(videoProjects.id, projectId));
  return merged;
}

export async function usedAssets(projectId: string): Promise<UsedAsset[]> {
  const [row] = await db.select({ director: videoProjects.director }).from(videoProjects).where(eq(videoProjects.id, projectId)).limit(1);
  const director = (row?.director ?? {}) as { media?: MediaRecord };
  return director.media?.assets ?? [];
}
