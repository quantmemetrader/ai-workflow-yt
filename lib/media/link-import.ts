import "server-only";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { request as httpsRequest } from "node:https";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Viewer } from "@/lib/auth/types";
import { importVideoBytes } from "@/lib/files/service";
import { tagProjectFile } from "@/lib/projects/files";
import { tikhubRequest } from "@/lib/social/tikhub";
import { addClip } from "@/lib/video/service";
import { probe, type Probe } from "@/lib/media/fetch";
import { assertFetchable, childEnv, cleanTitle, run, workDir, BROWSER_UA, YT_DLP } from "@/lib/media/tools";
import { unscrambleWechatHead, WECHAT_SCRAMBLED_BYTES } from "@/lib/media/wechat-decrypt";

/**
 * A link to somebody's video, into the project as the original file.
 *
 * The client (7 Oct): paste an Instagram reel, a 抖音 or 小红书 link — or
 * tell the assistant to — and the video is in the project, ready to cut.
 * Unlike `fetch.ts`, which takes sixty-second cutaways the director chose,
 * this takes the whole video someone pointed at, at the best quality that
 * fits the store.
 *
 * Two ways to the bytes, tried in order per platform:
 *
 *   yt-dlp   free, and from this server it works for Instagram, TikTok,
 *            YouTube and B站 (checked 7 Oct). 抖音 wants fresh cookies,
 *            小红书 finds no formats and 微博 breaks, so those skip it.
 *   TikHub   metered (a fraction of a US cent a call, 视频号 one cent),
 *            but its app APIs hand back the platform's own no-watermark
 *            file address for 抖音, 小红书, 微博, TikTok, Instagram, B站
 *            and 视频号 — the fallback when yt-dlp is refused, and the only
 *            way for the platforms it cannot do.
 *
 * Every failure ends as one Chinese sentence a person can act on (which
 * platform, what went wrong, what to do instead), because it is shown as is
 * under the link in the import box and read out by the assistant.
 *
 * The file is kept as it came when it is already H.264/AAC in an MP4 the
 * editor, the browser and Remotion all read; anything else (HEVC, VP9, a
 * rotated phone file) is re-encoded once. Files over the store's import cap
 * are re-encoded to fit at 720p; a video too long to fit at a watchable
 * bitrate is refused rather than ruined.
 */

export type LinkPlatform = "instagram" | "douyin" | "tiktok" | "xiaohongshu" | "bilibili" | "youtube" | "weibo" | "wechat" | "other";

export const LINK_PLATFORM_LABEL: Record<LinkPlatform, string> = {
  instagram: "Instagram",
  douyin: "抖音",
  tiktok: "TikTok",
  xiaohongshu: "小红书",
  bilibili: "B站",
  youtube: "YouTube",
  weibo: "微博",
  wechat: "视频号",
  other: "网页视频",
};

/** A refusal meant for a person: `message` is shown as written. `permanent`
 * tells the queue a retry would fail the same way. */
export class LinkImportError extends Error {
  readonly permanent: boolean;
  constructor(message: string, permanent = true) {
    super(message);
    this.name = "LinkImportError";
    this.permanent = permanent;
  }
}

/* What the store takes in one import (`importVideoBytes` caps at 120 MB), with room for the MP4 header. */
const STORE_CAP_BYTES = 115 * 1024 * 1024;
/* What is pulled down before anything is decided; a two-hour 4K master is not a reel. */
const DOWNLOAD_CAP_BYTES = 1536 * 1024 * 1024;
/* Forty minutes: the longest video that still fits the store at a watchable 720p. */
const MAX_DURATION_S = 40 * 60;
/* Best video plus best audio, ranked by yt-dlp's sort: up to 1080 on the short side (a
   1080×1920 reel counts as 1080p, which a `height<=1080` filter would drop), H.264 and
   AAC preferred so the file needs no re-encode. */
const YTDLP_FORMAT = "bv*+ba/b";
const YTDLP_SORT = "res:1080,vcodec:h264,acodec:aac,ext:mp4:m4a";

/* ------------------------------------------------------------- the links */

/**
 * Every link in what was pasted. People paste share text, not URLs —
 * 「7.43 复制打开抖音，看看【某某的作品】… https://v.douyin.com/xxxx/ 」 —
 * so the address is picked out of the words around it. At most ten.
 */
export function linksIn(text: string): string[] {
  const found = String(text ?? "").match(/https?:\/\/[^\s<>"'，。、；！？「」【】（）《》]+/gi) ?? [];
  const out: string[] = [];
  for (const raw of found) {
    const url = raw.replace(/[),.;!?]+$/, "");
    if (!out.includes(url)) out.push(url);
    if (out.length >= 10) break;
  }
  return out;
}

const hostIs = (host: string, ...domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));

export function platformOf(url: string): LinkPlatform {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (hostIs(host, "instagram.com", "instagr.am")) return "instagram";
  if (hostIs(host, "douyin.com", "iesdouyin.com")) return "douyin";
  if (hostIs(host, "tiktok.com")) return "tiktok";
  if (hostIs(host, "xiaohongshu.com", "xhslink.com", "xhslink.cn", "rednote.com")) return "xiaohongshu";
  if (hostIs(host, "bilibili.com", "b23.tv")) return "bilibili";
  if (hostIs(host, "youtube.com", "youtu.be")) return "youtube";
  if (hostIs(host, "weibo.com", "weibo.cn")) return "weibo";
  if (hostIs(host, "weixin.qq.com", "channels.weixin.qq.com")) return "wechat";
  return "other";
}

/**
 * A short link (v.douyin.com, xhslink.com, b23.tv, vm.tiktok.com) to the
 * page it stands for, by following the redirects without reading a page.
 * The ids every API wants are in the long form.
 */
async function expand(url: string): Promise<string> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    assertFetchable(current);
    const res = await fetch(current, { method: "GET", redirect: "manual", headers: { "user-agent": BROWSER_UA }, signal: AbortSignal.timeout(10_000), cache: "no-store" }).catch(() => null);
    const next = res && res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    await res?.body?.cancel().catch(() => {});
    if (!next) return current;
    current = new URL(next, current).toString();
  }
  return current;
}

const SHORT_HOSTS = ["v.douyin.com", "xhslink.com", "xhslink.cn", "b23.tv", "vm.tiktok.com", "vt.tiktok.com", "t.cn"];
const isShort = (url: string) => {
  try {
    const u = new URL(url);
    return SHORT_HOSTS.includes(u.hostname.toLowerCase()) || /^\/t\//.test(u.pathname);
  } catch {
    return false;
  }
};

/* 微博's base62 post codes (weibo.com/<uid>/Qi22XBN1G) to the numeric id its APIs take. */
const B62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
export function weiboMid(code: string): string {
  if (/^\d+$/.test(code)) return code;
  let out = "";
  for (let end = code.length; end > 0; end -= 4) {
    let n = 0;
    for (const ch of code.slice(Math.max(0, end - 4), end)) n = n * 62 + B62.indexOf(ch);
    const part = String(n);
    out = (end - 4 > 0 ? part.padStart(7, "0") : part) + out;
  }
  return out;
}

/* ------------------------------------------------------------- progress */

export type Progress = (fraction: number) => void;

/* ---------------------------------------------------------------- yt-dlp */

type YtInfo = { title?: string; description?: string; uploader?: string; channel?: string; uploader_id?: string; webpage_url?: string; duration?: number; is_live?: boolean };

/**
 * yt-dlp, streamed: its progress lines move the bar, and it is killed at the
 * deadline or when the job is told to stop. Writes `src.<ext>` and
 * `src.info.json` into `dir`.
 */
function ytDlp(url: string, dir: string, platform: LinkPlatform, onProgress: Progress, signal?: AbortSignal): Promise<void> {
  const args = [
    "-f", YTDLP_FORMAT,
    "-S", YTDLP_SORT,
    "--no-playlist", "--playlist-items", "1",
    "--no-warnings", "--newline", "--no-part",
    "--merge-output-format", "mp4",
    "--max-filesize", `${Math.round(DOWNLOAD_CAP_BYTES / 1048576)}M`,
    /* `<=?` lets a video whose length the site does not say through. */
    "--match-filter", `!is_live & duration<=?${MAX_DURATION_S}`,
    "--write-info-json",
    "--progress-template", "download:[dl]%(progress.downloaded_bytes)s/%(progress.total_bytes)s/%(progress.total_bytes_estimate)s",
    "-o", path.join(dir, "src.%(ext)s"),
  ];
  /* TikTok and Instagram hand a bare Python client a challenge; curl_cffi's browser fingerprint gets the page. */
  if (platform === "tiktok" || platform === "instagram") args.push("--impersonate", "chrome");
  args.push(url);

  return new Promise((resolve, reject) => {
    const child = spawn(YT_DLP, args, { env: childEnv(), signal, killSignal: "SIGKILL" });
    let stderr = "";
    let stdoutTail = "";
    /* Several files (video, then audio) download in turn; each restarts the percentage, so the bar only moves forward. */
    let best = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), 15 * 60_000);
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdoutTail = (stdoutTail + text).slice(-4000);
      for (const line of text.split("\n")) {
        const m = line.match(/\[dl\](\d+)\/(\w+)\/(\w+)/);
        if (!m) continue;
        const done = Number(m[1]);
        const total = Number(m[2]) || Number(m[3]);
        if (total > 0) {
          best = Math.max(best, Math.min(1, done / total));
          onProgress(0.1 + best * 0.7);
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new LinkImportError((err as NodeJS.ErrnoException).code === "ENOENT" ? "服务器上没有安装下载工具 yt-dlp" : `yt-dlp 无法启动：${err.message}`, false));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        if (/does not pass filter/i.test(stdoutTail)) reject(new YtError(`filter: ${stdoutTail.slice(-300)}`));
        else if (/File is larger than max-filesize/i.test(stdoutTail)) reject(new YtError("too-big"));
        else resolve();
        return;
      }
      reject(new YtError(stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 500) || `exit ${code}`));
    });
  });
}

/** yt-dlp's own words, kept for the log and read for the reason. */
class YtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YtError";
  }
}

async function firstMedia(dir: string): Promise<string | null> {
  const names = (await readdir(dir)).filter((n) => n.startsWith("src.") && !/\.(json|part|ytdl|tmp)$/.test(n));
  if (!names.length) return null;
  const pick = names.find((n) => n.endsWith(".mp4")) ?? names[0];
  return path.join(dir, pick);
}

/* ---------------------------------------------------------------- direct */

/** A file address straight to disk, with the bar moving and the cap held. */
async function download(url: string, dest: string, headers: Record<string, string>, onProgress: Progress): Promise<number> {
  assertFetchable(url);
  const res = await fetch(url, { headers: { "user-agent": BROWSER_UA, ...headers }, redirect: "follow", signal: AbortSignal.timeout(15 * 60_000), cache: "no-store" }).catch((err: unknown) => {
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : String(err);
    throw new LinkImportError(`视频文件下载失败（${cause}）`, false);
  });
  if (!res.ok || !res.body) throw new LinkImportError(`视频文件下载失败（HTTP ${res.status}）`, res.status >= 500);
  const total = Number(res.headers.get("content-length") ?? 0);
  if (total > DOWNLOAD_CAP_BYTES) throw new LinkImportError("视频文件太大（超过 1.5 GB），无法导入");
  let bytes = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > DOWNLOAD_CAP_BYTES) {
        controller.error(new LinkImportError("视频文件太大（超过 1.5 GB），无法导入"));
        return;
      }
      if (total > 0) onProgress(0.1 + Math.min(1, bytes / total) * 0.7);
      controller.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body.pipeThrough(counter) as never), createWriteStream(dest));
  return bytes;
}

/** A video and a separate audio stream (B站's DASH), into one MP4. */
async function mergeStreams(videoUrl: string, audioUrl: string | null, dest: string, referer: string): Promise<void> {
  const headers = `User-Agent: ${BROWSER_UA}\r\nReferer: ${referer}\r\n`;
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-headers", headers, "-i", videoUrl];
  if (audioUrl) args.push("-headers", headers, "-i", audioUrl);
  args.push("-map", "0:v:0");
  if (audioUrl) args.push("-map", "1:a:0");
  args.push("-c", "copy", "-movflags", "+faststart", dest);
  await run("ffmpeg", args, { timeoutMs: 15 * 60_000 });
}

/* ---------------------------------------------------------------- TikHub */

type Found = {
  /** True when the platform's own API answered (no TikHub call was spent). */
  free?: boolean;
  url: string; headers?: Record<string, string>; title?: string; author?: string; permalink?: string; wechatKey?: string; audioUrl?: string | null };

const firstUrl = (list: unknown): string | undefined => (Array.isArray(list) ? list.find((u): u is string => typeof u === "string" && /^https?:/.test(u)) : undefined);

/** The first object anywhere inside `v` that has `key`. Platform payloads move their fields between versions; the field names stay. */
function findWith(v: unknown, key: string, depth = 0): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || depth > 8) return null;
  if (!Array.isArray(v) && key in (v as Record<string, unknown>)) return v as Record<string, unknown>;
  for (const x of Array.isArray(v) ? v : Object.values(v)) {
    const hit = findWith(x, key, depth + 1);
    if (hit) return hit;
  }
  return null;
}

type Aweme = {
  aweme_id?: string;
  desc?: string;
  aweme_type?: number;
  images?: unknown[] | null;
  author?: { nickname?: string; unique_id?: string };
  video?: {
    play_addr?: { url_list?: string[] };
    play_addr_h264?: { url_list?: string[] };
    bit_rate?: { bit_rate?: number; is_h265?: number; play_addr?: { url_list?: string[] } }[];
  };
};

/** 抖音's and TikTok's shared shape: the best H.264 rendition, else the default play address (no watermark either way). */
function awemeFile(a: Aweme | undefined): string | undefined {
  if (!a?.video) return undefined;
  const h264 = (a.video.bit_rate ?? []).filter((b) => !b.is_h265 && firstUrl(b.play_addr?.url_list)).sort((x, y) => (y.bit_rate ?? 0) - (x.bit_rate ?? 0));
  return firstUrl(h264[0]?.play_addr?.url_list) ?? firstUrl(a.video.play_addr_h264?.url_list) ?? firstUrl(a.video.play_addr?.url_list);
}

async function douyinViaTikHub(url: string): Promise<Found> {
  const id = url.match(/(?:video|note|share\/video|share\/note)\/(\d{8,})/)?.[1] ?? url.match(/modal_id=(\d{8,})/)?.[1];
  const answer = id
    ? await tikhubRequest<{ aweme_detail?: Aweme }>("/api/v1/douyin/app/v3/fetch_one_video", { aweme_id: id }).catch(() => null)
    : null;
  let a = answer?.aweme_detail;
  if (!awemeFile(a)) {
    const web = await tikhubRequest<{ aweme_detail?: Aweme }>("/api/v1/douyin/web/fetch_one_video_by_share_url", { share_url: url });
    a = web.aweme_detail ?? a;
  }
  if (a && (a.images?.length || a.aweme_type === 68)) throw new LinkImportError("这条抖音是图文作品，没有视频可以导入");
  const file = awemeFile(a);
  if (!file) throw new LinkImportError("抖音没有返回这条作品的视频，可能已删除、设为私密或仅部分人可见");
  return {
    url: file,
    headers: { referer: "https://www.douyin.com/" },
    title: a?.desc,
    author: a?.author?.nickname,
    permalink: a?.aweme_id ? `https://www.douyin.com/video/${a.aweme_id}` : undefined,
  };
}

async function tiktokViaTikHub(url: string): Promise<Found> {
  const id = url.match(/\/video\/(\d{8,})/)?.[1];
  const r = id
    ? await tikhubRequest<{ aweme_detail?: Aweme; aweme_details?: Aweme[] }>("/api/v1/tiktok/app/v3/fetch_one_video", { aweme_id: id })
    : await tikhubRequest<{ aweme_detail?: Aweme; aweme_details?: Aweme[] }>("/api/v1/tiktok/app/v3/fetch_one_video_by_share_url", { share_url: url });
  const a = r.aweme_detail ?? r.aweme_details?.[0];
  const file = awemeFile(a);
  if (!file) throw new LinkImportError("TikTok 没有返回这条作品的视频，可能已删除或是图文作品");
  const handle = a?.author?.unique_id;
  return { url: file, title: a?.desc, author: a?.author?.nickname || handle, permalink: handle && a?.aweme_id ? `https://www.tiktok.com/@${handle}/video/${a.aweme_id}` : undefined };
}

type IgPost = {
  is_video?: boolean;
  video_url?: string;
  video_versions?: { url?: string; width?: number }[];
  owner?: { username?: string; full_name?: string };
  edge_media_to_caption?: { edges?: { node?: { text?: string } }[] };
  edge_sidecar_to_children?: { edges?: { node?: IgPost }[] };
  shortcode?: string;
};

async function instagramViaTikHub(url: string): Promise<Found> {
  const post = await tikhubRequest<IgPost>("/api/v1/instagram/v1/fetch_post_by_url", { post_url: url });
  /* A carousel: the first slide that is a video. */
  const slide = post.is_video ? post : post.edge_sidecar_to_children?.edges?.map((e) => e.node).find((n) => n?.is_video);
  const file = slide?.video_url ?? [...(slide?.video_versions ?? [])].sort((x, y) => (y.width ?? 0) - (x.width ?? 0))[0]?.url;
  if (!file) throw new LinkImportError("这条 Instagram 帖子里没有视频（可能是图片帖）");
  return {
    url: file,
    title: post.edge_media_to_caption?.edges?.[0]?.node?.text,
    author: post.owner?.username ? `@${post.owner.username}` : undefined,
    permalink: post.shortcode ? `https://www.instagram.com/reel/${post.shortcode}/` : undefined,
  };
}

type XhsStream = { master_url?: string; backup_urls?: string[]; width?: number };

async function xiaohongshuViaTikHub(url: string): Promise<Found> {
  const noteId = url.match(/(?:explore|discovery\/item|item)\/([0-9a-f]{24})/i)?.[1];
  const r = await tikhubRequest<{ data?: unknown }>("/api/v1/xiaohongshu/app_v2/get_video_note_detail", noteId ? { note_id: noteId } : { share_text: url });
  const note = (Array.isArray(r.data) ? r.data[0] : r.data ?? r) as {
    type?: string;
    title?: string;
    desc?: string;
    id?: string;
    user?: { nickname?: string; name?: string };
    video_info_v2?: { media?: { stream?: { h264?: XhsStream[]; h265?: XhsStream[]; av1?: XhsStream[] } } };
  };
  const stream = note?.video_info_v2?.media?.stream;
  const pick = (list?: XhsStream[]) => [...(list ?? [])].sort((x, y) => (y.width ?? 0) - (x.width ?? 0)).map((s) => s.master_url ?? firstUrl(s.backup_urls)).find(Boolean);
  const file = pick(stream?.h264) ?? pick(stream?.h265) ?? pick(stream?.av1);
  if (!file) {
    if (note?.type && note.type !== "video") throw new LinkImportError("这条小红书是图文笔记，没有视频可以导入");
    throw new LinkImportError("小红书没有返回这条笔记的视频，可能已删除或不是视频笔记");
  }
  return {
    url: file,
    headers: { referer: "https://www.xiaohongshu.com/" },
    title: note.title || note.desc,
    author: note.user?.nickname ?? note.user?.name,
    permalink: note.id ? `https://www.xiaohongshu.com/explore/${note.id}` : undefined,
  };
}

/**
 * A form POST over IPv4 only. 微博's servers take ~285 ms to accept a
 * connection from here, longer than the 250 ms Node's fetch gives an address
 * before it tries the next family — and this box has no IPv6 route, so
 * fetch gave up on a host curl reached every time.
 */
function postForm(url: string, headers: Record<string, string>, body: string): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      { method: "POST", family: 4, timeout: 10_000, headers: { "user-agent": BROWSER_UA, "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body), ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8").slice(0, 2_000_000) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

/**
 * 微博's own player API, free: a visitor cookie from passport.weibo.com and
 * one POST for the video page's play info, which lists the renditions up to
 * 1080p. Only for the video-page links (weibo.com/tv/show/1034:…), whose
 * object id TikHub's video endpoint does not take; null when 微博 says no.
 */
async function weiboViaWeb(oid: string): Promise<Found | null> {
  const visitor = await postForm("https://passport.weibo.com/visitor/genvisitor2", {}, "cb=visitor_gray_callback&tid=&from=weibo")
    .then((r) => r.text)
    .catch(() => "");
  const json = visitor.match(/\((\{[\s\S]*\})\)/)?.[1];
  const data = json ? (JSON.parse(json) as { data?: { sub?: string; subp?: string } }).data : undefined;
  if (!data?.sub) return null;
  const objectId = `1034:${oid}`;
  const res = await postForm(
    `https://weibo.com/tv/api/component?page=${encodeURIComponent(`/tv/show/${objectId}`)}`,
    { cookie: `SUB=${data.sub}; SUBP=${data.subp ?? ""}`, referer: `https://weibo.com/tv/show/${objectId}` },
    `data=${encodeURIComponent(JSON.stringify({ Component_Play_Playinfo: { oid: objectId } }))}`,
  ).catch(() => null);
  let body: { data?: { Component_Play_Playinfo?: { title?: string; text?: string; author?: string; urls?: Record<string, string> } } } | null = null;
  try {
    body = res?.status === 200 ? JSON.parse(res.text) : null;
  } catch {
    body = null;
  }
  const info = body?.data?.Component_Play_Playinfo;
  /* The renditions come best first ("高清 1080P", "高清 720P", …), as protocol-relative addresses. */
  const first = Object.values(info?.urls ?? {}).find((u) => typeof u === "string" && u.length > 4);
  if (!first) return null;
  return {
    url: first.startsWith("//") ? `https:${first}` : first,
    headers: { referer: "https://weibo.com/" },
    title: info?.title && !/的微博视频$/.test(info.title) ? info.title : info?.text?.replace(/<[^>]+>/g, "") || info?.title,
    author: info?.author,
    permalink: `https://weibo.com/tv/show/${objectId}`,
    free: true,
  };
}

async function weiboViaTikHub(url: string): Promise<Found> {
  const u = new URL(url);
  const oid = (u.pathname.match(/1034:(\d+)/) ?? u.search.match(/1034(?::|%3A)(\d+)/i))?.[1];
  const code = u.pathname.match(/\/(?:status|detail)\/(\w+)/)?.[1] ?? u.pathname.match(/^\/\d+\/(\w+)/)?.[1];
  if (oid) {
    const free = await weiboViaWeb(oid).catch(() => null);
    if (free) return free;
    throw new LinkImportError("微博没有返回这条视频，可能已删除、仅粉丝可见，或微博暂时拦截了服务器。可以换成视频所在微博的链接（weibo.com/用户/微博）再试");
  }
  const mid = code ? weiboMid(code) : null;
  if (!mid) throw new LinkImportError("没认出这个微博链接里的视频，请用视频所在微博的链接（weibo.com/tv/show/… 或 weibo.com/用户/微博）");
  const r = await tikhubRequest<unknown>("/api/v1/weibo/app/fetch_video_detail", { mid });
  const media = findWith(r, "mp4_720p_mp4") ?? findWith(r, "stream_url");
  const pickStr = (...keys: string[]) => keys.map((k) => media?.[k]).find((v): v is string => typeof v === "string" && /^https?:/.test(v));
  const file = pickStr("mp4_720p_mp4", "mp4_hd_url", "stream_url_hd", "stream_url", "mp4_sd_url");
  if (!file) throw new LinkImportError("微博没有返回这条视频的文件，可能已删除或不是视频微博");
  const user = findWith(r, "screen_name") as { screen_name?: string } | null;
  const status = findWith(r, "text") as { text?: string } | null;
  return { url: file, headers: { referer: "https://weibo.com/" }, title: (media?.kol_title as string) ?? (media?.next_title as string) ?? status?.text, author: user?.screen_name };
}

async function wechatViaTikHub(url: string): Promise<Found> {
  const share = url.match(/https?:\/\/weixin\.qq\.com\/sph\/[A-Za-z0-9]+/)?.[0];
  if (!share) throw new LinkImportError("视频号请用分享链接（weixin.qq.com/sph/…）：在视频号里点「分享」→「复制链接」");
  const r = await tikhubRequest<{ title?: string; description?: string; nickname?: string; media?: { full_url?: string; url?: string; url_token?: string; decode_key?: string } }>(
    "/api/v1/wechat_channels/v2/fetch_video_detail",
    {},
    { share_url: share, raw: false },
  );
  const file = r.media?.full_url ?? (r.media?.url ? `${r.media.url}${r.media.url_token ?? ""}` : undefined);
  if (!file) throw new LinkImportError("视频号没有返回这条视频的文件，可能已删除或仅部分人可见");
  return { url: file, title: r.title || r.description, author: r.nickname, permalink: share, wechatKey: r.media?.decode_key };
}

async function bilibiliViaTikHub(url: string): Promise<Found> {
  const bv = url.match(/(BV[0-9A-Za-z]{10})/)?.[1];
  if (!bv) throw new LinkImportError("没认出这个 B站链接里的视频号（BV…）");
  const info = await tikhubRequest<unknown>("/api/v1/bilibili/web/fetch_one_video", { bv_id: bv });
  const view = findWith(info, "cid") as { cid?: number; title?: string; owner?: { name?: string } } | null;
  if (!view?.cid) throw new LinkImportError("B站没有返回这个视频的信息，可能已删除或需要登录");
  const play = await tikhubRequest<unknown>("/api/v1/bilibili/web/fetch_video_playurl", { bv_id: bv, cid: view.cid });
  const durl = findWith(play, "durl") as { durl?: { url?: string }[] } | null;
  const dash = findWith(play, "dash") as { dash?: { video?: { baseUrl?: string; base_url?: string; height?: number; codecid?: number }[]; audio?: { baseUrl?: string; base_url?: string; bandwidth?: number }[] } } | null;
  const videos = (dash?.dash?.video ?? []).filter((v) => (v.height ?? 0) <= 1080).sort((x, y) => (y.height ?? 0) - (x.height ?? 0) || Number(y.codecid === 7) - Number(x.codecid === 7));
  const audio = [...(dash?.dash?.audio ?? [])].sort((x, y) => (y.bandwidth ?? 0) - (x.bandwidth ?? 0))[0];
  const file = videos[0]?.baseUrl ?? videos[0]?.base_url ?? durl?.durl?.[0]?.url;
  if (!file) throw new LinkImportError("B站没有返回这个视频的播放地址");
  return {
    url: file,
    audioUrl: videos[0] ? (audio?.baseUrl ?? audio?.base_url ?? null) : undefined,
    headers: { referer: "https://www.bilibili.com/" },
    title: view.title,
    author: view.owner?.name,
    permalink: `https://www.bilibili.com/video/${bv}`,
  };
}

const VIA_TIKHUB: Partial<Record<LinkPlatform, (url: string) => Promise<Found>>> = {
  instagram: instagramViaTikHub,
  douyin: douyinViaTikHub,
  tiktok: tiktokViaTikHub,
  xiaohongshu: xiaohongshuViaTikHub,
  weibo: weiboViaTikHub,
  wechat: wechatViaTikHub,
  bilibili: bilibiliViaTikHub,
};

/* yt-dlp works for these from this server; the rest go straight to TikHub (a refused yt-dlp run costs ten seconds and says nothing new). */
const YTDLP_FIRST: LinkPlatform[] = ["instagram", "tiktok", "youtube", "bilibili", "other"];

/* ----------------------------------------------------------------- reasons */

/** yt-dlp's English reason as the cause a person can do something about. */
function reasonOf(detail: string): string {
  const d = detail.toLowerCase();
  if (/private|login required|log in|sign in|cookies|rate-limit|not available.*account|age/.test(d)) return "需要登录才能看，或这个平台拦截了服务器的访问";
  if (/geo|country|region/.test(d)) return "有地区限制，服务器所在地区看不了";
  if (/unavailable|removed|deleted|not found|404|does not exist/.test(d)) return "视频不存在或已被删除";
  if (/unsupported url/.test(d)) return "这个网站不支持直接下载";
  if (/^filter:/.test(d)) return `是直播，或者长度超过 ${MAX_DURATION_S / 60} 分钟`;
  if (/^too-big/.test(d)) return "视频文件太大（超过 1.5 GB）";
  if (/timed out|timeout|connection|network|resolve/.test(d)) return "连接超时，平台暂时连不上";
  return "平台拒绝了下载";
}

/* ----------------------------------------------------------------- the take */

export type LinkDownload = {
  file: string;
  platform: LinkPlatform;
  /** yt-dlp; the platform's own web API; or TikHub. */
  via: "yt-dlp" | "web" | "tikhub";
  title: string;
  author: string | null;
  permalink: string;
  probe: Probe;
  sizeBytes: number;
};

/**
 * The link's video onto this machine, as the platform serves it — nothing
 * imported, nothing re-encoded. The caller owns `dir`. Exported on its own
 * so the download can be checked without touching the store.
 */
export async function downloadLink(input: string, dir: string, opts: { onProgress?: Progress; signal?: AbortSignal } = {}): Promise<LinkDownload> {
  const onProgress = opts.onProgress ?? (() => {});
  const [raw] = linksIn(input);
  if (!raw) throw new LinkImportError("没有找到链接，请粘贴以 http 开头的视频链接");
  try {
    assertFetchable(raw);
  } catch {
    throw new LinkImportError("这个链接不是公开网站的地址");
  }
  let url = raw;
  if (isShort(url)) url = await expand(url).catch(() => raw);
  const platform = platformOf(url);
  const label = LINK_PLATFORM_LABEL[platform];
  onProgress(0.05);

  let ytReason: string | null = null;
  if (YTDLP_FIRST.includes(platform)) {
    try {
      await ytDlp(url, dir, platform, onProgress, opts.signal);
      const file = await firstMedia(dir);
      if (!file) throw new YtError("finished without a file");
      const info = await readFile(path.join(dir, "src.info.json"), "utf8").then((t) => JSON.parse(t) as YtInfo).catch(() => ({}) as YtInfo);
      const p = await probe(file);
      if (!p.durationMs) throw new YtError("no playable video in the download");
      return {
        file,
        platform,
        via: "yt-dlp",
        /* Instagram titles every reel "Video by <handle>"; the caption says what it is. */
        title: cleanTitle((/^video by /i.test(info.title ?? "") && info.description) || info.title || info.description, `${label}视频`),
        author: info.uploader || info.channel || info.uploader_id || null,
        permalink: info.webpage_url || url,
        probe: p,
        sizeBytes: (await stat(file)).size,
      };
    } catch (err) {
      if (err instanceof LinkImportError && !err.permanent) throw err;
      ytReason = err instanceof Error ? err.message : String(err);
      console.warn(`[link-import] yt-dlp refused ${platform} ${url}: ${ytReason.slice(0, 300)}`);
      /* Whatever it left half-written goes before the second try writes. */
      for (const name of await readdir(dir).catch(() => [] as string[])) await rm(path.join(dir, name), { force: true, recursive: true }).catch(() => {});
      /* A live stream or an over-long video is not something TikHub's file address changes. */
      if (/^(filter:|too-big)/.test(ytReason)) throw new LinkImportError(`${label}：这条视频${reasonOf(ytReason)}，无法导入`);
    }
  }

  const tikhub = VIA_TIKHUB[platform];
  if (!tikhub) {
    throw new LinkImportError(
      platform === "other"
        ? `下载失败：${reasonOf(ytReason ?? "")}。目前支持 Instagram、抖音、TikTok、小红书、B站、YouTube、微博、视频号的视频链接。`
        : `${label}：下载失败，${reasonOf(ytReason ?? "")}。可以稍后再试，或下载后直接上传文件。`,
    );
  }
  let found: Found;
  try {
    found = await tikhub(url);
  } catch (err) {
    if (err instanceof LinkImportError) throw err;
    if (err instanceof Error && err.name === "TikHubUnconfigured") {
      throw new LinkImportError(`${label}：服务器直连${ytReason ? `失败（${reasonOf(ytReason)}）` : "不支持这个平台"}，备用通道 TikHub 也没有配置。请联系管理员，或下载后直接上传文件。`);
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[link-import] TikHub refused ${platform} ${url}: ${msg.slice(0, 300)}`);
    /* TikHub's 4xx is "that post is not there for us either"; its 5xx and timeouts are worth another go. */
    const transient = /\(5\d\d|did not answer|\(0\//.test(msg);
    throw new LinkImportError(`${label}：没能取到这条视频${ytReason ? `（直连：${reasonOf(ytReason)}；备用通道也失败）` : "（备用通道失败）"}。请确认链接能公开打开，稍后再试，或下载后直接上传文件。`, !transient);
  }
  onProgress(0.1);

  const file = path.join(dir, "src.mp4");
  if (found.audioUrl !== undefined) {
    await mergeStreams(found.url, found.audioUrl, file, found.headers?.referer ?? found.permalink ?? url);
  } else {
    await download(found.url, file, found.headers ?? {}, onProgress);
  }
  if (found.wechatKey) await unscrambleWechat(file, found.wechatKey);
  const p = await probe(file).catch(() => null);
  if (!p?.durationMs) throw new LinkImportError(`${label}：下载下来的文件不是能播放的视频`, false);
  return {
    file,
    platform,
    via: found.free ? "web" : "tikhub",
    title: cleanTitle(found.title, `${label}视频`),
    author: found.author?.trim() || null,
    permalink: found.permalink ?? url,
    probe: p,
    sizeBytes: (await stat(file)).size,
  };
}

/** The head of a 视频号 file, unscrambled in place (`wechat-decrypt.ts`). */
async function unscrambleWechat(file: string, key: string): Promise<void> {
  const { open } = await import("node:fs/promises");
  const fh = await open(file, "r+");
  try {
    const head = Buffer.alloc(WECHAT_SCRAMBLED_BYTES);
    const { bytesRead } = await fh.read(head, 0, head.length, 0);
    const part = head.subarray(0, bytesRead);
    if (!unscrambleWechatHead(part, key)) throw new LinkImportError("视频号的视频解密失败，请重新导入一次", false);
    await fh.write(part, 0, part.length, 0);
  } finally {
    await fh.close();
  }
}

/* ------------------------------------------------------------- normalising */

/**
 * As it came when the editor can play it and the store can hold it;
 * otherwise one H.264/AAC pass — at ≤1080p for a codec the browser cannot
 * show, and at a bitrate worked out from the length when the file is over
 * the store's cap.
 */
export async function normaliseForStore(src: string, dir: string, p: Probe, sizeBytes: number, onProgress: Progress = () => {}): Promise<{ file: string; probe: Probe; encoded: boolean }> {
  const playable = p.vcodec === "h264" && (!p.hasAudio || p.acodec === "aac") && p.rotation === 0 && /\bmp4\b/.test(p.container) && (p.width ?? 0) <= 1920 && (p.height ?? 0) <= 1920;
  if (playable && sizeBytes <= STORE_CAP_BYTES) return { file: src, probe: p, encoded: false };

  const seconds = Math.max(1, p.durationMs / 1000);
  if (seconds > MAX_DURATION_S) throw new LinkImportError(`视频长 ${Math.round(seconds / 60)} 分钟，超过了 ${MAX_DURATION_S / 60} 分钟的导入上限`);
  const out = path.join(dir, "store.mp4");
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"];
  /* What fits: the cap in bits over the length, less the audio, with a tenth spare for the container. */
  const budgetKbps = Math.floor((STORE_CAP_BYTES * 8 * 0.9) / seconds / 1000) - (p.hasAudio ? 128 : 0);
  const tooBig = sizeBytes > STORE_CAP_BYTES;
  if (tooBig && budgetKbps < 350) throw new LinkImportError(`视频太长，压到 ${Math.round(STORE_CAP_BYTES / 1048576)} MB 以内画质会太差，无法导入`);
  const edge = tooBig ? 1280 : 1920;
  if (tooBig) args.push("-b:v", `${budgetKbps}k`, "-maxrate", `${Math.round(budgetKbps * 1.3)}k`, "-bufsize", `${budgetKbps * 2}k`);
  else args.push("-crf", "20");
  args.push("-vf", `scale='min(${edge},iw)':'min(${edge},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`);
  args.push(...(p.hasAudio ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"]));
  args.push("-movflags", "+faststart", out);
  onProgress(0.85);
  await run("ffmpeg", args, { timeoutMs: 30 * 60_000 });
  const measured = await probe(out);
  const size = (await stat(out)).size;
  if (size > STORE_CAP_BYTES) throw new LinkImportError("视频压缩后仍然太大，无法导入");
  return { file: out, probe: measured, encoded: true };
}

/* ------------------------------------------------------------------ import */

export type LinkImportResult = {
  fileId: string;
  clipId: string | null;
  name: string;
  platform: LinkPlatform;
  via: LinkDownload["via"];
  title: string;
  author: string | null;
  permalink: string;
  durationMs: number;
  width: number | null;
  height: number | null;
  sizeBytes: number;
};

/**
 * Download, measure, make playable, and put it where it was asked for:
 * Files (the studio's 素材库 folder, which everybody in the studio can read,
 * like every other clip brought in from outside), the project's 素材 box,
 * and the cut's bin. Runs as the person who asked, on the worker.
 */
export async function importLink(
  viewer: Viewer,
  url: string,
  target: { workProjectId?: string | null; videoProjectId?: string | null },
  opts: { onProgress?: Progress; signal?: AbortSignal } = {},
): Promise<LinkImportResult> {
  const onProgress = opts.onProgress ?? (() => {});
  const dir = await workDir("tengya-link-");
  try {
    const got = await downloadLink(url, dir, { onProgress, signal: opts.signal });
    onProgress(0.82);
    const ready = await normaliseForStore(got.file, dir, got.probe, got.sizeBytes, onProgress);
    onProgress(0.9);

    const label = LINK_PLATFORM_LABEL[got.platform];
    const who = got.author ? (got.author.startsWith("@") ? got.author : `@${got.author}`) : "";
    const credit = `${label}${who ? ` ${who}` : ""}`;
    const bytes = await readFile(ready.file);
    const made = await importVideoBytes(viewer, {
      bytes,
      localPath: ready.file,
      name: `${label} · ${got.title.replace(/[\\/]+/g, " ").slice(0, 60)}`,
      attribution: `${credit}《${got.title.slice(0, 80)}》`,
      source: got.permalink,
      meta: {
        source: got.platform,
        importedFrom: "link",
        via: got.via,
        link: url,
        permalink: got.permalink,
        credit,
        author: got.author ? { name: got.author } : null,
        title: got.title,
        kind: "video",
        durationMs: ready.probe.durationMs,
        width: ready.probe.width ?? null,
        height: ready.probe.height ?? null,
        reencoded: ready.encoded,
        fetchedAt: new Date().toISOString(),
      },
      tags: [got.platform, "link"],
    });

    if (target.workProjectId) await tagProjectFile(viewer, target.workProjectId, made.id, "clip").catch(() => false);

    /* Into the cut's bin; the queue's dedupe key keeps one link pasted twice in a row from becoming two clips. */
    const clipId = target.videoProjectId && viewer.modules.includes("video") ? await addClip(viewer, target.videoProjectId, made.id) : null;
    onProgress(1);

    return {
      fileId: made.id,
      clipId,
      name: made.name,
      platform: got.platform,
      via: got.via,
      title: got.title,
      author: got.author,
      permalink: got.permalink,
      durationMs: ready.probe.durationMs,
      width: ready.probe.width ?? null,
      height: ready.probe.height ?? null,
      sizeBytes: bytes.byteLength,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
