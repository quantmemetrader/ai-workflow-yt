import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The product director's working storage on the worker box.
 *
 * One directory (`DV2_CACHE_DIR`, default `<tmp>/aura-dv2`) holding what a
 * re-run or a re-render should not have to fetch or compute again:
 *
 *   src/<fileId><ext>   the take's master, pulled out of the store once. Its
 *                       path and mtime stay put, so whisper's, the silence
 *                       detector's and the face track's caches (all keyed by
 *                       path + size + mtime) hit on the next run, and the
 *                       export's renderer reads it instead of pulling the
 *                       same 600 MB again.
 *   whisper/, silences  the pipeline's own caches (`lib/video/v2/pipeline.ts`).
 *   media/              the media adapter's search and fetch caches.
 *   runs/<projectId>/   one run's sourcing work (frames, clips, sheets);
 *                       removed when the run ends.
 *
 * `sweepV2Cache` removes anything under it untouched for three days, so
 * the box does not fill with last month's takes. A take counts as touched
 * when it was last *used* (its `.used` stamp), not when it was downloaded:
 * its own mtime is part of the other caches' keys and is never bumped.
 */
export function v2CacheDir(): string {
  return process.env.DV2_CACHE_DIR || path.join(tmpdir(), "aura-dv2");
}

/**
 * The take's master on local disk: the cached copy when it is there and the
 * size the store says, else a fresh download (to a `.part`, renamed into
 * place, so a download cut short is never mistaken for the file).
 */
export async function localTake(
  file: { id: string; name: string; storageKey: string; sizeBytes: number | null },
  download: (key: string, to: string) => Promise<void>,
): Promise<string> {
  const dir = path.join(v2CacheDir(), "src");
  await mkdir(dir, { recursive: true });
  const ext = (path.extname(file.name) || ".mp4").toLowerCase().replace(/[^.a-z0-9]/g, "") || ".mp4";
  const dest = path.join(dir, `${file.id}${ext}`);
  const stamp = () => writeFile(`${dest}.used`, new Date().toISOString()).catch(() => {});
  const have = await stat(dest).catch(() => null);
  if (have && (file.sizeBytes === null || have.size === Number(file.sizeBytes))) {
    await stamp();
    return dest;
  }
  const part = `${dest}.part`;
  await rm(part, { force: true }).catch(() => {});
  await download(file.storageKey, part);
  await rename(part, dest);
  await stamp();
  return dest;
}

/**
 * Everything under the cache untouched for `days` days goes (best effort,
 * never throws). Files go one by one; a directory goes whole only when it
 * is one unit of work (a run's directory, one fetch's directory) — the
 * cache's own folders stay, whatever their mtime says.
 */
export async function sweepV2Cache(days = 3): Promise<void> {
  const root = v2CacheDir();
  const cutoff = Date.now() - days * 86_400_000;
  const unit = (dir: string) => ["runs", "fetch"].includes(path.basename(dir));
  const walk = async (dir: string, depth: number): Promise<void> => {
    const names = await readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      if (name.endsWith(".used")) continue;
      const p = path.join(dir, name);
      const own = await stat(p).catch(() => null);
      if (!own) continue;
      if (own.isDirectory() && !unit(dir)) {
        if (depth < 4) await walk(p, depth + 1);
        continue;
      }
      /* A take is judged by its use stamp; everything else by its own mtime. */
      const used = path.basename(dir) === "src" ? await stat(`${p}.used`).catch(() => null) : null;
      if ((used ?? own).mtimeMs >= cutoff) continue;
      await rm(p, { recursive: true, force: true }).catch(() => {});
      if (used) await rm(`${p}.used`, { force: true }).catch(() => {});
    }
  };
  await walk(root, 0).catch(() => {});
}
