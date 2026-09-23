import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { relationOn } from "@/lib/authz/rebac";
import { audit } from "@/lib/audit";
import { presignDownload } from "@/lib/storage/r2";
import { posterExists, posterKeyFor } from "@/lib/files/poster";
import { enqueue } from "@/lib/jobs/queue";
import { fileInVisibleProject } from "@/lib/video/access";

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
  if (!file || file.deletedAt || (held === null && !inProject)) return new Response("Not found", { status: 404 });
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

  if (await posterExists(file.storageKey)) {
    return Response.redirect(await presignDownload(posterKeyFor(file.storageKey), { expiresIn: 300 }), 302);
  }

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

/** "No picture yet": never cached, so the list's next ask is really asked. */
function notYet() {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
}
