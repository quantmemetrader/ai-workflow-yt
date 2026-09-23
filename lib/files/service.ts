import "server-only";
import { setFileAccess, type AccessChoice } from "@/lib/files/access";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  fileVersions,
  files,
  folders,
  relationTuples,
  users,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { canReadFiles, canReadFolders, grantOwner, relationOn, type SharedObject } from "@/lib/authz/rebac";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { deleteObject, putObjectConfirmed, storageKey } from "@/lib/storage/r2";
import { enqueue } from "@/lib/jobs/queue";

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
    // The studio's owner and admins can add anywhere in their own studio.
    const admin = viewer.isAdmin && parent.tenantId === viewer.tenantId;
    if (held !== "owner" && held !== "editor" && !admin) throw new Error("You need edit access to add a folder here");
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

/**
 * Where the things brought in from outside go.
 *
 * A picture from the Creative Commons index or a stock clip from Pexels is a
 * real file with a licence on it and has to live somewhere, but it is not
 * something the studio made, and thirty of them at the top of Files buried
 * the footage people had shot. They go in one folder of their own under the
 * person's home, made on first use.
 */
export const STOCK_FOLDER = "素材库 · Stock";

export async function ensureStockFolder(viewer: Viewer): Promise<FolderRow> {
  // One per studio, not one per person: a top-level folder (so it is in the
  // sidebar and one click away; the home folder is hidden), found by name
  // whoever made it, and readable by everyone in the tenant. Files inside
  // inherit that through their folder path, so a teammate opening a shared
  // project sees the stock clips and pictures the director fetched rather
  // than glyphs and a black preview.
  const [existing] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.tenantId, viewer.tenantId), isNull(folders.parentId), eq(folders.name, STOCK_FOLDER), isNull(folders.deletedAt)))
    .orderBy(asc(folders.createdAt))
    .limit(1);
  const folder = existing ?? (await createFolder(viewer, { name: STOCK_FOLDER }));
  await db
    .insert(relationTuples)
    .values({
      id: newId("tup"),
      objectType: "folder",
      objectId: folder.id,
      relation: "viewer",
      subjectType: "tenant",
      subjectId: viewer.tenantId,
      grantedBy: viewer.id,
    })
    .onConflictDoNothing();
  return folder;
}

export async function listFolder(viewer: Viewer, folderId: string | null) {
  /* The top level is everything you can read, less the stock: a licensed
     picture the director fetched for one cutaway is not what somebody
     opening Files came for. It is all in its own folder, one click away. */
  /* Proxies — the 480p copy the editor plays instead of the master — are
     never listed. They are an implementation detail of playback, tagged
     `proxy` when made, and a folder that shows every master twice reads as
     duplicated uploads. The file page still reaches them by id. */
  const notProxy = sql`not ('proxy' = any(${files.tags}))`;
  const where = folderId
    ? and(eq(files.folderId, folderId), isNull(files.deletedAt), canReadFiles(viewer), notProxy)
    : and(isNull(files.deletedAt), canReadFiles(viewer), sql`not ('stock' = any(${files.tags}))`, notProxy);

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

/** The folders the sidebar lists: every top-level folder this person can
 * read, less their hidden home. The same list on every Files view; Recent,
 * Shared and Trash used to pass none, so the Stock folder vanished the moment
 * you clicked one of them. */
export async function sidebarFolders(viewer: Viewer) {
  const rows = await db
    .select({ id: folders.id, name: folders.name })
    .from(folders)
    .where(and(isNull(folders.parentId), isNull(folders.deletedAt), canReadFolders(viewer)))
    .orderBy(folders.name);
  return rows.filter((f) => f.name !== "__home");
}

/** Registers an object the browser has already PUT to R2. The row is created
 * first (so the key is known and owned), then confirmed — a failed upload
 * leaves a row with no `storageKey`, never an orphan object. */
export async function beginUpload(
  viewer: Viewer,
  input: { name: string; mime: string; sizeBytes: number; folderId?: string | null; access?: AccessChoice },
) {
  const folderId = input.folderId ?? (await ensureHomeFolder(viewer)).id;
  const held = await relationOn(viewer, "folder", folderId);
  const [folder] = await db.select().from(folders).where(eq(folders.id, folderId)).limit(1);
  // The studio's owner and admins can upload anywhere in their own studio.
  const admin = viewer.isAdmin && folder?.tenantId === viewer.tenantId;
  if (held !== "owner" && held !== "editor" && !admin) throw new Error("You need edit access to upload here");

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
  // Who sees it, chosen in the upload dialog. Private needs nothing more.
  if (input.access && input.access.mode !== "private") await setFileAccess(viewer, [id], input.access);
  return { file: row, storageKey: key };
}

/**
 * Take a picture from outside into the studio's own store.
 *
 * Used when somebody — or the assistant on their behalf — picks a Creative
 * Commons picture to put on a video. Three things make this safe to do
 * automatically:
 *
 *   1. **The bytes are copied here.** A video that depends on somebody else's
 *      server still rendering the same file next year is not a video the
 *      studio owns.
 *   2. **The licence comes with it.** The attribution line is written into the
 *      file's own text, so "whose picture is that and under what licence" is
 *      answerable from the file itself, for ever, by anybody.
 *   3. **It belongs to whoever asked for it**, in their own folder, under the
 *      same permissions as anything else they upload.
 */
export async function importPicture(
  viewer: Viewer,
  input: { url: string; name: string; attribution: string; source: string; folderId?: string | null },
): Promise<{ id: string; name: string }> {
  const target = new URL(input.url);
  if (target.protocol !== "https:") throw new Error("That picture is not served over https");

  const upstream = await fetch(target, {
    headers: { accept: "image/*", "user-agent": "Tengya/1.0 (studio video tool)" },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!upstream?.ok) throw new Error("That picture could not be fetched");

  const mime = (upstream.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!mime.startsWith("image/")) throw new Error("That link is not a picture");

  const body = new Uint8Array(await upstream.arrayBuffer());
  if (body.byteLength === 0) throw new Error("That picture came back empty");
  if (body.byteLength > 25 * 1024 * 1024) throw new Error("That picture is too big to bring in");

  const extension = mime.split("/")[1]?.replace("jpeg", "jpg").slice(0, 5) || "jpg";
  const name = `${input.name.replace(/[\\/]+/g, " ").trim().slice(0, 80) || "picture"}.${extension}`;

  const { file, storageKey: key } = await beginUpload(viewer, {
    name,
    mime,
    sizeBytes: body.byteLength,
    folderId: input.folderId ?? (await ensureStockFolder(viewer)).id,
  });

  const stored = await putObjectConfirmed(key, body, mime);

  await db
    .update(files)
    .set({
      // Confirmed here rather than through the browser's complete step.
      checksum: stored.etag,
      tags: ["stock"],
      /* `text` is what search reads and what a person sees in the detail
         panel. The licence lives here because a credit that only exists in a
         chat transcript is a credit nobody can find later. */
      text: [input.attribution, input.source].filter(Boolean).join("\n"),
      updatedAt: new Date(),
      updatedBy: viewer.id,
    })
    .where(eq(files.id, file.id));

  await audit(viewer, "file.import", {
    objectType: "file",
    objectId: file.id,
    module: "files",
    meta: { source: input.source, attribution: input.attribution.slice(0, 200) },
  });

  return { id: file.id, name };
}

/**
 * A stock clip, brought into the studio's files.
 *
 * Streamed to disk rather than held in memory, then put in the store as a
 * confirmed file with its length measured, so the bin can take it at once.
 * The licence and the creator are written on the file, the same rule the
 * pictures follow: a cutaway that ships in a video can always answer whose.
 */
export async function importVideo(
  viewer: Viewer,
  input: { url: string; name: string; attribution: string; source: string; folderId?: string | null },
): Promise<{ id: string; name: string; durationMs: number | null }> {
  const target = new URL(input.url);
  if (target.protocol !== "https:") throw new Error("That clip is not served over https");

  const upstream = await fetch(target, {
    headers: { accept: "video/*", "user-agent": "Tengya/1.0 (studio video tool)" },
    signal: AbortSignal.timeout(120_000),
  }).catch(() => null);
  if (!upstream?.ok || !upstream.body) throw new Error("That clip could not be fetched");
  const declared = Number(upstream.headers.get("content-length") ?? 0);
  if (declared > 120 * 1024 * 1024) throw new Error("That clip is too big to bring in");

  const body = new Uint8Array(await upstream.arrayBuffer());
  if (body.byteLength < 1000) throw new Error("That clip came back empty");
  if (body.byteLength > 120 * 1024 * 1024) throw new Error("That clip is too big to bring in");

  const name = `${input.name.replace(/[\\/]+/g, " ").trim().slice(0, 80) || "clip"}.mp4`;
  const { file, storageKey: key } = await beginUpload(viewer, {
    name,
    mime: "video/mp4",
    sizeBytes: body.byteLength,
    folderId: input.folderId ?? (await ensureStockFolder(viewer)).id,
  });
  const stored = await putObjectConfirmed(key, body, "video/mp4");

  /* Its length, now, from the bytes in hand rather than from the worker later. */
  let durationMs: number | null = null;
  try {
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = await mkdtemp(path.join(tmpdir(), "aura-import-"));
    const local = path.join(dir, "clip.mp4");
    await writeFile(local, body);
    const { probe, posterFromLocal, rememberPoster } = await import("@/lib/files/poster");
    durationMs = (await probe(local)).durationMs;
    // The thumbnail too, so Files and the bin show the clip at once rather
    // than after the poster job has had its turn behind a render.
    await posterFromLocal(local, key)
      .then((posterKey) => rememberPoster(file.id, posterKey))
      .catch(() => {});
    await rm(dir, { recursive: true, force: true });
  } catch {
    durationMs = null;
  }

  await db
    .update(files)
    .set({
      checksum: stored.etag,
      tags: ["stock"],
      durationMs,
      text: [input.attribution, input.source].filter(Boolean).join("\n"),
      updatedAt: new Date(),
      updatedBy: viewer.id,
    })
    .where(eq(files.id, file.id));

  // The poster, like any other upload's: the bin and Files draw it.
  await enqueue({
    tenantId: viewer.tenantId,
    type: "files.poster",
    module: "files",
    payload: { fileId: file.id },
    objectType: "file",
    objectId: file.id,
    createdBy: viewer.id,
    dedupeKey: `poster:${file.id}`,
    priority: 6,
  });

  // And its preview copy, for the same reason as any other clip's: a cutaway
  // dropped on the timeline is played in the editor like everything else.
  await enqueue({
    tenantId: viewer.tenantId,
    type: "files.proxy",
    module: "files",
    payload: { fileId: file.id },
    objectType: "file",
    objectId: file.id,
    createdBy: viewer.id,
    dedupeKey: `proxy:${file.id}`,
    priority: 5,
  }).catch((err) =>
    console.warn(`[files] no preview proxy queued for ${file.id}:`, err instanceof Error ? err.message : err),
  );

  await audit(viewer, "file.import", {
    objectType: "file",
    objectId: file.id,
    module: "files",
    meta: { source: input.source, attribution: input.attribution.slice(0, 200), kind: "video" },
  });

  return { id: file.id, name, durationMs };
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

  /*
   * A video gets a still, so the file lists have something to show rather than
   * a glyph — and both video and audio get measured, because a file of unknown
   * length is a clip the timeline draws as zero. Queued rather than done here:
   * it is FFmpeg over the whole file, and nobody confirming an upload should
   * wait for it.
   */
  if (row.kind === "video" || row.kind === "audio") {
    await enqueue({
      tenantId: viewer.tenantId,
      type: "files.poster",
      module: "files",
      payload: { fileId },
      objectType: "file",
      objectId: fileId,
      createdBy: viewer.id,
      dedupeKey: `poster:${fileId}`,
      priority: 6,
    });
  }

  /*
   * And a small copy to play (`lib/video/proxy.ts`).
   *
   * The editor plays source clips straight out of storage, and a source clip
   * is whatever came off the camera: 114 MB for 75 seconds, 570 MB for six
   * minutes, sometimes iPhone HEVC that half the browsers refuse outright. A
   * 480p H.264 rendition is about a fortieth of the bytes and plays anywhere.
   *
   * Behind the poster on purpose — a lower priority, so the thumbnail the
   * uploader is looking at right now is drawn before the encode that matters
   * the first time they press play. The `.catch` is the same promise the
   * poster makes: a proxy that cannot be queued must never fail an upload
   * that has already landed its bytes.
   */
  if (row.kind === "video") {
    await enqueue({
      tenantId: viewer.tenantId,
      type: "files.proxy",
      module: "files",
      payload: { fileId },
      objectType: "file",
      objectId: fileId,
      createdBy: viewer.id,
      dedupeKey: `proxy:${fileId}`,
      priority: 5,
    }).catch((err) =>
      console.warn(`[files] no preview proxy queued for ${fileId}:`, err instanceof Error ? err.message : err),
    );
  }

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

/**
 * Delete a folder — and mean the whole folder.
 *
 * A folder that disappears while its contents stay reachable through search,
 * Recent and every existing link is not deleted; it is hidden. So this marks
 * the subtree and everything in it, in two statements against the
 * denormalised paths that already exist for permission checks.
 *
 * Soft, like files: the same thirty-day window, the same sweeper, and the
 * same `restoreFolder` to undo it. The home folder is refused outright —
 * every upload with no folder lands there, and deleting it would send new
 * files into a folder marked deleted.
 */
export async function deleteFolder(viewer: Viewer, folderId: string) {
  const held = await relationOn(viewer, "folder", folderId);
  if (held !== "owner" && held !== "editor") throw new Error("You need edit access to delete this folder");

  const [folder] = await db.select().from(folders).where(eq(folders.id, folderId)).limit(1);
  if (!folder || folder.deletedAt) throw new Error("That folder does not exist");
  if (folder.name === "__home") throw new Error("The home folder cannot be deleted");

  const now = new Date();
  await db.transaction(async (trx) => {
    /* `path` holds every ancestor including the folder itself, so one
       array-contains catches the whole subtree without a recursive walk. */
    await trx
      .update(folders)
      .set({ deletedAt: now })
      .where(and(sql`${folders.path} @> array[${folderId}]::text[]`, isNull(folders.deletedAt)));

    await trx
      .update(files)
      .set({ deletedAt: now, deletedBy: viewer.id })
      .where(and(sql`${files.folderPath} @> array[${folderId}]::text[]`, isNull(files.deletedAt)));
  });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(files)
    .where(and(sql`${files.folderPath} @> array[${folderId}]::text[]`, eq(files.deletedAt, now)));

  await audit(viewer, "folder.delete", {
    objectType: "folder",
    objectId: folderId,
    module: "files",
    meta: { name: folder.name, files: count },
  });

  return { files: count };
}

/**
 * Put it back.
 *
 * Only what went down with *this* folder comes back up: the delete stamps one
 * timestamp across the subtree, so restoring matches on that exact stamp and
 * leaves alone anything that was already in the trash beforehand.
 */
export async function restoreFolder(viewer: Viewer, folderId: string) {
  const held = await relationOn(viewer, "folder", folderId);
  if (held !== "owner" && held !== "editor") throw new Error("You need edit access to restore this folder");

  const [folder] = await db.select().from(folders).where(eq(folders.id, folderId)).limit(1);
  if (!folder?.deletedAt) throw new Error("That folder is not in the trash");
  const stamp = folder.deletedAt;

  await db.transaction(async (trx) => {
    await trx
      .update(folders)
      .set({ deletedAt: null })
      .where(and(sql`${folders.path} @> array[${folderId}]::text[]`, eq(folders.deletedAt, stamp)));
    await trx
      .update(files)
      .set({ deletedAt: null, deletedBy: null })
      .where(and(sql`${files.folderPath} @> array[${folderId}]::text[]`, eq(files.deletedAt, stamp)));
  });

  /* A folder whose parent is itself in the trash would come back invisible.
     Restoring the parent chain as well is the only way back that a person can
     actually see. */
  const ancestors = folder.path.filter((id) => id !== folderId);
  if (ancestors.length) {
    await db
      .update(folders)
      .set({ deletedAt: null })
      .where(and(inArray(folders.id, ancestors), sql`${folders.deletedAt} is not null`));
  }

  await audit(viewer, "folder.restore", {
    objectType: "folder",
    objectId: folderId,
    module: "files",
    meta: { name: folder.name },
  });
}

/** Folders in the trash, for the Trash screen's own section. */
export async function listTrashedFolders(viewer: Viewer, limit = 100) {
  return db
    .select()
    .from(folders)
    .where(and(sql`${folders.deletedAt} is not null`, canReadFolders(viewer)))
    .orderBy(desc(folders.deletedAt))
    .limit(limit);
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
    /* A master must not be left pointing at a preview copy that no longer
       exists: the editor would ask for a file id that 404s rather than fall
       back to the master. `files.proxy_file_id` has no foreign key (see the
       schema for why), so nothing else would ever clear it, and the next
       `files.proxy` job makes a fresh one. */
    await trx.update(files).set({ proxyFileId: null }).where(inArray(files.proxyFileId, ids));
    await trx.delete(files).where(inArray(files.id, ids));
  });

  /* Folders go the same way, once nothing deleted with them is left. Without
     this the tree kept a skeleton of empty folders nobody could see into and
     their share tuples with it. */
  const deadFolders = await db
    .select({ id: folders.id })
    .from(folders)
    .where(sql`${folders.deletedAt} is not null and ${folders.deletedAt} < ${cutoff}`)
    .limit(500);
  if (deadFolders.length) {
    const folderIds = deadFolders.map((f) => f.id);
    await db.transaction(async (trx) => {
      await trx
        .delete(relationTuples)
        .where(and(eq(relationTuples.objectType, "folder"), inArray(relationTuples.objectId, folderIds)));
      await trx.delete(folders).where(inArray(folders.id, folderIds));
    });
  }

  return doomed.length;
}

/** Who this is shared with, resolved to names for the share sheet. */
export async function sharesWithNames(objectType: SharedObject, objectId: string) {
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
    // The stock stays in its own folder here too: forty licensed pictures the
    // director fetched would otherwise be the whole of "recent".
    // Nor the playback proxies — see `listFolder`.
    .where(and(isNull(files.deletedAt), canReadFiles(viewer), sql`not ('stock' = any(${files.tags}))`, sql`not ('proxy' = any(${files.tags}))`))
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

/**
 * Rename a file, or a folder.
 *
 * The name is the only thing about a stored object a person can change without
 * changing the object, which is exactly why it needs to be changeable: a
 * camera calls a file `Copycat_SOL_-_we_turned…_9ihruE.mp4` and a studio calls
 * it something a colleague can find.
 *
 * The storage key is deliberately left alone. It is derived from the id, not
 * the name, so renaming moves nothing, breaks no existing link and costs one
 * row update rather than a copy of a four-gigabyte master.
 */
export async function renameFile(viewer: Viewer, fileId: string, name: string): Promise<FileRow> {
  const clean = name.trim();
  if (!clean) throw new Error("A file needs a name");
  if (clean.length > 255) throw new Error("That name is too long");

  // Editing is editing: the same relation uploading a new version needs.
  const held = await relationOn(viewer, "file", fileId);
  if (held !== "owner" && held !== "editor") throw new Error("You need edit access to rename this");

  const [row] = await db
    .update(files)
    .set({ name: clean, updatedAt: new Date(), updatedBy: viewer.id })
    .where(and(eq(files.id, fileId), eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt)))
    .returning();
  if (!row) throw new Error("File not found");

  await audit(viewer, "file.rename", {
    objectType: "file",
    objectId: fileId,
    module: "files",
    meta: { name: clean },
  });
  return row;
}

export async function renameFolder(viewer: Viewer, folderId: string, name: string) {
  const clean = name.trim();
  if (!clean) throw new Error("A folder needs a name");
  if (clean.length > 255) throw new Error("That name is too long");
  // The private home folder is addressed by this name, so it is not free to
  // change: renaming it would give that person a second one on next sight.
  if (clean === "__home") throw new Error("That name is reserved");

  const held = await relationOn(viewer, "folder", folderId);
  if (held !== "owner" && held !== "editor") throw new Error("You need edit access to rename this");

  const [row] = await db
    .update(folders)
    .set({ name: clean, updatedAt: new Date() })
    .where(and(eq(folders.id, folderId), eq(folders.tenantId, viewer.tenantId), isNull(folders.deletedAt)))
    .returning();
  if (!row) throw new Error("Folder not found");

  await audit(viewer, "folder.rename", {
    objectType: "folder",
    objectId: folderId,
    module: "files",
    meta: { name: clean },
  });
  return row;
}
