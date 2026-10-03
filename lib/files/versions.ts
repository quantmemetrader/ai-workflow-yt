import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, fileVersions } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { relationOn } from "@/lib/authz/rebac";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { toSimplified } from "@/lib/text/simplified";
import { headObject, storageKey } from "@/lib/storage/r2";
import { kindFromMime, queueFileJobs, type FileRow } from "@/lib/files/service";
import { isVersionKeyFor, nameWithExtension, pendingVersionKey } from "@/lib/files/move-paths";
import { UNREADABLE_TAG } from "@/lib/video/decodable";

/**
 * 上传新版本 and 恢复为当前版本.
 *
 * A new version is a new object: written at a key of its own under the file's
 * prefix, never over the old one, so every earlier version stays in the bucket
 * and downloadable from the 版本 list (`purgeFiles` already collects every
 * version's key). The file row then points at the new object, and the jobs a
 * fresh upload gets — text, poster and length, preview copy — run again,
 * because everything they made described the old bytes.
 *
 * The upload itself takes the same road as any other (`/api/files/presign`,
 * `/api/files/multipart/*`, with `versionOf`): the browser never learns a key
 * it could not have been given, and the key it hands back is checked to be one
 * of this file's pending version keys before anything is signed or confirmed.
 */

const MIME = /^[\w.+-]+\/[\w.+-]+$/;

async function mayEdit(viewer: Viewer, fileId: string, what = "上传新版本") {
  const held = await relationOn(viewer, "file", fileId);
  if (held !== "owner" && held !== "editor") throw new Error(`只有所有者或可编辑的人能${what}`);
}

async function liveFile(viewer: Viewer, fileId: string): Promise<FileRow> {
  const [file] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt)))
    .limit(1);
  if (!file) throw new Error("找不到这个文件");
  if (file.tags.includes("proxy")) throw new Error("预览副本不能上传新版本");
  return file;
}

/**
 * Before the first byte: checks, and the key the new object will be written at.
 *
 * A file made by the server (a render, a voice-over) has no version row of its
 * own. It gets its version 1 written now, from what it is, so the 版本 list
 * shows what is being replaced and can bring it back — and so the abandon
 * route, which removes a row with no version, can never mistake it for an
 * unfinished upload if this one is cancelled.
 */
export async function beginVersion(viewer: Viewer, fileId: string, input: { name: string }) {
  await mayEdit(viewer, fileId);
  const file = await liveFile(viewer, fileId);

  const [any] = await db.select({ id: fileVersions.id }).from(fileVersions).where(eq(fileVersions.fileId, fileId)).limit(1);
  if (!any) {
    await db
      .insert(fileVersions)
      .values({
        id: newId("ver"),
        fileId,
        versionNo: file.version,
        storageKey: file.storageKey,
        sizeBytes: file.sizeBytes,
        checksum: file.checksum,
        authorId: file.ownerId,
        note: "Uploaded",
      })
      .onConflictDoNothing({ target: [fileVersions.fileId, fileVersions.versionNo] });
  }

  const random = randomBytes(8).readBigUInt64BE().toString(36).padStart(10, "0").slice(-10);
  const key = pendingVersionKey(storageKey(viewer.tenantId, fileId, toSimplified(input.name)), random);
  return { file, storageKey: key };
}

/** Whether `key` is a pending version key of this file — the only keys the version routes will sign or confirm. */
export async function checkVersionKey(viewer: Viewer, fileId: string, key: unknown): Promise<string> {
  if (typeof key !== "string" || !isVersionKeyFor(key, viewer.tenantId, fileId)) throw new Error("上传请求有误，请重试");
  return key;
}

/**
 * Makes `object` the file's current content, as version N+1.
 *
 * Under a row lock, so two versions confirmed at the same moment get two
 * numbers rather than a duplicate-key error, and the file's own `version`
 * always names its newest row.
 */
async function makeCurrent(
  viewer: Viewer,
  file: FileRow,
  object: { key: string; size: number; checksum: string | null; mime: string; name: string; note: string },
) {
  const now = new Date();
  const updated = await db.transaction(async (trx) => {
    await trx.execute(sql`select id from files where id = ${file.id} for update`);
    const [{ top }] = await trx
      .select({ top: sql<number>`coalesce(max(${fileVersions.versionNo}), 0)::int` })
      .from(fileVersions)
      .where(eq(fileVersions.fileId, file.id));
    const [current] = await trx.select({ version: files.version }).from(files).where(eq(files.id, file.id));
    const versionNo = Math.max(top, current?.version ?? 0) + 1;

    await trx.insert(fileVersions).values({
      id: newId("ver"),
      fileId: file.id,
      versionNo,
      storageKey: object.key,
      sizeBytes: object.size,
      checksum: object.checksum,
      authorId: viewer.id,
      note: object.note,
    });

    const [row] = await trx
      .update(files)
      .set({
        storageKey: object.key,
        sizeBytes: object.size,
        checksum: object.checksum,
        mime: object.mime,
        kind: kindFromMime(object.mime, object.name),
        name: object.name,
        version: versionNo,
        updatedAt: now,
        updatedBy: viewer.id,
        /* Everything below described the old bytes. The jobs queued after
           this fill them in again for the new ones; the editor's copy of a
           document starts again from the new original. */
        text: null,
        docHtml: null,
        posterKey: null,
        durationMs: null,
        width: null,
        height: null,
        proxyFileId: null,
        tags: file.tags.filter((t) => t !== UNREADABLE_TAG),
      })
      .where(eq(files.id, file.id))
      .returning();

    /* The old preview copy plays the old cut; it goes to the trash (hidden
       there, swept with the rest after 30 days) and a new one is made. */
    if (file.proxyFileId) {
      await trx
        .update(files)
        .set({ deletedAt: now, deletedBy: viewer.id })
        .where(and(eq(files.id, file.proxyFileId), isNull(files.deletedAt)));
    }
    return row;
  });

  await queueFileJobs(viewer, updated, `v${updated.version}`).catch((err) =>
    console.warn(`[files] follow-up jobs not queued for ${file.id}:`, err instanceof Error ? err.message : err),
  );
  return updated;
}

/** The browser's PUT (or multipart upload) has finished: confirm the object and make it current. */
export async function completeVersion(
  viewer: Viewer,
  fileId: string,
  key: string,
  input: { name?: unknown; mime?: unknown; checksum?: string | null },
) {
  await mayEdit(viewer, fileId);
  const file = await liveFile(viewer, fileId);
  await checkVersionKey(viewer, fileId, key);

  /* Confirmed twice (a retried request): the second is a no-op. */
  const [already] = await db
    .select({ versionNo: fileVersions.versionNo })
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.storageKey, key)))
    .limit(1);
  if (already) return file;

  const head = await headObject(key);
  if (!head) throw new Error("新版本没有传到，请重试");

  const mime = typeof input.mime === "string" && MIME.test(input.mime) && input.mime.length <= 128 ? input.mime : head.contentType.split(";")[0];
  const uploaded = typeof input.name === "string" ? toSimplified(input.name) : file.name;
  const row = await makeCurrent(viewer, file, {
    key,
    size: head.size,
    checksum: input.checksum || head.etag,
    mime,
    name: nameWithExtension(file.name, uploaded),
    note: "New version",
  });

  await audit(viewer, "file.version", {
    objectType: "file",
    objectId: fileId,
    module: "files",
    meta: { name: row.name, version: row.version, bytes: row.sizeBytes },
  });
  return row;
}

/**
 * A version whose bytes are what the file is now: the same stored object, or
 * the same checksum (QA, 4 Oct: 恢复为当前版本 was offered on a version a
 * restore had already made current). Restoring it would only add a copy.
 */
export function sameContent(
  version: { storageKey: string | null; checksum: string | null },
  file: { storageKey: string | null; checksum: string | null },
): boolean {
  if (version.storageKey && version.storageKey === file.storageKey) return true;
  return Boolean(version.checksum && version.checksum === file.checksum);
}

/** 恢复为当前版本: an earlier version becomes the newest one, as a copy; nothing in between is lost. */
export async function restoreVersion(viewer: Viewer, fileId: string, versionNo: number) {
  await mayEdit(viewer, fileId, "恢复版本");
  const file = await liveFile(viewer, fileId);

  const [version] = await db
    .select()
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.versionNo, versionNo)))
    .limit(1);
  if (!version) throw new Error("找不到这个版本");
  if (!version.storageKey) throw new Error("这个版本没有单独保存的文件，无法恢复");
  if (sameContent(version, file)) throw new Error("这已经是当前版本");

  const head = await headObject(version.storageKey);
  if (!head) throw new Error("这个版本的文件已经不在了");

  /* The object is shared, not copied: a four-gigabyte master restored is one row. */
  const keyName = version.storageKey.split("/").pop() ?? "";
  const row = await makeCurrent(viewer, file, {
    key: version.storageKey,
    size: head.size || version.sizeBytes,
    checksum: version.checksum ?? head.etag,
    mime: head.contentType.split(";")[0] || file.mime || "application/octet-stream",
    name: nameWithExtension(file.name, keyName),
    note: `Restored from v${versionNo}`,
  });

  await audit(viewer, "file.version.restore", {
    objectType: "file",
    objectId: fileId,
    module: "files",
    meta: { name: row.name, from: versionNo, version: row.version },
  });
  return row;
}

/** The stored object of one version, for 下载 on the 版本 list. Read access is checked by the caller. */
export async function versionObject(fileId: string, versionNo: number) {
  const [version] = await db
    .select({ storageKey: fileVersions.storageKey })
    .from(fileVersions)
    .where(and(eq(fileVersions.fileId, fileId), eq(fileVersions.versionNo, versionNo)))
    .limit(1);
  return version?.storageKey ?? null;
}
