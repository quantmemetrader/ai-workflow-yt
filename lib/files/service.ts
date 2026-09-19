import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  fileVersions,
  files,
  folders,
  relationTuples,
  users,
  type Relation,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { canReadFiles, canReadFolders, grantOwner, relationOn } from "@/lib/authz/rebac";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { deleteObject, storageKey } from "@/lib/storage/r2";

/** The shared media and document store (spec §3). Every read here is
 * permission-filtered in SQL; every write records who did it. */

export type FileRow = typeof files.$inferSelect;
export type FolderRow = typeof folders.$inferSelect;

export function kindFromMime(mime: string, name: string): FileRow["kind"] {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";
  if (/spreadsheet|excel|csv/.test(mime)) return "sheet";
  if (/zip|tar|rar|7z/.test(mime)) return "archive";
  if (mime.startsWith("text/") || /word|document|markdown/.test(mime)) return "doc";
  return /\.(md|txt|docx?|rtf)$/i.test(name) ? "doc" : "other";
}

export async function createFolder(
  viewer: Viewer,
  input: { name: string; parentId?: string | null },
): Promise<FolderRow> {
  let path: string[] = [];
  if (input.parentId) {
    const [parent] = await db.select().from(folders).where(eq(folders.id, input.parentId)).limit(1);
    if (!parent) throw new Error("Parent folder not found");
    const held = await relationOn(viewer, "folder", parent.id);
    if (held !== "owner" && held !== "editor") throw new Error("You need edit access to add a folder here");
    path = parent.path;
  }

  const id = newId("fld");
  const [folder] = await db
    .insert(folders)
    .values({
      id,
      tenantId: viewer.tenantId,
      parentId: input.parentId ?? null,
      name: input.name,
      path: [...path, id],
      ownerId: viewer.id,
    })
    .returning();

  await grantOwner(viewer.id, { type: "folder", id });
  await audit(viewer, "folder.create", { objectType: "folder", objectId: id, module: "files" });
  return folder;
}

/** Everyone gets a private home folder on first sight; nothing lands nowhere. */
export async function ensureHomeFolder(viewer: Viewer): Promise<FolderRow> {
  const [existing] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.ownerId, viewer.id), isNull(folders.parentId), eq(folders.name, "__home")))
    .limit(1);
  if (existing) return existing;
  return createFolder(viewer, { name: "__home" });
}

export async function listFolder(viewer: Viewer, folderId: string | null) {
  const where = folderId
    ? and(eq(files.folderId, folderId), isNull(files.deletedAt), canReadFiles(viewer))
    : and(isNull(files.deletedAt), canReadFiles(viewer));

  const [rows, subfolders] = await Promise.all([
    db
      .select({
        file: files,
        ownerName: users.name,
      })
      .from(files)
      .innerJoin(users, eq(users.id, files.ownerId))
      .where(where)
      .orderBy(desc(files.updatedAt))
      .limit(200),
    db
      .select()
      .from(folders)
      .where(
        and(
          folderId ? eq(folders.parentId, folderId) : isNull(folders.parentId),
          isNull(folders.deletedAt),
          canReadFolders(viewer),
        ),
      )
      .orderBy(folders.name),
  ]);

  return { files: rows, folders: subfolders.filter((f) => f.name !== "__home") };
}

/** Registers an object the browser has already PUT to R2. The row is created
 * first (so the key is known and owned), then confirmed — a failed upload
 * leaves a row with no `storageKey`, never an orphan object. */
export async function beginUpload(
  viewer: Viewer,
  input: { name: string; mime: string; sizeBytes: number; folderId?: string | null },
) {
  const folderId = input.folderId ?? (await ensureHomeFolder(viewer)).id;
  const held = await relationOn(viewer, "folder", folderId);
  if (held !== "owner" && held !== "editor") throw new Error("You need edit access to upload here");

  const [folder] = await db.select().from(folders).where(eq(folders.id, folderId)).limit(1);
  const id = newId("fil");
  const key = storageKey(viewer.tenantId, id, input.name);

  const [row] = await db
    .insert(files)
    .values({
      id,
      tenantId: viewer.tenantId,
      folderId,
      folderPath: folder?.path ?? [],
      name: input.name,
      kind: kindFromMime(input.mime, input.name),
      mime: input.mime,
      sizeBytes: input.sizeBytes,
      storageKey: key,
      ownerId: viewer.id,
      updatedBy: viewer.id,
    })
    .returning();

  await grantOwner(viewer.id, { type: "file", id });
  return { file: row, storageKey: key };
}

export async function completeUpload(viewer: Viewer, fileId: string, checksum?: string) {
  const [row] = await db
    .update(files)
    .set({ checksum, updatedAt: new Date(), updatedBy: viewer.id })
    .where(and(eq(files.id, fileId), eq(files.tenantId, viewer.tenantId)))
    .returning();

  // An id that matches nothing used to come back as `undefined` and throw on
  // the next line, turning a stale confirm into a 500.
  if (!row) throw new Error("File not found");

  // A confirm can arrive twice — a retried request, a double-clicked upload.
  // Version 1 is written once; the second attempt is a no-op, not a duplicate
  // key error.
  await db
    .insert(fileVersions)
    .values({
      id: newId("ver"),
      fileId,
      versionNo: 1,
      storageKey: row.storageKey,
      sizeBytes: row.sizeBytes,
      checksum,
      authorId: viewer.id,
      note: "Uploaded",
    })
    .onConflictDoNothing({ target: [fileVersions.fileId, fileVersions.versionNo] });

  await audit(viewer, "file.upload", {
    objectType: "file",
    objectId: fileId,
    module: "files",
    meta: { name: row.name, bytes: row.sizeBytes },
  });
  return row;
}

/** Text documents the agent (or a person) writes straight into the store. */
export async function createDocument(
  viewer: Viewer,
  input: { name: string; text: string; folderId?: string | null; tags?: string[] },
): Promise<FileRow> {
  // A named destination is checked here rather than trusted from the caller:
  // this is the entry point the screens, the agent and Research all share, and
  // a document written into someone else's folder inherits that folder's
  // readers along with it.
  if (input.folderId) {
    const held = await relationOn(viewer, "folder", input.folderId);
    if (held !== "owner" && held !== "editor") {
      throw new Error("You need edit access to add a document here");
    }
  }

  const folderId = input.folderId ?? (await ensureHomeFolder(viewer)).id;
  const [folder] = await db.select().from(folders).where(eq(folders.id, folderId)).limit(1);

  const id = newId("fil");
  const [row] = await db
    .insert(files)
    .values({
      id,
      tenantId: viewer.tenantId,
      folderId,
      folderPath: folder?.path ?? [],
      name: input.name,
      kind: "doc",
      mime: "text/markdown",
      sizeBytes: Buffer.byteLength(input.text),
      text: input.text,
      tags: input.tags ?? [],
      ownerId: viewer.id,
      updatedBy: viewer.id,
    })
    .returning();

  await grantOwner(viewer.id, { type: "file", id });
  await db.insert(fileVersions).values({
    id: newId("ver"),
    fileId: id,
    versionNo: 1,
    sizeBytes: row.sizeBytes,
    authorId: viewer.id,
    note: "Created",
  });
  await audit(viewer, "file.create", { objectType: "file", objectId: id, module: "files", meta: { name: row.name } });
  return row;
}

/** A new version, never an overwrite: the old bytes stay recoverable. */
export async function saveVersion(
  viewer: Viewer,
  fileId: string,
  input: { text?: string; storageKey?: string; sizeBytes?: number; note?: string },
) {
  const held = await relationOn(viewer, "file", fileId);
  if (held !== "owner" && held !== "editor") throw new Error("You need edit access to save a version");

  return db.transaction(async (trx) => {
    // Locked for the length of the transaction: two saves landing together
    // would otherwise read the same `version` and race for the same version
    // number, and one of them would lose its work to a duplicate key.
    const [current] = await trx.select().from(files).where(eq(files.id, fileId)).limit(1).for("update");
    if (!current) throw new Error("File not found");
    const versionNo = current.version + 1;

    const [row] = await trx
      .update(files)
      .set({
        text: input.text ?? current.text,
        storageKey: input.storageKey ?? current.storageKey,
        sizeBytes: input.sizeBytes ?? (input.text ? Buffer.byteLength(input.text) : current.sizeBytes),
        version: versionNo,
        updatedAt: new Date(),
        updatedBy: viewer.id,
      })
      .where(eq(files.id, fileId))
      .returning();

    await trx.insert(fileVersions).values({
      id: newId("ver"),
      fileId,
      versionNo,
      storageKey: row.storageKey,
      sizeBytes: row.sizeBytes,
      authorId: viewer.id,
      note: input.note,
    });

    return row;
  });
}

export async function listVersions(viewer: Viewer, fileId: string) {
  if (!(await relationOn(viewer, "file", fileId))) return [];
  return db
    .select({ version: fileVersions, authorName: users.name })
    .from(fileVersions)
    .innerJoin(users, eq(users.id, fileVersions.authorId))
    .where(eq(fileVersions.fileId, fileId))
    .orderBy(desc(fileVersions.versionNo));
}

/** Soft delete with a 30-day window (brief). Nothing leaves R2 until the
 * sweeper runs, so "restore" is a database write, not a re-upload. */
export async function softDelete(viewer: Viewer, fileId: string) {
  const held = await relationOn(viewer, "file", fileId);
  if (held !== "owner" && held !== "editor") throw new Error("You need edit access to delete this");
  await db.update(files).set({ deletedAt: new Date(), deletedBy: viewer.id }).where(eq(files.id, fileId));
  await audit(viewer, "file.delete", { objectType: "file", objectId: fileId, module: "files" });
}

export async function restore(viewer: Viewer, fileId: string) {
  const held = await relationOn(viewer, "file", fileId);
  if (held !== "owner" && held !== "editor") throw new Error("You need edit access to restore this");
  await db.update(files).set({ deletedAt: null, deletedBy: null }).where(eq(files.id, fileId));
  await audit(viewer, "file.restore", { objectType: "file", objectId: fileId, module: "files" });
}

/** Called by the cron sweeper: past the recovery window, the bytes go too. */
export async function purgeDeleted(olderThanDays = 30) {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const doomed = await db
    .select({ id: files.id, storageKey: files.storageKey })
    .from(files)
    .where(sql`${files.deletedAt} is not null and ${files.deletedAt} < ${cutoff}`)
    .limit(500);

  if (!doomed.length) return 0;
  const ids = doomed.map((f) => f.id);

  // Every version has its own object in R2, and `saveVersion` never overwrites
  // one. Deleting only the current key left every earlier version's bytes in
  // the bucket for ever — paid for, unreachable, and past the window in which
  // the studio promised they were gone.
  const versions = await db
    .select({ storageKey: fileVersions.storageKey })
    .from(fileVersions)
    .where(inArray(fileVersions.fileId, ids));

  const keys = new Set(
    [...doomed.map((f) => f.storageKey), ...versions.map((v) => v.storageKey)].filter(
      (k): k is string => Boolean(k),
    ),
  );
  for (const key of keys) await deleteObject(key).catch(() => {});

  await db.transaction(async (trx) => {
    // Tuples name their object by id and have no foreign key to follow, so
    // nothing else would ever collect them. A later file that reused the id
    // would inherit the dead grants.
    await trx
      .delete(relationTuples)
      .where(and(eq(relationTuples.objectType, "file"), inArray(relationTuples.objectId, ids)));
    await trx.delete(files).where(inArray(files.id, ids));
  });

  return doomed.length;
}

/** Moving a folder rewrites the denormalised paths of its whole subtree, and
 * of every file inside it, in one statement each. */
export async function moveFolder(viewer: Viewer, folderId: string, newParentId: string | null) {
  const held = await relationOn(viewer, "folder", folderId);
  if (held !== "owner" && held !== "editor") throw new Error("You need edit access to move this folder");

  const [folder] = await db.select().from(folders).where(eq(folders.id, folderId)).limit(1);
  if (!folder) throw new Error("Folder not found");

  let newPrefix: string[] = [];
  if (newParentId) {
    const [parent] = await db.select().from(folders).where(eq(folders.id, newParentId)).limit(1);
    if (!parent) throw new Error("Destination not found");
    if (parent.path.includes(folderId)) throw new Error("A folder cannot be moved inside itself");
    // Edit access on the destination too. A move rewrites the subtree's paths,
    // so dropping a folder somewhere hands everyone who reads *there* the whole
    // subtree — that is a grant, and it needs the same permission a grant does.
    const heldThere = await relationOn(viewer, "folder", newParentId);
    if (heldThere !== "owner" && heldThere !== "editor") {
      throw new Error("You need edit access to the destination folder");
    }
    newPrefix = parent.path;
  }

  const oldLen = folder.path.length;
  await db.transaction(async (trx) => {
    await trx.execute(sql`
      update folders
         set path = ${newPrefix}::text[] || path[${oldLen}:array_length(path,1)],
             parent_id = case when id = ${folderId} then ${newParentId} else parent_id end
       where ${folderId} = any(path)
    `);
    await trx.execute(sql`
      update files f
         set folder_path = fo.path
        from folders fo
       where f.folder_id = fo.id and ${folderId} = any(fo.path)
    `);
  });

  await audit(viewer, "folder.move", { objectType: "folder", objectId: folderId, module: "files" });
}

/** Who this is shared with, resolved to names for the share sheet. */
export async function sharesWithNames(objectType: "file" | "folder", objectId: string) {
  return db
    .select({
      tuple: relationTuples,
      userName: users.name,
      userEmail: users.email,
    })
    .from(relationTuples)
    .leftJoin(users, eq(users.id, relationTuples.subjectId))
    .where(and(eq(relationTuples.objectType, objectType), eq(relationTuples.objectId, objectId)));
}

export const RELATION_LABEL: Record<Relation, string> = {
  owner: "Owner",
  editor: "Can edit",
  commenter: "Can comment",
  viewer: "Can view",
};

/**
 * The three views the Files sidebar offers. Each is the same permission-filtered
 * query with a different lens, so nothing here can show more than the folder
 * listing would.
 */
export async function listRecent(viewer: Viewer, limit = 100) {
  return db
    .select({ file: files, ownerName: users.name })
    .from(files)
    .innerJoin(users, eq(users.id, files.ownerId))
    .where(and(isNull(files.deletedAt), canReadFiles(viewer)))
    .orderBy(desc(files.updatedAt))
    .limit(limit);
}

/** Files reached through a grant made *to this person or their team* — not the
 * ones they own, and not the studio-wide share. "Shared with me" means someone
 * chose you. */
export async function listSharedWithMe(viewer: Viewer, limit = 100) {
  const subjects = viewer.subjects.filter((s) => !s.startsWith("tenant:"));
  return db
    .select({ file: files, ownerName: users.name })
    .from(files)
    .innerJoin(users, eq(users.id, files.ownerId))
    .where(
      and(
        isNull(files.deletedAt),
        sql`${files.ownerId} <> ${viewer.id}`,
        sql`exists (
          select 1 from relation_tuples t
          where (t.subject_type || ':' || t.subject_id) in (${sql.join(
            subjects.map((s) => sql`${s}`),
            sql`, `,
          )})
            and t.relation <> 'owner'
            and (t.expires_at is null or t.expires_at > now())
            and ((t.object_type = 'file' and t.object_id = ${files.id})
              or (t.object_type = 'folder' and t.object_id = any(${files.folderPath})))
        )`,
      ),
    )
    .orderBy(desc(files.updatedAt))
    .limit(limit);
}

/** Inside the 30-day window, deleted files are still here and still restorable
 * — by anyone who could have deleted them. */
export async function listTrash(viewer: Viewer, limit = 100) {
  return db
    .select({ file: files, ownerName: users.name })
    .from(files)
    .innerJoin(users, eq(users.id, files.ownerId))
    .where(and(sql`${files.deletedAt} is not null`, canReadFiles(viewer)))
    .orderBy(desc(files.deletedAt))
    .limit(limit);
}
