import { and, eq, inArray, isNull, lt, notExists, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { fileVersions, files, relationTuples } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { relationOn } from "@/lib/authz/rebac";
import { deleteObject, headObject } from "@/lib/storage/r2";
import { audit } from "@/lib/audit";

/**
 * An upload that will never finish leaves nothing behind.
 *
 * The row is made before the first byte moves — that is what owns the key
 * and the permissions — so an upload that dies leaves a row with a name, a
 * size and no bytes. Until now that row stayed: it sat in Files as a file,
 * opened to nothing, and the person who had just watched 590 MB fail was
 * then shown it as if it had worked. The abort route had left it on purpose,
 * reasoning that "no version" already marks it; a list does not show that.
 *
 * Both are hard deletes, not trash. A file that never existed has nothing to
 * recover, and a row in the trash is one more thing that says "file".
 */

/** Only ever a row whose object never arrived. A confirmed file has a
 * version; that one is kept whatever the browser says. */
export async function abandonUpload(viewer: Viewer, fileId: string): Promise<"gone" | "kept" | "missing"> {
  const held = await relationOn(viewer, "file", fileId);
  if (held !== "owner" && held !== "editor") return "missing";

  const [row] = await db
    .select({ id: files.id, storageKey: files.storageKey, name: files.name })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.tenantId, viewer.tenantId)))
    .limit(1);
  if (!row) return "missing";

  const [version] = await db
    .select({ id: fileVersions.id })
    .from(fileVersions)
    .where(eq(fileVersions.fileId, fileId))
    .limit(1);
  if (version) return "kept";

  await remove([row]);
  await audit(viewer, "file.abandon", { objectType: "file", objectId: fileId, module: "files", meta: { name: row.name } });
  return "gone";
}

/**
 * The sweep's version, for rows whose browser never got to say anything — a
 * closed laptop, a killed tab. Anything a day old with no version *and* no
 * object at its key never arrived. The object is checked, not assumed: a
 * render writes its file without a version row, and must not be swept.
 */
export async function purgeUnfinished(olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
  const candidates = await db
    .select({ id: files.id, storageKey: files.storageKey, name: files.name })
    .from(files)
    .where(
      and(
        isNull(files.deletedAt),
        lt(files.createdAt, cutoff),
        sql`not ('stock' = any(${files.tags}))`,
        notExists(db.select({ one: sql`1` }).from(fileVersions).where(eq(fileVersions.fileId, files.id))),
      ),
    )
    .limit(200);

  const doomed: typeof candidates = [];
  for (const row of candidates) {
    if (!row.storageKey) {
      doomed.push(row);
      continue;
    }
    const head = await headObject(row.storageKey).catch(() => undefined);
    // `undefined` is "could not ask", which is not "not there".
    if (head === null) doomed.push(row);
  }
  if (doomed.length) await remove(doomed);
  return doomed.length;
}

async function remove(rows: { id: string; storageKey: string | null }[]) {
  const ids = rows.map((r) => r.id);
  // Nothing should be at the key — a multipart upload has no object until it
  // is completed and a single PUT is all or nothing — but a key nobody will
  // ever reference again is worth one cheap DELETE each to be certain.
  for (const r of rows) if (r.storageKey) await deleteObject(r.storageKey).catch(() => {});
  await db.transaction(async (trx) => {
    await trx.delete(relationTuples).where(and(eq(relationTuples.objectType, "file"), inArray(relationTuples.objectId, ids)));
    await trx.delete(files).where(inArray(files.id, ids));
  });
}
