import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { importPictureBytes, importVideoBytes } from "@/lib/files/service";
import { PLATFORM_LABEL } from "@/lib/media/credits";
import type { Asset, Candidate } from "@/lib/media/types";
import { downloadToFile, run, workDir, ToolError, GALLERY_DL, YT_DLP } from "@/lib/media/tools";

/**
 * A candidate into the studio's own Files.
 *
 * The bytes are always copied in. Every platform address expires — 抖音's
 * within the hour, B站's in two, YouTube's and TikTok's in six — and a
 * video that depends on somebody else's CDN still serving the same file
 * next year is not a video the studio owns. So: download to a work
 * directory (yt-dlp for the pages it knows, a plain fetch for a file URL,
 * gallery-dl as the last resort for a Pinterest picture), measure with
 * ffprobe, cut and normalise to H.264/AAC MP4 when needed, and import with
 * the attribution written on the file and the full record in `file_meta`.
 *
 * Clips are short by rule: sixty seconds at most, whatever was asked for.
 * The editor wants cutaways, not features, and a cap keeps a mis-chosen
 * two-hour keynote from becoming a two-hour download and a gigabyte in R2.
 * A window (`windowS`) cuts the piece the editor actually wants, and for
 * the yt-dlp sources only that piece is downloaded.
 *
 * At most three fetches run at once, and a clip fetched once in a run is
 * not fetched again: a small on-disk cache maps permalink + window to the
 * file it already became.
 */

export type FetchOpts = {
  /** The piece wanted, in seconds from the start of the source. */
  windowS?: { start: number; end: number };
  /** Cap on the clip's length, in seconds; never above 60. */
  maxDurationS?: number;
  /** Where in Files; the studio's stock folder when unset. */
  folderId?: string | null;
  /** The spoken line this was found for, kept in the file's record. */
  forLine?: string;
  signal?: AbortSignal;
};

const MAX_CLIP_S = 60;
const CONCURRENCY = 3;
const CACHE_DIR = path.join(tmpdir(), "tengya-media-cache");
const CACHE_TTL_MS = 6 * 3600_000;

/* ------------------------------------------------------------ concurrency */

let running = 0;
const waiting: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (running < CONCURRENCY) {
    running++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
}

function release(): void {
  running--;
  waiting.shift()?.();
}

/* ------------------------------------------------------------------ cache */

function cacheKey(viewer: Viewer, candidate: Candidate, window?: FetchOpts["windowS"]): string {
  const w = window ? `${window.start}-${window.end}` : "whole";
  return createHash("sha1").update(`${viewer.tenantId}|${candidate.url}|${w}`).digest("hex");
}

async function cached(key: string): Promise<Asset | null> {
  try {
    const raw = await readFile(path.join(CACHE_DIR, `${key}.json`), "utf8");
    const entry = JSON.parse(raw) as { at: number; asset: Asset };
    if (Date.now() - entry.at > CACHE_TTL_MS) return null;
    /* The file may have been deleted from Files since; a cached id that points at nothing is worse than a second download. */
    const [row] = await db.select({ id: files.id }).from(files).where(and(eq(files.id, entry.asset.fileId), isNull(files.deletedAt))).limit(1);
    if (!row) return null;
    const local = entry.asset.localPath && (await stat(entry.asset.localPath).catch(() => null)) ? entry.asset.localPath : undefined;
    return { ...entry.asset, localPath: local, cached: true };
  } catch {
    return null;
  }
}

async function remember(key: string, asset: Asset): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify({ at: Date.now(), asset }));
  } catch {
    /* A cache that cannot be written is a cache miss next time, nothing more. */
  }
}

/* ---------------------------------------------------------------- probing */

type Probe = {
  durationMs: number;
  width?: number;
  height?: number;
  rotation: number;
  hasAudio: boolean;
  vcodec?: string;
  acodec?: string;
  container: string;
};

async function probe(file: string): Promise<Probe> {
  const { stdout } = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration,format_name:stream=codec_type,codec_name,width,height:stream_side_data=rotation:stream_tags=rotate", "-of", "json", file],
    { timeoutMs: 30_000 },
  );
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; format_name?: string };
    streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; side_data_list?: { rotation?: number }[]; tags?: { rotate?: string } }[];
  };
  const video = parsed.streams?.find((s) => s.codec_type === "video");
  const audio = parsed.streams?.find((s) => s.codec_type === "audio");
  const rotation = Math.abs(Number(video?.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation ?? video?.tags?.rotate ?? 0)) % 360;
  /* A rotated phone clip stores its frame sideways; the display size is the other way round. */
  const sideways = rotation === 90 || rotation === 270;
  const seconds = Number(parsed.format?.duration);
  return {
    durationMs: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0,
    width: sideways ? video?.height : video?.width,
    height: sideways ? video?.width : video?.height,
    rotation,
    hasAudio: Boolean(audio),
    vcodec: video?.codec_name,
    acodec: audio?.codec_name,
    container: parsed.format?.format_name ?? "",
  };
}

/* ------------------------------------------------------------ downloading */

/* 720p H.264 with AAC where the site offers it; otherwise the best single file — normalisation below evens it out. */
const YTDLP_FORMAT = "bv*[height<=720][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=720][ext=mp4]+ba/b[height<=720]/b";

async function firstFile(dir: string, prefix: string): Promise<string | null> {
  const names = (await readdir(dir)).filter((n) => n.startsWith(prefix) && !n.endsWith(".part") && !n.endsWith(".ytdl"));
  if (!names.length) return null;
  /* Several files means a merge left its parts; the .mp4 is the merged one. */
  const pick = names.find((n) => n.endsWith(".mp4")) ?? names[0];
  return path.join(dir, pick);
}

async function viaYtDlp(url: string, dir: string, window: FetchOpts["windowS"], signal?: AbortSignal): Promise<string> {
  const args = ["-f", YTDLP_FORMAT, "--no-playlist", "--no-warnings", "--merge-output-format", "mp4", "-o", path.join(dir, "src.%(ext)s")];
  if (window) args.push("--download-sections", `*${window.start}-${window.end}`);
  args.push(url);
  await run(YT_DLP, args, { timeoutMs: 240_000, signal });
  const file = await firstFile(dir, "src.");
  if (!file) throw new ToolError("yt-dlp finished without a file");
  return file;
}

async function downloadVideo(candidate: Candidate, dir: string, window: FetchOpts["windowS"], signal?: AbortSignal): Promise<{ file: string; windowed: boolean }> {
  const h = candidate.handle;
  if (h.via === "yt-dlp") {
    try {
      return { file: await viaYtDlp(h.url, dir, window, signal), windowed: Boolean(window) };
    } catch (err) {
      if (!h.fallbackUrl) throw err;
      /* The tool could not reach it (a region-locked TikTok post, say); the platform's own file address still may. */
      const file = path.join(dir, "src.mp4");
      await downloadToFile(h.fallbackUrl, file, { timeoutMs: 180_000 });
      return { file, windowed: false };
    }
  }
  if (h.via === "direct") {
    if (h.expiresAt && new Date(h.expiresAt).getTime() < Date.now()) throw new ToolError("that clip's address has expired; search again");
    const file = path.join(dir, "src.mp4");
    /* B站 refuses a bare request for its CDN files; the others do not mind the header. */
    await downloadToFile(h.url, file, { headers: { referer: candidate.platform === "bilibili" ? "https://www.bilibili.com/" : candidate.url, ...h.headers }, timeoutMs: 180_000 });
    return { file, windowed: false };
  }
  throw new ToolError("that candidate is a picture, not a clip");
}

/** What the bytes say they are, which is what matters; the server's header is a hint at best. */
function imageMime(head: Buffer, declared: string): string | null {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (head.length >= 6 && head.subarray(0, 3).toString("ascii") === "GIF") return "image/gif";
  if (head.length >= 12 && head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (head.length >= 12 && head.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = head.subarray(8, 12).toString("ascii");
    if (brand === "avif") return "image/avif";
    /* HEIC and friends: real pictures that no browser will draw. */
    return null;
  }
  if (head.length >= 2 && head.subarray(0, 2).toString("ascii") === "BM") return "image/bmp";
  if (declared === "image/svg+xml" && /<svg[\s>]/i.test(head.toString("utf8"))) return "image/svg+xml";
  return null;
}

async function downloadImage(candidate: Candidate, dir: string): Promise<{ file: string; mime: string }> {
  const h = candidate.handle;
  if (h.via !== "image") throw new ToolError("that candidate is a clip, not a picture");
  const tries = [h.url, h.fallbackUrl].filter((u): u is string => Boolean(u));
  let lastError: unknown = null;
  for (const [i, url] of tries.entries()) {
    const file = path.join(dir, `img${i}.bin`);
    try {
      const { contentType } = await downloadToFile(url, file, { headers: h.headers, timeoutMs: 40_000, maxBytes: 25 * 1024 * 1024 });
      const head = Buffer.from((await readFile(file)).subarray(0, 32));
      const mime = imageMime(head, contentType);
      if (mime) return { file, mime };
      lastError = new ToolError(`not a picture a browser can show (${contentType || "unknown type"})`);
    } catch (err) {
      lastError = err;
    }
  }
  /* Pinterest sometimes serves the CDN file only to its own downloader's request shape; gallery-dl knows it. */
  if (candidate.platform === "pinterest") {
    await run(GALLERY_DL, ["-D", dir, "-o", "videos=false", "-f", "pin.{extension}", candidate.url], { timeoutMs: 60_000 });
    const file = await firstFile(dir, "pin.");
    if (file) {
      const head = Buffer.from((await readFile(file)).subarray(0, 32));
      const mime = imageMime(head, "");
      if (mime) return { file, mime };
    }
  }
  throw lastError instanceof Error ? lastError : new ToolError("the picture could not be fetched");
}

/* ------------------------------------------------------------ normalising */

/**
 * H.264 + AAC in an MP4 at 720p-class size, which is what the editor's
 * proxy maker, the browser and Remotion all read without complaint. A clip
 * that is already that, uncut, is used as it is. Cuts are re-encoded rather
 * than stream-copied so the piece starts where it was asked to, not at the
 * previous keyframe.
 */
async function normalise(src: string, dst: string, p: Probe, cut: FetchOpts["windowS"] | undefined): Promise<boolean> {
  const isMp4 = /\bmp4\b/.test(p.container);
  const fine = !cut && p.vcodec === "h264" && (!p.hasAudio || p.acodec === "aac") && p.rotation === 0 && isMp4 && (p.width ?? 0) <= 1920 && (p.height ?? 0) <= 1920;
  if (fine) return false;
  const args: string[] = ["-hide_banner", "-loglevel", "error", "-y"];
  if (cut) args.push("-ss", String(Math.max(0, cut.start)));
  args.push("-i", src);
  if (cut) args.push("-t", String(Math.max(0.5, cut.end - cut.start)));
  args.push("-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p");
  args.push("-vf", "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2");
  args.push(p.hasAudio ? "-c:a" : "-an");
  if (p.hasAudio) args.push("aac", "-b:a", "128k");
  args.push("-movflags", "+faststart", dst);
  await run("ffmpeg", args, { timeoutMs: 300_000 });
  return true;
}

/* ------------------------------------------------------------------ fetch */

const stem = (candidate: Candidate) => `${PLATFORM_LABEL[candidate.platform]} · ${candidate.title.replace(/[\\/]+/g, " ").slice(0, 48)}`;

function attributionOf(candidate: Candidate): string {
  const licence = candidate.licence && !candidate.licence.startsWith("stock:") ? ` — ${candidate.licence}` : "";
  return `${candidate.credit}《${candidate.title.slice(0, 80)}》${licence}`;
}

export async function fetchAsset(viewer: Viewer, candidate: Candidate, opts: FetchOpts = {}): Promise<Asset> {
  const maxS = Math.min(MAX_CLIP_S, Math.max(1, opts.maxDurationS ?? MAX_CLIP_S));
  const window = opts.windowS && opts.windowS.end > opts.windowS.start ? { start: Math.max(0, opts.windowS.start), end: Math.min(opts.windowS.end, opts.windowS.start + maxS) } : undefined;
  const key = cacheKey(viewer, candidate, candidate.kind === "video" ? window : undefined);
  const hit = await cached(key);
  if (hit) return hit;

  await acquire();
  const dir = await workDir();
  try {
    const fetchedAt = new Date().toISOString();
    const meta = {
      source: candidate.platform,
      credit: candidate.credit,
      permalink: candidate.url,
      author: candidate.author,
      licence: candidate.licence ?? null,
      title: candidate.title,
      kind: candidate.kind,
      candidateId: candidate.id,
      window: window ?? null,
      forLine: opts.forLine ?? null,
      fetchedAt,
    };

    if (candidate.kind === "image") {
      const { file, mime } = await downloadImage(candidate, dir);
      const bytes = await readFile(file);
      const size = await probe(file).catch(() => null);
      const { id } = await importPictureBytes(viewer, {
        bytes,
        mime,
        name: stem(candidate),
        attribution: attributionOf(candidate),
        source: candidate.url,
        folderId: opts.folderId,
        meta,
        tags: [candidate.platform],
        width: size?.width ?? candidate.width ?? null,
        height: size?.height ?? candidate.height ?? null,
      });
      const asset: Asset = { fileId: id, candidate, credit: candidate.credit, fetchedAt, width: size?.width ?? candidate.width, height: size?.height ?? candidate.height };
      await remember(key, asset);
      return asset;
    }

    const { file, windowed } = await downloadVideo(candidate, dir, window, opts.signal);
    const p = await probe(file);
    if (!p.durationMs) throw new ToolError("the download has no playable video in it");
    /* What still has to be cut: the window when the whole file came down, or the cap when the piece is over it. */
    let cut: FetchOpts["windowS"] | undefined;
    if (window && !windowed) cut = window;
    else if (p.durationMs > (maxS + 1) * 1000) cut = { start: 0, end: maxS };
    const out = path.join(dir, "clip.mp4");
    const encoded = await normalise(file, out, p, cut);
    const final = encoded ? out : file;
    if (!encoded && !final.endsWith(".mp4")) await rename(final, out);
    const finalPath = encoded || !final.endsWith(".mp4") ? out : final;
    const measured = encoded ? await probe(finalPath) : p;

    const { id } = await importVideoBytes(viewer, {
      bytes: await readFile(finalPath),
      localPath: finalPath,
      name: stem(candidate),
      attribution: attributionOf(candidate),
      source: candidate.url,
      folderId: opts.folderId,
      meta: { ...meta, durationMs: measured.durationMs, width: measured.width ?? null, height: measured.height ?? null, hasAudio: measured.hasAudio },
      tags: [candidate.platform],
    });
    /* The source is not needed once the clip is; the clip stays for the caller while the run lasts. */
    if (finalPath !== file) await rm(file, { force: true }).catch(() => {});
    const asset: Asset = {
      fileId: id,
      candidate,
      localPath: finalPath,
      credit: candidate.credit,
      fetchedAt,
      durationMs: measured.durationMs,
      width: measured.width,
      height: measured.height,
      window: window ?? cut,
    };
    await remember(key, asset);
    return asset;
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  } finally {
    release();
  }
}

/** Several at once, three at a time; a failure is reported beside the ones that worked rather than sinking them. */
export async function fetchAssets(
  viewer: Viewer,
  candidates: Candidate[],
  opts: FetchOpts = {},
): Promise<{ assets: Asset[]; failed: { candidate: Candidate; error: string }[] }> {
  const results = await Promise.allSettled(candidates.map((c) => fetchAsset(viewer, c, opts)));
  const assets: Asset[] = [];
  const failed: { candidate: Candidate; error: string }[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") assets.push(r.value);
    else failed.push({ candidate: candidates[i], error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
  });
  return { assets, failed };
}
