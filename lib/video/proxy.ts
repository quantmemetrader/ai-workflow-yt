import "server-only";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, relationTuples } from "@/lib/db/schema";
import { getObject, putObjectConfirmed, storageKey } from "@/lib/storage/r2";
import { grantOwner } from "@/lib/authz/rebac";
import { newId } from "@/lib/ids";
import { posterFromLocal, rememberPoster } from "@/lib/files/poster";

/**
 * A small copy to watch, beside the thing itself.
 *
 * **What this is for.** Pressing play in the editor used to stream the
 * original upload: 114 MB for a 75-second take, 570 MB for a six-minute one,
 * 12–22 Mbps, pulled from R2 in Europe to a browser in Hong Kong. The bytes
 * arrive eventually and the picture is right; the *wait* is the product. The
 * studio's words: play "has to be 100-1000% faster, like in seconds — that
 * literally defines our whole app."
 *
 * So everything here is aimed at one number — how long after the click the
 * first frame appears — and three settings carry it:
 *
 *   1. **`+faststart`.** The `moov` index is moved to the front of the file,
 *      so the browser's first range request already contains everything it
 *      needs to start decoding. Without it a player fetches the tail first to
 *      find out how the file is laid out, which over that round trip is a
 *      second gone before a single frame is asked for.
 *   2. **`-g 60`.** A keyframe every 60 frames — two seconds at 30fps, and
 *      never further apart than that on faster footage. A player can only
 *      resume at a keyframe, so this is how far a dropped scrubber can land
 *      from where it was dropped. It costs about 6% of the file, on the one
 *      thing this exists to make good.
 *   3. **480p on the short edge at CRF 28.** An order of magnitude fewer bytes
 *      per second of film, so the first seconds are in the browser before the
 *      master would have finished its handshake.
 *
 * **Always H.264 in yuv420p, never HEVC.** The studio's side-camera masters
 * come off iPhones as HEVC, which Chrome on Windows and Firefox everywhere
 * refuse to decode — those clips did not play *at all*, at any speed. The
 * proxy is re-encoded to H.264 8-bit 4:2:0, the one combination every browser
 * on every machine in the studio can show.
 *
 * **The master is still the truth.** A proxy is a convenience: it is what the
 * editor plays, never what anyone downloads, exports or renders from. Every
 * caller wraps the making of one so that a proxy which will not encode leaves
 * the upload, the clip or the export exactly as it was — playing the master,
 * which is where this started.
 *
 * Used twice: by `lib/video/render.ts` for a finished export, and by the
 * `files.proxy` job for source clips as they are uploaded.
 */

/**
 * The short edge of a proxy, in pixels.
 *
 * A knob rather than a constant because the right answer depends on the link,
 * not on the code: 360p is materially fewer bytes again, but the studio reads
 * Chinese captions off this preview and Han characters lose their strokes
 * before Latin letters lose their shape. 480 is the default because it is the
 * smallest size those captions stay legible at; drop it to 360 in the
 * worker's env if the Hong Kong link is the binding constraint, and re-run the
 * backfill.
 *
 * Read from `process.env` directly, like `lib/jobs/heavy.ts`: this is a
 * tuning number, not a secret, and `lib/env.ts` is for things that must be
 * present for the server to boot at all.
 */
export const PROXY_SHORT_EDGE = shortEdge();

function shortEdge(): number {
  const raw = Number(process.env.PROXY_SHORT_EDGE);
  // H.264 needs even dimensions, and a nonsense value should not silently
  // produce a nonsense encode.
  if (!Number.isFinite(raw) || raw < 240 || raw > 1080) return 480;
  return Math.round(raw / 2) * 2;
}

/** Two seconds at 30fps. See the note on `-g` above. */
const GOP = 60;

/** Long enough for a six-minute 4K master on a busy box, short enough that a
 * wedged encode is failed rather than held by the job timeout. */
const PROXY_TIMEOUT_MS = 30 * 60_000;

/**
 * The one FFmpeg pass, as arguments.
 *
 * Exported so a change here can be reproduced by hand on a real master
 * without guessing at what the worker actually ran.
 */
export function proxyArgs(source: string, out: string, edge = PROXY_SHORT_EDGE): string[] {
  return [
    "-y",
    "-i",
    source,
    /* Quoted because the ratio test contains the commas and colons the filter
       parser splits on. The short edge goes to `edge` whichever edge that is,
       so 16:9, 9:16 and 1:1 all keep their shape, and `-2` holds the other
       edge to the source's ratio and to an even number, which H.264 requires.
       `min(…)` is not used: a source already smaller than this is rare enough
       that upscaling it is cheaper than the surprise of two different sizes. */
    "-vf",
    `scale='if(gt(iw,ih),-2,${edge})':'if(gt(iw,ih),${edge},-2)'`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    // Not the source's pixel format: an iPhone HEVC master is 4:2:0 10-bit or
    // worse, and a browser that will not decode HEVC will not decode
    // high-bit-depth H.264 either.
    "-pix_fmt",
    "yuv420p",
    "-g",
    String(GOP),
    "-c:a",
    "aac",
    "-b:a",
    "96k",
    "-ac",
    "2",
    "-ar",
    "48000",
    // The index at the front, so the browser can play and seek from the first
    // range request instead of fetching the tail to find out how.
    "-movflags",
    "+faststart",
    out,
  ];
}

/**
 * The proxy, encoded and stored as a file of its own.
 *
 * A straight transcode: no filter graph, no fonts, no overlays — measured at
 * 2.2s for 66s of 1080x1920 film on this box. It returns the new file's id,
 * and throws rather than reporting a failure: each caller decides what a
 * missing proxy means, and the answer is always "nothing".
 */
export async function makeProxyFile(input: {
  /** The master to read: a path on local disk, or any URL FFmpeg can open. */
  source: string;
  /** A working directory belonging to the caller, who also removes it. */
  dir: string;
  name: string;
  tenantId: string;
  ownerId: string;
  folderId: string | null;
  folderPath: string[];
  durationMs: number | null;
  /**
   * Everyone besides the owner who should see this, copied from whatever the
   * proxy is a copy of. Not optional in spirit: a proxy only the owner can
   * read is worse than no proxy, because the player asks for it and gets a
   * 403 instead of quietly falling back. Callers that can tolerate that
   * (a render, whose proxy is a nicety on an export the project already
   * grants) pass a callback that swallows its own failure.
   */
  audience?: (fileId: string) => Promise<void>;
  /** Marks the row, so a proxy is never mistaken for footage — or proxied. */
  tags?: string[];
  shortEdge?: number;
}): Promise<string> {
  const { source, dir, name, tenantId, ownerId, folderId, folderPath, durationMs } = input;
  const out = path.join(dir, "proxy.mp4");

  await runFfmpeg(proxyArgs(source, out, input.shortEdge ?? PROXY_SHORT_EDGE));

  const stats = await stat(out);
  const fileId = newId("fil");
  const key = storageKey(tenantId, fileId, name);
  const stored = await putObjectConfirmed(key, await readFile(out), "video/mp4");

  await db.insert(files).values({
    id: fileId,
    tenantId,
    folderId,
    folderPath,
    name,
    kind: "video",
    mime: "video/mp4",
    sizeBytes: stats.size,
    storageKey: key,
    checksum: stored.etag,
    durationMs,
    tags: input.tags ?? [],
    ownerId,
    updatedBy: ownerId,
  });
  await grantOwner(ownerId, { type: "file", id: fileId });
  await input.audience?.(fileId);

  /* Its own still, from the source rather than from the proxy: the frame is
     cheaper to take at full size than the difference is worth arguing about,
     and a video in Files with no poster makes the thumbnail route queue a job
     that downloads this file again to draw one. */
  await posterFromLocal(source, key)
    .then((posterKey) => rememberPoster(fileId, posterKey))
    .catch((err) => console.warn(`[proxy] no poster for ${fileId}:`, err instanceof Error ? err.message : err));

  return fileId;
}

/**
 * The `files.proxy` job: a proxy for one uploaded source clip.
 *
 * Queued by `completeUpload` when a video lands, and by
 * `scripts/backfill-proxies.ts` for everything uploaded before this existed.
 * Never fails the upload or the clip that asked for it — the caller queues it
 * and walks away, and this returns a reason rather than throwing when there
 * is simply nothing to do.
 */
export async function makeSourceProxy(
  fileId: string,
): Promise<{ made: boolean; reason?: string; proxyFileId?: string; bytes?: number }> {
  const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!file) return { made: false, reason: "no such file" };
  if (file.kind !== "video") return { made: false, reason: "not a video" };
  if (!file.storageKey) return { made: false, reason: "nothing stored" };
  if (file.deletedAt) return { made: false, reason: "in the trash" };
  // A proxy of a proxy is bytes nobody will ever play. The tag is how a proxy
  // knows itself; the column below is how a master knows its proxy.
  if (file.tags.includes("proxy")) return { made: false, reason: "this is a proxy" };

  if (file.proxyFileId) {
    /* Unless the proxy row itself is gone — trashed by hand, or purged. The
       pointer is checked rather than trusted, so a master whose proxy was
       deleted gets a new one on the next run instead of pointing at a 404. */
    const [existing] = await db
      .select({ id: files.id, deletedAt: files.deletedAt })
      .from(files)
      .where(eq(files.id, file.proxyFileId))
      .limit(1);
    if (existing && !existing.deletedAt) return { made: false, reason: "already done", proxyFileId: existing.id };
  }

  const dir = await mkdtemp(path.join(tmpdir(), "proxy-"));
  try {
    /* Downloaded rather than read over its signed URL, unlike the poster job.
       A poster reads one frame and stops; this reads every byte and writes for
       minutes, and a transcode that dies two thirds of the way through because
       a long-lived HTTPS read was reset has wasted all of it. A local copy is
       one sequential read, retried by the queue if it fails, and the temp
       directory goes in the `finally` — this box is also the web server. */
    const master = path.join(dir, "master");
    await download(file.storageKey, master);

    const proxyFileId = await makeProxyFile({
      source: master,
      dir,
      name: proxyName(file.name),
      tenantId: file.tenantId,
      ownerId: file.ownerId,
      // Beside the master, so it inherits the folder's readers for free:
      // `canReadFiles` tests `folderPath` as well as the file's own tuples.
      folderId: file.folderId,
      folderPath: file.folderPath,
      durationMs: file.durationMs,
      audience: (id) => inheritFileAudience(file.id, id, file.ownerId),
      tags: ["proxy"],
    });

    /* Last, and only once the grants are copied: the column is what the
       editor reads, so it must never name a file the person cannot open. */
    await db.update(files).set({ proxyFileId }).where(eq(files.id, file.id));

    const [made] = await db.select({ bytes: files.sizeBytes }).from(files).where(eq(files.id, proxyFileId)).limit(1);
    return { made: true, proxyFileId, bytes: made?.bytes };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** `蒸馏之战 · 原片.mp4` → `蒸馏之战 · 原片 · 预览 480p.mp4`. */
function proxyName(masterName: string): string {
  const base = masterName.replace(/\.[^./\\]{1,8}$/, "");
  return `${base} · 预览 ${PROXY_SHORT_EDGE}p.mp4`;
}

/**
 * Whoever can see the master can see its proxy.
 *
 * Every tuple on the master is copied onto the proxy, expiry included, so a
 * guest with two weeks of access to a take gets exactly two weeks of the
 * preview as well. Sharing the master *later* does not reach the proxy — the
 * editor falls back to the master for that person, which is correct, if slow.
 */
async function inheritFileAudience(masterId: string, proxyId: string, grantedBy: string) {
  const audience = await db
    .select({
      relation: relationTuples.relation,
      subjectType: relationTuples.subjectType,
      subjectId: relationTuples.subjectId,
      expiresAt: relationTuples.expiresAt,
    })
    .from(relationTuples)
    .where(and(eq(relationTuples.objectType, "file"), eq(relationTuples.objectId, masterId)));
  if (!audience.length) return;
  await db
    .insert(relationTuples)
    .values(
      audience.map((a) => ({
        id: newId("tup"),
        objectType: "file" as const,
        objectId: proxyId,
        relation: a.relation,
        subjectType: a.subjectType,
        subjectId: a.subjectId,
        expiresAt: a.expiresAt,
        grantedBy,
      })),
    )
    .onConflictDoNothing();
}

/** Streamed to disk, not buffered: a master is measured in gigabytes. */
async function download(key: string, to: string) {
  const res = await getObject(key);
  if (!res.ok || !res.body) throw new Error(`Storage said ${res.status} for ${key}`);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(to));
}

/**
 * FFmpeg, with a ceiling and a readable error.
 *
 * Deliberately its own runner rather than the renderer's: that one classifies
 * a kill as `RenderInterrupted` so an export can be re-queued exactly as it
 * was, and importing it here would point `lib/video/render.ts` at a module
 * that points back. Every caller of this treats any failure the same way —
 * warn, and carry on with the master — so the distinction buys nothing.
 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostats", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      // Bounded: a broken input can produce megabytes of the same line.
      if (stderr.length < 4000) stderr += String(chunk);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("the proxy did not finish within half an hour"));
    }, PROXY_TIMEOUT_MS);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`FFmpeg could not start: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited ${code}: ${stderr.trim().slice(0, 1000)}`));
    });
  });
}
