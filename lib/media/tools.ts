import "server-only";
import { execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/**
 * The few things every media source and the fetcher share: where the
 * downloaders live, how a child process is run, how a file is pulled down.
 *
 * The downloaders are installed outside the repo, in /opt/fetch (see the
 * server's VERSIONS.txt there), because they are Python and a browser
 * runtime, not npm packages, and they are updated on their own schedule
 * (extractors break monthly). The paths can be moved with env vars for a
 * machine laid out differently.
 *
 * Every process here is started with `execFile` and an argument list. A
 * search query or a permalink is user input, and user input never goes
 * through a shell.
 */
export const YT_DLP = process.env.MEDIA_YTDLP || "/opt/fetch/venv/bin/yt-dlp";
export const GALLERY_DL = process.env.MEDIA_GALLERY_DL || "/opt/fetch/venv/bin/gallery-dl";
/** yt-dlp needs a JavaScript runtime for YouTube's player challenge; deno is
 * on this PATH for every child, so the tool finds it without a flag. */
const DENO_DIR = process.env.MEDIA_DENO_DIR || "/opt/fetch/deno/bin";

/** A browser's user agent, for the sites that hand a bare client a challenge page. */
export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export const STUDIO_UA = "Tengya/1.0 (studio video tool)";

export class ToolError extends Error {
  constructor(message: string, readonly detail?: string) {
    super(message);
    this.name = "ToolError";
  }
}

/**
 * Run a tool to completion. Killed outright at the timeout or when the
 * caller's signal fires: a search that has blown its budget should not keep
 * a Python process alive behind the answer.
 */
export function run(
  cmd: string,
  args: string[],
  opts: { timeoutMs: number; signal?: AbortSignal; maxBuffer?: number; cwd?: string } = { timeoutMs: 60_000 },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        timeout: opts.timeoutMs,
        killSignal: "SIGKILL",
        signal: opts.signal,
        maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
        cwd: opts.cwd,
        env: { ...process.env, PATH: `${DENO_DIR}:${process.env.PATH ?? "/usr/bin:/bin"}` },
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (err) {
          const why = (err as NodeJS.ErrnoException).code === "ENOENT" ? `${cmd} is not installed` : `${path.basename(cmd)} failed: ${String(stderr).trim().split("\n").slice(-3).join(" | ").slice(0, 400) || err.message}`;
          reject(new ToolError(why, String(stderr).slice(-2000)));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}

/** A promise with a deadline. Past it the fallback is returned and the
 * original keeps running in the background, which is fine for a search
 * whose answer has simply arrived too late to matter. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

export async function fetchText(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<string | null> {
  const { timeoutMs = 10_000, ...rest } = init;
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" }).catch(() => null);
  if (!res?.ok) return null;
  return res.text().catch(() => null);
}

export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T | null> {
  const text = await fetchText(url, { ...init, headers: { accept: "application/json", ...(init.headers as Record<string, string> | undefined) } });
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Stream a URL to disk. Stops at `maxBytes` rather than filling the disk on
 * a link that turned out to be a two-hour master. Returns the content type
 * the server declared, which the caller checks against what it expected.
 */
export async function downloadToFile(
  url: string,
  dest: string,
  opts: { headers?: Record<string, string>; timeoutMs?: number; maxBytes?: number } = {},
): Promise<{ contentType: string; bytes: number }> {
  const res = await fetch(url, {
    headers: { "user-agent": BROWSER_UA, ...opts.headers },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    redirect: "follow",
    cache: "no-store",
  });
  if (!res.ok || !res.body) throw new ToolError(`download failed: HTTP ${res.status}`);
  const max = opts.maxBytes ?? 200 * 1024 * 1024;
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > max) throw new ToolError(`download refused: ${Math.round(declared / 1048576)} MB is over the ${Math.round(max / 1048576)} MB cap`);

  let bytes = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > max) {
        controller.error(new ToolError(`download stopped: over the ${Math.round(max / 1048576)} MB cap`));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body.pipeThrough(counter) as never), createWriteStream(dest));
  return { contentType: (res.headers.get("content-type") ?? "").split(";")[0].trim(), bytes };
}

export async function workDir(prefix = "tengya-media-"): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

/** A title fit to print: hashtags off, whitespace folded, cut at 200. */
export function cleanTitle(text: string | null | undefined, fallback = "（无标题）"): string {
  const t = (text ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s*#\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.slice(0, 200) || fallback;
}

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Seconds or milliseconds, whichever the platform sent, as an ISO date. */
export function isoFromEpoch(value: unknown): string | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return new Date(n > 1e12 ? n : n * 1000).toISOString();
}

export function asCount(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value.replace(/[^\d.]/g, "")) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

/** "1:26", "12:56", "1:02:03" or plain seconds, into milliseconds. */
export function durationMsFrom(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.round(value * 1000) : undefined;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const parts = v.split(":").map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p))) return undefined;
  const seconds = parts.reduce((acc, p) => acc * 60 + p, 0);
  return seconds > 0 ? Math.round(seconds * 1000) : undefined;
}
