import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, folders } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { canEditFolders, relationOn } from "@/lib/authz/rebac";
import { audit } from "@/lib/audit";
import { ensureHomeFolder, folderLabel, STOCK_FOLDER, type FolderRow } from "@/lib/files/service";
import { folderMoveRefusal, movedFolderPath } from "@/lib/files/move-paths";

/**
 * 移动到… — files and folders to another place in the tree.
 *
 * What moves is the item and the paths that describe where it sits; nothing
 * else. Grants are tuples on the object itself and stay exactly as they were,
 * while what a folder hands down follows the new `path`, which is the point
 * of moving something into a shared folder.
 *
 * Names are not changed on the way in: the store has always kept two files
 * of the same name side by side (an upload never renames), so a move does
 * the same and keeps both.
 */

export type MoveTarget = { id: string; name: string; parentId: string | null };

/** Every folder this person may put things into, for the 移动到 tree. */
export async function listMoveTargets(viewer: Viewer): Promise<MoveTarget[]> {
  const rows = await db
    .select({ id: folders.id, name: folders.name, parentId: folders.parentId })
    .from(folders)
    .where(and(eq(folders.tenantId, viewer.tenantId), isNull(folders.deletedAt), canEditFolders(viewer)))
    .orderBy(folders.name)
    .limit(2000);
  /* The private home folder is where 根目录 puts a file; it is not shown as a folder anywhere else either. */
  const home = new Set(rows.filter((f) => f.name === "__home").map((f) => f.id));
  return rows
    .filter((f) => !home.has(f.id))
    .map((f) => ({ ...f, name: folderLabel(f.name), parentId: f.parentId && !home.has(f.parentId) ? f.parentId : null }));
}

/** The destination, checked: in this studio, not in the trash, and editable by this person. */
async function writableTarget(viewer: Viewer, targetId: string): Promise<FolderRow> {
  const [target] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, targetId), eq(folders.tenantId, viewer.tenantId), isNull(folders.deletedAt)))
    .limit(1);
  /* "Not found" and "not yours" read the same, so an id cannot be probed. */
  const held = target ? await relationOn(viewer, "folder", target.id) : null;
  if (!target || (held !== "owner" && held !== "editor")) throw new Error("你没有目标文件夹的编辑权限");
  return target;
}

const where = (target: FolderRow | null) => (target ? folderLabel(target.name) : "根目录");

/** One file into a folder, or with `null` back to the top of Files (the person's own home folder). */
export async function moveFile(viewer: Viewer, fileId: string, targetId: string | null) {
  const held = await relationOn(viewer, "file", fileId);
  if (held !== "owner" && held !== "editor") throw new Error("你没有这个文件的编辑权限，不能移动");

  const [file] = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt)))
    .limit(1);
  if (!file) throw new Error("找不到这个文件");

  const target = targetId ? await writableTarget(viewer, targetId) : null;
  /* Files always live in a folder; the top of Files is the mover's own home folder. */
  const destination = target ?? (await ensureHomeFolder(viewer));
  if (file.folderId === destination.id) return { name: where(target), moved: false };

  await db.transaction(async (trx) => {
    await trx
      .update(files)
      .set({ folderId: destination.id, folderPath: destination.path, updatedAt: new Date(), updatedBy: viewer.id })
      .where(eq(files.id, fileId));
    /* Its 480p preview sits beside it and inherits the same readers; it goes too. */
    if (file.proxyFileId) {
      await trx
        .update(files)
        .set({ folderId: destination.id, folderPath: destination.path })
        .where(and(eq(files.id, file.proxyFileId), eq(files.folderId, file.folderId ?? "")));
    }
  });

  await audit(viewer, "file.move", {
    objectType: "file",
    objectId: fileId,
    module: "files",
    meta: { name: file.name, from: file.folderId, to: destination.id },
  });
  return { name: where(target), moved: true };
}

/**
 * A folder, with everything under it, into another folder or to the top.
 *
 * One transaction rewrites every path that runs through the folder — its own,
 * each descendant folder's and each descendant file's, trashed ones included
 * so that restoring them puts them back where their folder now is. The new
 * path is the target's path, then this folder, then whatever followed it
 * (`rewritePath`, which is what the SQL below does with array slices).
 */
export async function moveFolder(viewer: Viewer, folderId: string, targetId: string | null) {
  const held = await relationOn(viewer, "folder", folderId);
  if (held !== "owner" && held !== "editor") throw new Error("你没有这个文件夹的编辑权限，不能移动");

  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.tenantId, viewer.tenantId), isNull(folders.deletedAt)))
    .limit(1);
  if (!folder) throw new Error("找不到这个文件夹");
  /* Both are found by name at the top of the tree; moved, a second one would be made. */
  if (folder.name === "__home") throw new Error("个人文件夹不能移动");
  if (folder.name === STOCK_FOLDER && !folder.parentId) throw new Error("素材库不能移动");

  const target = targetId ? await writableTarget(viewer, targetId) : null;
  const refusal = folderMoveRefusal(folder, target);
  if (refusal === "self") throw new Error("不能把文件夹移到它自己里面");
  if (refusal === "descendant") throw new Error("不能把文件夹移到它自己的子文件夹里");
  if (refusal === "same") return { name: where(target), moved: false };

  const prefix = movedFolderPath(folder.id, target);
  const prefixSql = sql`array[${sql.join(prefix.map((id) => sql`${id}`), sql`, `)}]::text[]`;

  await db.transaction(async (trx) => {
    /* The target is read again inside the transaction, locked: a folder moved
       under this one a moment ago would otherwise slip past the loop check. */
    if (target) {
      const locked = await trx.execute<{ path: string[] }>(sql`select path from folders where id = ${target.id} for update`);
      const now = locked.rows[0]?.path ?? [];
      if (now.includes(folder.id)) throw new Error("不能把文件夹移到它自己的子文件夹里");
      if (now.join("/") !== target.path.join("/")) throw new Error("目标文件夹刚刚被移动过，请再试一次");
    }

    await trx
      .update(folders)
      .set({ parentId: target?.id ?? null, updatedAt: new Date() })
      .where(eq(folders.id, folder.id));

    await trx.execute(sql`
      update folders
         set path = ${prefixSql} || path[array_position(path, ${folder.id}::text) + 1 : array_length(path, 1)]
       where tenant_id = ${viewer.tenantId}
         and path @> array[${folder.id}]::text[]
    `);
    await trx.execute(sql`
      update files
         set folder_path = ${prefixSql} || folder_path[array_position(folder_path, ${folder.id}::text) + 1 : array_length(folder_path, 1)]
       where tenant_id = ${viewer.tenantId}
         and folder_path @> array[${folder.id}]::text[]
    `);
  });

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(files)
    .where(and(sql`${files.folderPath} @> array[${folder.id}]::text[]`, isNull(files.deletedAt)));

  await audit(viewer, "folder.move", {
    objectType: "folder",
    objectId: folder.id,
    module: "files",
    meta: { name: folder.name, from: folder.parentId, to: target?.id ?? null, files: count },
  });
  return { name: where(target), moved: true };
}

/** Several files at once (移动所选); each is checked on its own, as a single move would be. */
export async function moveFiles(viewer: Viewer, fileIds: string[], targetId: string | null) {
  let moved = 0;
  let failed = 0;
  let name = "";
  let firstError = "";
  for (const id of fileIds) {
    try {
      const res = await moveFile(viewer, id, targetId);
      name = res.name;
      if (res.moved) moved++;
    } catch (err) {
      failed++;
      firstError ||= err instanceof Error ? err.message : "";
    }
  }
  return { moved, failed, name, error: moved === 0 && failed ? firstError : undefined };
}
