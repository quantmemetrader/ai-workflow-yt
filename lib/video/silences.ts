import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Silence } from "@/lib/video/v2/types";

/**
 * Where the take is quiet, measured.
 *
 * Every cut the v2 director makes lands inside one of these. The word
 * timings cannot be trusted for that: on the 蒸馏 take 1,106 of 1,127 word
 * gaps are exactly zero and the few pauses whisper does leave are hung on
 * the *next* word's start, so a cut placed at a word boundary is a cut placed
 * somewhere in the neighbourhood of a pause — and a hundred milliseconds off
 * clips a consonant, which every viewer hears. ffmpeg's `silencedetect` reads
 * the audio itself, takes 0.6 s on a six-minute take, and is the one
 * measurement in this module that is not an opinion.
 *
 * Three layers, each usable without the one above it:
 *
 *   - `parseSilenceLog` and `mergeSilences` are pure and tested on text.
 *   - `detectSilences(file)` runs ffmpeg with `execFile` and an argument
 *     array (never a shell string: the path comes from a caller), with a
 *     deadline, and — given `cacheDir` — keeps the answer in a JSON file
 *     keyed by the file's version so the lab never measures twice.
 *   - `detectSilencesForFile(fileId, file)` is the thin database wrapper:
 *     the same answer cached in `file_meta.meta.silences` (PLAN.md §0: no
 *     schema migration; per-file caches go in `file_meta.meta`). It imports
 *     the database lazily so a lab script can load this module without
 *     `DATABASE_URL`.
 *
 * `db` is the threshold in dBFS and `minMs` the shortest quiet stretch that
 * counts. −32 dB / 250 ms is the plan's setting for sentence splitting; the
 * cut planner also asks for a finer list (80 ms) to snap a cut into a gap
 * between syllables when no proper pause is near.
 */

export type SilenceOptions = {
  /** Threshold in dBFS; anything under it is quiet. */
  db?: number;
  /** The shortest quiet stretch that counts, in milliseconds. */
  minMs?: number;
  /** Wall-clock cap for the ffmpeg run. */
  timeoutMs?: number;
  /** A directory for the lab's JSON cache; nothing is cached without it. */
  cacheDir?: string;
  /** The ffmpeg binary; `ffmpeg` on PATH by default. */
  ffmpeg?: string;
};

const DEFAULTS = { db: -32, minMs: 250, timeoutMs: 180_000, ffmpeg: "ffmpeg" } as const;

/** What the cache stores beside the list, so a stale entry is never trusted. */
export type SilenceCacheEntry = { version: string; db: number; minMs: number; list: [number, number][] };

/**
 * `silencedetect` writes one line per edge on stderr:
 *
 *   [silencedetect @ 0x…] silence_start: 38.902
 *   [silencedetect @ 0x…] silence_end: 39.859 | silence_duration: 0.957
 *
 * A start with no end is a silence that runs to the end of the file; it is
 * closed at `totalMs` when the caller gives one, otherwise dropped.
 */
export function parseSilenceLog(text: string, totalMs?: number): Silence[] {
  const out: Silence[] = [];
  let open: number | null = null;
  for (const line of text.split(/\r?\n/)) {
    const start = /silence_start:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (start) {
      open = Math.max(0, Math.round(Number(start[1]) * 1000));
      continue;
    }
    const end = /silence_end:\s*(-?\d+(?:\.\d+)?)/.exec(line);
    if (end && open !== null) {
      const endMs = Math.round(Number(end[1]) * 1000);
      if (endMs > open) out.push({ startMs: open, endMs });
      open = null;
    }
  }
  if (open !== null && totalMs !== undefined && totalMs > open) out.push({ startMs: open, endMs: totalMs });
  return mergeSilences(out);
}

/** Sorted, and any two that touch or overlap (within `joinMs`) joined. */
export function mergeSilences(list: readonly Silence[], joinMs = 20): Silence[] {
  const sorted = [...list].filter((s) => s.endMs > s.startMs).sort((a, b) => a.startMs - b.startMs);
  const out: Silence[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.startMs - last.endMs <= joinMs) last.endMs = Math.max(last.endMs, s.endMs);
    else out.push({ ...s });
  }
  return out;
}

/** The silences that lie (at least partly) inside a span. */
export function silencesInside(silences: readonly Silence[], startMs: number, endMs: number): Silence[] {
  return silences.filter((s) => s.endMs > startMs && s.startMs < endMs);
}

/**
 * A version string for the file as it is on disk: path, size and mtime plus
 * the two settings. A re-upload or a re-encode changes it; a rename does too,
 * which costs a second 0.6 s run and nothing else.
 */
export async function silenceVersion(file: string, opts: SilenceOptions = {}): Promise<string> {
  const o = { ...DEFAULTS, ...opts };
  let size = 0;
  let mtimeMs = 0;
  if (!/^https?:\/\//.test(file)) {
    const st = await stat(file);
    size = st.size;
    mtimeMs = Math.round(st.mtimeMs);
  }
  return createHash("sha1").update(`${file}|${size}|${mtimeMs}|${o.db}|${o.minMs}`).digest("hex").slice(0, 20);
}

/**
 * Run ffmpeg and read the edges. `file` may be a local path or an https URL
 * (a presigned download): silencedetect only needs the audio stream, so a
 * remote master is read once and never written to disk.
 */
export async function measureSilences(file: string, opts: SilenceOptions = {}): Promise<Silence[]> {
  const o = { ...DEFAULTS, ...opts };
  const seconds = Math.max(0.01, o.minMs / 1000);
  const args = [
    "-nostats",
    "-hide_banner",
    "-nostdin",
    "-i", file,
    "-vn",
    "-af", `silencedetect=noise=${o.db}dB:d=${seconds}`,
    "-f", "null",
    "-",
  ];
  const stderr = await new Promise<string>((resolve, reject) => {
    execFile(o.ffmpeg, args, { timeout: o.timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, err2) => {
      const text = String(err2 ?? "");
      /* ffmpeg exits 0 here; a non-zero exit with no edges at all is the
         failure worth reporting (a missing file, an unreadable stream). */
      if (err && !/silence_(start|end)/.test(text)) {
        reject(new Error(`silencedetect failed on ${file}: ${(err.message || "").slice(0, 200)} ${text.slice(-300)}`));
        return;
      }
      resolve(text);
    });
  });
  return parseSilenceLog(stderr);
}

/**
 * Silences for a file, with the lab's file cache when `cacheDir` is given.
 */
export async function detectSilences(file: string, opts: SilenceOptions = {}): Promise<Silence[]> {
  const o = { ...DEFAULTS, ...opts };
  if (!o.cacheDir) return measureSilences(file, o);

  const version = await silenceVersion(file, o);
  const cacheFile = path.join(o.cacheDir, `silences-${version}.json`);
  try {
    const entry = JSON.parse(await readFile(cacheFile, "utf8")) as SilenceCacheEntry;
    if (entry.version === version && entry.db === o.db && entry.minMs === o.minMs && Array.isArray(entry.list)) {
      return entry.list.map(([startMs, endMs]) => ({ startMs, endMs }));
    }
  } catch {
    // No cache yet, or an unreadable one: measure.
  }
  const list = await measureSilences(file, o);
  await mkdir(o.cacheDir, { recursive: true });
  const entry: SilenceCacheEntry = { version, db: o.db, minMs: o.minMs, list: list.map((s) => [s.startMs, s.endMs]) };
  await writeFile(cacheFile, JSON.stringify(entry));
  return list;
}

/**
 * The same answer cached in `file_meta.meta.silences[<db>/<minMs>]`.
 *
 * `version` is what the caller knows changes when the bytes do (the storage
 * key, or an etag); a cached entry made against another version is measured
 * again and overwritten. The read and the write each fail soft: a database
 * blip costs one 0.6 s measurement, never the cut.
 */
export async function detectSilencesForFile(
  fileId: string,
  file: string,
  version: string,
  opts: SilenceOptions = {},
): Promise<Silence[]> {
  const o = { ...DEFAULTS, ...opts };
  const key = `${o.db}/${o.minMs}`;
  type Meta = Record<string, unknown> & { silences?: Record<string, SilenceCacheEntry> };

  let meta: Meta = {};
  try {
    const [{ db }, { fileMeta }, { eq }] = await Promise.all([
      import("@/lib/db/client"),
      import("@/lib/db/schema"),
      import("drizzle-orm"),
    ]);
    const [row] = await db.select({ meta: fileMeta.meta }).from(fileMeta).where(eq(fileMeta.fileId, fileId)).limit(1);
    meta = (row?.meta as Meta | undefined) ?? {};
    const hit = meta.silences?.[key];
    if (hit && hit.version === version && Array.isArray(hit.list)) {
      return hit.list.map(([startMs, endMs]) => ({ startMs, endMs }));
    }
  } catch (err) {
    console.warn("[silences] could not read file_meta; measuring:", err instanceof Error ? err.message : err);
  }

  const list = await measureSilences(file, o);

  try {
    const [{ db }, { fileMeta }] = await Promise.all([import("@/lib/db/client"), import("@/lib/db/schema")]);
    const entry: SilenceCacheEntry = { version, db: o.db, minMs: o.minMs, list: list.map((s) => [s.startMs, s.endMs]) };
    const merged: Meta = { ...meta, silences: { ...(meta.silences ?? {}), [key]: entry } };
    await db
      .insert(fileMeta)
      .values({ fileId, meta: merged })
      .onConflictDoUpdate({ target: fileMeta.fileId, set: { meta: merged } });
  } catch (err) {
    console.warn("[silences] could not cache in file_meta:", err instanceof Error ? err.message : err);
  }
  return list;
}
