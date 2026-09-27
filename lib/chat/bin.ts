import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, eq, isNull, like } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, videoClips } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { addClip } from "@/lib/video/service";
import { importVideoBytes } from "@/lib/files/service";
import { canReadFiles } from "@/lib/authz/rebac";
import { presignDownload } from "@/lib/storage/r2";

const run = promisify(execFile);

/**
 * A video posted in a project's chat goes into that project's bin — once.
 *
 * The take may already be there: uploaded on the project page and then
 * dropped into the channel so 剪辑师 sees it, or attached twice while the
 * first message was still on its way. `addClip` adds every time it is
 * called (the bin may legitimately hold the same footage twice), so the
 * chat checks first, and says "已加入项目素材" for the clip that is there
 * rather than making a second block nobody asked for.
 */
export async function binVideo(viewer: Viewer, videoProjectId: string, fileId: string): Promise<{ clipId: string; existed: boolean }> {
  const [had] = await db
    .select({ id: videoClips.id })
    .from(videoClips)
    .where(and(eq(videoClips.projectId, videoProjectId), eq(videoClips.fileId, fileId)))
    .limit(1);
  if (had) return { clipId: had.id, existed: true };
  return { clipId: await addClip(viewer, videoProjectId, fileId), existed: false };
}

/**
 * A picture posted in a project's chat goes into the bin too, as a clip.
 *
 * The owner attached two images to "@剪辑师 use these to make this video" and
 * found nothing in the project's 素材: the bin only takes video. So a picture
 * becomes a five-second 9:16 shot — the picture whole in the middle over a
 * blurred fill of itself, with a slow push-in — and that shot is binned like
 * any take. The editor then cuts with it like footage; a picture with no
 * speech in the bin is the AI 配音 path's material.
 *
 * Once per picture: the shot's name carries the picture's id, so a second
 * attach names the clip that is there instead of making another.
 */
export async function binImage(viewer: Viewer, videoProjectId: string, fileId: string): Promise<{ clipId: string; existed: boolean }> {
  const mark = `#${fileId.slice(-8)}`;
  const [had] = await db
    .select({ id: videoClips.id })
    .from(videoClips)
    .innerJoin(files, eq(files.id, videoClips.fileId))
    .where(and(eq(videoClips.projectId, videoProjectId), like(files.name, `%${mark}%`)))
    .limit(1);
  if (had) return { clipId: had.id, existed: true };

  const [img] = await db
    .select({ id: files.id, name: files.name, storageKey: files.storageKey, checksum: files.checksum, folderId: files.folderId })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt), canReadFiles(viewer)))
    .limit(1);
  if (!img?.storageKey || !img.checksum) throw new Error("That picture is not there, or never finished uploading");

  const dir = await mkdtemp(join(tmpdir(), "tengya-still-"));
  try {
    const url = await presignDownload(img.storageKey, { expiresIn: 600 });
    /* Fetched once to disk: ffmpeg looping a picture read from a URL
       downloads it again for every frame — 150 fetches for five seconds —
       and was killed at its time limit, so no picture ever reached the bin. */
    /* turbopackIgnore: a temp dir made at run time. Without it the build
       read "<dir>/picture" as a pattern over the whole project (23 249 files,
       the deploy releases among them) and copied them into every release. */
    const src = join(/*turbopackIgnore: true*/ dir, "picture");
    const got = await fetch(String(url), { signal: AbortSignal.timeout(30_000) });
    if (!got.ok) throw new Error(`Could not read the picture (${got.status})`);
    await writeFile(src, Buffer.from(await got.arrayBuffer()));
    const out = join(/*turbopackIgnore: true*/ dir, "still.mp4");
    /* Blurred cover fill + the whole picture fitted on top, then a gentle
       push-in (1.00 → ~1.09 over five seconds). */
    /* The picture whole over a blurred fill of itself; the edit adds its own
       motion. About a second: the push-in drawn here used to cost three. */
    const graph = [
      "[0:v]scale=540:960:force_original_aspect_ratio=increase,crop=540:960,boxblur=12:1,eq=brightness=-0.08,scale=1080:1920[bg]",
      "[0:v]scale=1080:1920:force_original_aspect_ratio=decrease[fg]",
      "[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]",
    ].join(";");
    await run("ffmpeg", ["-v", "error", "-y", "-loop", "1", "-framerate", "30", "-t", "5", "-i", src, "-filter_complex", graph, "-map", "[v]", "-t", "5", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage", "-crf", "22", "-movflags", "+faststart", out], { timeout: 60_000 });
    const base = img.name.replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 50);
    const made = await importVideoBytes(viewer, {
      bytes: new Uint8Array(await readFile(out)),
      localPath: out,
      name: `${base} · 画面 ${mark}`,
      attribution: "由聊天里上传的图片生成的 5 秒画面",
      source: "chat-image",
      folderId: img.folderId ?? null,
    });
    return { clipId: await addClip(viewer, videoProjectId, made.id), existed: false };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
