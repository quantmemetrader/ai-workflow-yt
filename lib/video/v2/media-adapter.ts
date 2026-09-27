import "server-only";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import type { Viewer } from "@/lib/auth/types";
import { planFor, searchMedia, type MediaQuery, type ProviderKey, type ProviderReport, type SearchMediaOpts, type SearchMediaResult } from "@/lib/media/search";
import { fetchAsset, fetchToDisk, type FetchOpts } from "@/lib/media/fetch";
import { creditLine, creditsBlock, recordUsedAssets, toUsed, PLATFORM_LABEL, TAKEDOWN_LINE, type UsedAsset } from "@/lib/media/credits";
import { downloadToFile, run, ToolError } from "@/lib/media/tools";
import type { Asset, Candidate, MediaKind, Platform } from "@/lib/media/types";
import { FLATTEN_ON_WHITE } from "@/lib/video/contactsheet";

/**
 * The director's one door to `lib/media`.
 *
 * Every other file of the sourcing workstream (PLAN.md §2 W3) talks to the
 * internet through this module and nothing else, so when the library's
 * signatures move, this is the one place that changes. It adds the three
 * things the plan asked the media engineer for and the library does not
 * have yet (Stage 0 item 9, asks (a) and (e)):
 *
 *   a search cache    24 hours, on disk, keyed by the query and every option
 *                     that changes the answer. A re-run of the director on
 *                     the same project costs no TikHub request at all.
 *   a request budget  抖音 and TikTok are metered (about $0.0017 a search).
 *                     The counter here is what `cost.json` reports, and once
 *                     the budget is spent the metered sources are simply
 *                     left out of the fan-out — the free ones still answer.
 *   a local fetch     `fetchLocal` puts a candidate on disk with no viewer,
 *                     no Files row and no R2 write, so the director can look
 *                     at a clip before deciding to keep it, and the lab can
 *                     run with no database. `fetchIntoFiles` is the
 *                     production path, `lib/media/fetch.ts:fetchAsset`.
 *
 * The cache directory is the caller's (`/tmp/dv2_lab/cache` in the lab, a
 * per-tenant directory under the worker's temp in production).
 */

export type { Asset, Candidate, MediaKind, MediaQuery, Platform, ProviderKey, ProviderReport, SearchMediaOpts, UsedAsset };
export { creditLine, creditsBlock, recordUsedAssets, toUsed, PLATFORM_LABEL, TAKEDOWN_LINE, planFor, ToolError };

export type MediaCtx = {
  /** Search and fetch caches, thumbnails and work directories live under here. */
  cacheDir: string;
  /** Metered (TikHub) requests this process may spend; 60 by default (PLAN.md §4). */
  tikhubBudget?: number;
  /** How long a search answer is reused; 24 h by default. */
  searchTtlMs?: number;
};

const DEFAULT_BUDGET = 60;
const DEFAULT_SEARCH_TTL_MS = 24 * 3600_000;
/** The sources that cost a TikHub request per search. */
const METERED: ProviderKey[] = ["douyin", "tiktok"];

/** 1080p-class video only, H.264 first: the cutaway is muted anyway, and a 720p cap makes every `full` layout soft (PLAN.md §1). */
export const YTDLP_1080 = "bv*[height<=1920][width<=1920][vcodec^=avc1]/bv*[height<=1920][width<=1920][ext=mp4]/bv*[height<=1920][width<=1920]/b[height<=1920][width<=1920]/b";
const YTDLP_720 = "bv*[height<=1280][width<=1280][vcodec^=avc1]/bv*[height<=1280][width<=1280][ext=mp4]/bv*[height<=1280][width<=1280]/b";

/* ------------------------------------------------------------------ spend */

const spend = { tikhubRequests: 0, searches: 0, searchCacheHits: 0, fetches: 0, fetchCacheHits: 0, thumbs: 0, bytes: 0, ms: 0 };

/** What this process has spent on media so far; the lab writes it to cost.json. */
export function mediaSpend() {
  return { ...spend };
}

export function resetMediaSpend(): void {
  for (const k of Object.keys(spend) as (keyof typeof spend)[]) spend[k] = 0;
}

export function tikhubLeft(ctx: MediaCtx): number {
  return Math.max(0, (ctx.tikhubBudget ?? DEFAULT_BUDGET) - spend.tikhubRequests);
}

const sha = (s: string) => createHash("sha1").update(s).digest("hex");

/* At most this many downloads at once, whatever the beat limiter does: six
   beats each probing three clips would otherwise start eighteen yt-dlp
   processes against the same sites. */
const FETCH_CONCURRENCY = Number(process.env.DV2_FETCH_CONCURRENCY) || 6;
let fetching = 0;
const fetchQueue: (() => void)[] = [];
async function gate<T>(fn: () => Promise<T>): Promise<T> {
  if (fetching >= FETCH_CONCURRENCY) await new Promise<void>((resolve) => fetchQueue.push(resolve));
  fetching++;
  try {
    return await fn();
  } finally {
    fetching--;
    fetchQueue.shift()?.();
  }
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

/* ----------------------------------------------------------------- search */

export type SearchResult = SearchMediaResult & { cached: boolean; providers: ProviderReport[] };

/**
 * Which sources a search may still use: the plan's own list, minus the
 * metered ones when the budget is gone. With budget for one, one stays.
 */
function affordable(keys: ProviderKey[], ctx: MediaCtx): ProviderKey[] {
  let left = tikhubLeft(ctx);
  return keys.filter((k) => {
    if (!METERED.includes(k)) return true;
    if (left <= 0) return false;
    left--;
    return true;
  });
}

/** One metered request per 抖音/TikTok search that was actually sent, plus one for a YouTube Creative-Commons search. */
function meteredIn(reports: ProviderReport[], licence: SearchMediaOpts["licence"]): number {
  if (!env.tikhub.configured) return 0;
  let n = 0;
  for (const r of reports) {
    if (!r.query || r.error) continue;
    if (METERED.includes(r.provider)) n++;
    if (r.provider === "youtube" && licence === "cc") n++;
  }
  return n;
}

/** A direct address that has passed its expiry (抖音's play address lives about an hour). */
const expired = (c: Candidate) => c.handle.via === "direct" && Boolean(c.handle.expiresAt) && new Date(c.handle.expiresAt!).getTime() < Date.now();

/**
 * `searchMedia`, cached.
 *
 * A cached answer is served as long as it is younger than the TTL; a 抖音
 * candidate in it whose address has meanwhile expired is dropped unless the
 * fetch cache already holds its file, so a stale hit never offers the
 * judge a clip that cannot be fetched.
 */
export async function search(query: MediaQuery, opts: SearchMediaOpts, ctx: MediaCtx): Promise<SearchResult> {
  const t0 = Date.now();
  const orientation = opts.orientation ?? "any";
  const planned = opts.providers ?? planFor(opts.kind, orientation);
  const providers = affordable(planned, ctx);
  const q = typeof query === "string" ? { zh: /[㐀-鿿]/.test(query) ? query : undefined, en: /[㐀-鿿]/.test(query) ? undefined : query } : query;
  const key = sha(JSON.stringify({ zh: q.zh?.trim() ?? "", en: q.en?.trim() ?? "", kind: opts.kind, orientation, providers: [...providers].sort(), max: opts.maxDurationS ?? null, limit: opts.limit ?? 5, licence: opts.licence ?? "any" }));
  const file = path.join(ctx.cacheDir, "search", `${key}.json`);

  const hit = await readJson<{ at: number; result: SearchMediaResult }>(file);
  if (hit && Date.now() - hit.at < (ctx.searchTtlMs ?? DEFAULT_SEARCH_TTL_MS)) {
    spend.searchCacheHits++;
    const candidates = hit.result.candidates.filter((c) => !expired(c) || hasLocal(c, undefined, "1080", ctx) || hasLocal(c, undefined, "720", ctx));
    return { ...hit.result, candidates, cached: true };
  }

  if (!providers.length) return { candidates: [], providers: [], ms: 0, cached: false };
  const result = await searchMedia(q, { ...opts, providers });
  spend.searches++;
  spend.tikhubRequests += meteredIn(result.providers, opts.licence);
  spend.ms += Date.now() - t0;
  await writeJson(file, { at: Date.now(), result }).catch(() => {});
  return { ...result, cached: false };
}

/* ------------------------------------------------------------------ fetch */

export type Window = { start: number; end: number };

export type LocalFetch = {
  file: string;
  kind: MediaKind;
  /** For a picture: what the bytes are (`image/jpeg`, `image/png`, …). */
  mime?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  /** Where in the source this file begins, when only a section was downloaded. */
  sectionStartMs: number;
  cached: boolean;
};

function fetchKey(candidate: Candidate, window: Window | undefined, quality: "720" | "1080"): string {
  return sha(`${candidate.id}|${window ? `${window.start}-${window.end}` : "whole"}|${quality}`);
}

/** True when the fetch cache holds this candidate's file already (the search cache uses it to keep an expired 抖音 hit). */
export function hasLocal(candidate: Candidate, window: Window | undefined, quality: "720" | "1080", ctx: MediaCtx): boolean {
  const key = fetchKey(candidate, window, quality);
  return existsSync(path.join(ctx.cacheDir, "fetch", `${key}.json`));
}

/**
 * A candidate onto disk, cached by candidate and window.
 *
 * A video comes whole when short and as a section when `windowS` is given
 * (the yt-dlp sources download only that section; a direct address comes
 * whole and `sectionStartMs` stays 0). The caller cuts the piece it wants
 * with `lib/video/v2/window.ts:cutClip`. Nothing here touches Files.
 */
export async function fetchLocal(candidate: Candidate, opts: { windowS?: Window; quality?: "720" | "1080"; signal?: AbortSignal } = {}, ctx: MediaCtx): Promise<LocalFetch> {
  const t0 = Date.now();
  const quality = opts.quality ?? "1080";
  const key = fetchKey(candidate, opts.windowS, quality);
  const index = path.join(ctx.cacheDir, "fetch", `${key}.json`);
  const hit = await readJson<{ at: number; local: LocalFetch }>(index);
  if (hit && (await stat(hit.local.file).catch(() => null))) {
    spend.fetchCacheHits++;
    return { ...hit.local, cached: true };
  }

  const dir = path.join(ctx.cacheDir, "fetch", key);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  await mkdir(dir, { recursive: true });
  const disk = await gate(() => fetchToDisk(candidate, { dir, windowS: opts.windowS, signal: opts.signal, format: quality === "1080" ? YTDLP_1080 : YTDLP_720 }));
  const local: LocalFetch = {
    file: disk.file,
    kind: disk.kind,
    mime: disk.mime,
    durationMs: disk.durationMs,
    width: disk.width,
    height: disk.height,
    sectionStartMs: disk.windowed && opts.windowS ? Math.round(opts.windowS.start * 1000) : 0,
    cached: false,
  };
  spend.fetches++;
  spend.bytes += (await stat(disk.file).catch(() => null))?.size ?? 0;
  spend.ms += Date.now() - t0;
  await writeJson(index, { at: Date.now(), local }).catch(() => {});
  return local;
}

/** The production path: the media library imports the window into Files with attribution and its `file_meta` record. */
export function fetchIntoFiles(viewer: Viewer, candidate: Candidate, opts: FetchOpts): Promise<Asset> {
  return fetchAsset(viewer, candidate, opts);
}

/**
 * An `Asset` for a file that lives on this machine only. The id names it
 * as such, so nothing downstream mistakes it for a Files row; the credit
 * and the record are the candidate's, exactly as the library would write
 * them.
 */
export function localAsset(candidate: Candidate, clip: { file: string; durationMs?: number; width?: number; height?: number }, windowMs?: [number, number]): Asset {
  const window = windowMs ? { start: windowMs[0] / 1000, end: windowMs[1] / 1000 } : undefined;
  return {
    fileId: `local:${fetchKey(candidate, window, "1080").slice(0, 16)}`,
    candidate,
    localPath: clip.file,
    credit: candidate.credit,
    fetchedAt: new Date().toISOString(),
    durationMs: clip.durationMs,
    width: clip.width,
    height: clip.height,
    window,
  };
}

/* ------------------------------------------------------------------ thumbs */

/**
 * A candidate's thumbnail as a JPEG of the given width on disk, for the
 * judge and the contact sheet; null when it cannot be had. Sent with the
 * permalink as referer (some sites serve their pictures only to their own
 * pages) and the handle's own headers, which for Wikimedia carry the
 * descriptive user agent its policy asks for.
 */
export async function downloadThumb(candidate: Candidate, dest: string, opts: { width?: number; timeoutMs?: number } = {}): Promise<string | null> {
  const url = candidate.thumb;
  if (!url) return null;
  const raw = `${dest}.src`;
  try {
    await mkdir(path.dirname(dest), { recursive: true });
    const headers: Record<string, string> = { referer: candidate.url };
    if (candidate.handle.via === "image" && candidate.handle.headers) Object.assign(headers, candidate.handle.headers);
    await downloadToFile(url, raw, { headers, timeoutMs: opts.timeoutMs ?? 8_000, maxBytes: 12 * 1024 * 1024 });
    /* Flattened onto white first: a transparent logo would otherwise reach the judge as marks on black. */
    await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-frames:v", "1", "-vf", `${FLATTEN_ON_WHITE},scale='min(${opts.width ?? 480},iw)':-2`, "-q:v", "4", dest], { timeoutMs: 20_000 });
    spend.thumbs++;
    return dest;
  } catch {
    return null;
  } finally {
    await rm(raw, { force: true }).catch(() => {});
  }
}
