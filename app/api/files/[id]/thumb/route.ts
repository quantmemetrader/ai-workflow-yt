import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, jobs } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { relationOn } from "@/lib/authz/rebac";
import { audit } from "@/lib/audit";
import { presignDownload } from "@/lib/storage/r2";
import { posterExists, posterKeyFor } from "@/lib/files/poster";
import { enqueue } from "@/lib/jobs/queue";
import { fileInVisibleProject } from "@/lib/video/access";
import { UNREADABLE_TAG } from "@/lib/video/decodable";

/**
 * The picture a file list shows.
 *
 * Grid and Gallery drew a generic glyph on everything, including on pictures,
 * because nothing ever produced a `posterUrl`. This is that URL: the same
 * permission check `/download` makes, then a redirect to a short-lived signed
 * R2 URL, so the bytes come from storage and never through a function.
 *
 * Deliberately not `/download`:
 *
 *   — It is recorded as `file.thumbnail`, not `file.open`. A folder of forty
 *     pictures would otherwise write forty "opened this file" rows for a
 *     screen nobody read anything on, and the audit log is the record of who
 *     actually looked at what (spec §4.11). A thumbnail is still access, so it
 *     is still written down; it is just not the same event.
 *   — There is no admin break-glass here. Reading somebody's file as an
 *     administrator is a deliberate act; it should not happen because a
 *     picture scrolled past.
 *   — Pictures and video only. Anything else is 404 rather than a way to fetch
 *     a document's bytes without the audit trail a document deserves.
 *
 * Nothing is generated here. A video's poster is made once by the worker
 * (`lib/files/poster.ts`) because FFmpeg is on the box and not on Vercel, and
 * because pulling a four-gigabyte master through a request handler to make one
 * JPEG is not a thing to do while a browser waits.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  if (!viewer.modules.includes("files") && !viewer.modules.includes("video")) {
    return new Response("Not found", { status: 404 });
  }

  // A project's poster is the owner's upload; seeing the project is enough to
  // see its picture (lib/video/access.ts).
  const [rows, held, inProject] = await Promise.all([
    db
      .select()
      .from(files)
      .where(and(eq(files.id, id), eq(files.tenantId, viewer.tenantId)))
      .limit(1),
    viewer.modules.includes("files") ? relationOn(viewer, "file", id) : Promise.resolve(null),
    fileInVisibleProject(viewer, id),
  ]);

  const file = rows[0];
  /* A file in the trash still shows its picture to someone who holds it, so
     the trash is not a wall of 404s (QA, 2 Oct). Never a new poster job for it. */
  if (!file || (file.deletedAt && held === null) || (held === null && !inProject)) return new Response("Not found", { status: 404 });
  if (!file.storageKey) return new Response("Not found", { status: 404 });
  /* Still uploading. Asking the worker for a poster now used to queue a job
     for bytes that had not arrived: it failed into a minute of back-off, the
     confirm step's own poster job was deduplicated into it, and the list sat
     on a glyph until somebody reloaded. The confirm step queues the poster. */
  if (!file.checksum) return notYet();
  if (file.kind !== "image" && file.kind !== "video") return new Response("Not found", { status: 404 });

  await audit(viewer, "file.thumbnail", {
    objectType: "file",
    objectId: id,
    module: "files",
    meta: { name: file.name },
  });

  // A picture is its own thumbnail.
  if (file.kind === "image") {
    return Response.redirect(await presignDownload(file.storageKey, { expiresIn: 300 }), 302);
  }

  /* Bytes the worker found cannot be decoded (`lib/video/decodable.ts`):
     a picture that says so, rather than a spinner over 处理中 for ever, and
     never another poster job. */
  if (file.tags.includes(UNREADABLE_TAG)) return unreadable();

  if (await posterExists(file.storageKey)) {
    return Response.redirect(await presignDownload(posterKeyFor(file.storageKey), { expiresIn: 300 }), 302);
  }

  if (file.deletedAt) return new Response("Not found", { status: 404 });

  /* A poster job that already failed for this file today is not asked for
     again on every look: each thumbnail request used to queue a fresh one
     after a failure (sixteen in half an hour for one file). The upload's
     own job, or tomorrow's look, tries again. */
  const [failedLately] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.tenantId, viewer.tenantId),
        eq(jobs.objectType, "file"),
        eq(jobs.objectId, id),
        eq(jobs.type, "files.poster"),
        eq(jobs.status, "failed"),
        gt(jobs.finishedAt, new Date(Date.now() - 24 * 3600_000)),
      ),
    )
    .limit(1);
  if (failedLately) return notYet();

  /*
   * No poster yet — an older upload, or one whose job has not run. Ask for it
   * and answer 404 this once: the list falls back to the kind glyph, and the
   * picture is there next time somebody opens the folder. Deduped on the file,
   * so a grid of twenty unposted videos queues twenty jobs and not four
   * hundred.
   */
  await enqueue({
    tenantId: viewer.tenantId,
    type: "files.poster",
    module: "files",
    payload: { fileId: id },
    objectType: "file",
    objectId: id,
    createdBy: viewer.id,
    dedupeKey: `poster:${id}`,
    priority: 6,
  });

  return notYet();
}

/**
 * The thumbnail of a file that is not a decodable video: a quiet grey card
 * with a crossed-out film and 无法读取的视频, drawn as the picture itself so
 * every list that shows posters (Files, the bin, the project's files) says
 * it without knowing why. Centred, so a cover-fitted tile keeps the words.
 */
function unreadable() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">
<rect width="480" height="270" fill="#f3f3f3"/>
<g transform="translate(222 92)" fill="none" stroke="#9a9a9a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
<rect x="3" y="5" width="30" height="26" rx="4"/><path d="M10 5v26M26 5v26M3 13h7M3 23h7M26 13h7M26 23h7"/><path d="M1 1 35 35" stroke="#c42b2b"/>
</g>
<text x="240" y="168" text-anchor="middle" font-family="PingFang SC, Microsoft YaHei, Noto Sans CJK SC, sans-serif" font-size="22" font-weight="600" fill="#7a7a7a">无法读取的视频</text>
</svg>`;
  return new Response(svg, {
    status: 200,
    headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}

/** "No picture yet": never cached, so the list's next ask is really asked. */
function notYet() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}
