"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, type Relation } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { atLeast, canWrite, isProtectedOwner, isRelation, relationOn, revoke, share, shareCeiling, type SharedObject } from "@/lib/authz/rebac";
import {
  createFolder,
  deleteFolder,
  folderPurgeCount,
  purgeFolder,
  renameFile,
  renameFolder,
  purgeFile,
  restore,
  restoreFolder,
  softDelete,
} from "@/lib/files/service";
import { audit } from "@/lib/audit";
import { listMoveTargets, moveFile, moveFiles, moveFolder } from "@/lib/files/move";
import { restoreVersion } from "@/lib/files/versions";
import { parseChoice, setFileAccess, studioPeople } from "@/lib/files/access";

/** Server actions are public endpoints. Each one re-reads the viewer and
 * re-checks the relation; none of them trusts the screen it came from. */

/** Names come off the wire, so they are bounded here rather than trusted to be
 * whatever the input element allowed. */
const MAX_NAME = 200;

/* (QA, 2 Oct: every error here is shown to people as is, so it is in Chinese.) */
const REL_ZH: Record<Relation, string> = { owner: "所有者", editor: "可编辑", commenter: "可评论", viewer: "可查看" };

export async function newFolderAction(parentId: string | null, name: string) {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "你没有权限做这件事" };
  if (typeof name !== "string" || !name.trim()) return { error: "请填写文件夹名称" };
  if (name.length > MAX_NAME) return { error: "名称太长了" };

  // `createFolder` says "Parent folder not found" for an id that does not
  // exist and "You need edit access" for one that does, which is a way to test
  // whether any folder id is real (§2.2.4). The check is made here instead, and
  // both cases get the same answer.
  if (parentId) {
    if (!(await canWrite(viewer, "folder", parentId))) {
      return { error: "你没有这里的编辑权限，不能新建文件夹" };
    }
  }

  try {
    const folder = await createFolder(viewer, { name: name.trim(), parentId });
    revalidatePath("/files");
    return { id: folder.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "文件夹没建成，请再试一次" };
  }
}

export async function deleteFileAction(fileId: string) {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "你没有权限做这件事" };
  try {
    await softDelete(viewer, fileId);
    revalidatePath("/files");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没删掉，请再试一次" };
  }
}

/** 批量删除: many files to the trash at once (restorable there for 30 days). */
export async function deleteFilesAction(fileIds: unknown): Promise<{ deleted: number; failed: number; error?: string }> {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { deleted: 0, failed: 0, error: "你没有权限做这件事" };
  const ids = Array.isArray(fileIds) ? fileIds.filter((x): x is string => typeof x === "string" && x.length < 64).slice(0, 500) : [];
  let deleted = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await softDelete(viewer, id);
      deleted++;
    } catch {
      failed++;
    }
  }
  revalidatePath("/files");
  return { deleted, failed };
}

export async function restoreFileAction(fileId: string) {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "你没有权限做这件事" };
  if (typeof fileId !== "string" || !fileId || fileId.length > 64) return { error: "找不到这个文件" };
  try {
    await restore(viewer, fileId);
    revalidatePath("/files");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没恢复成功，请再试一次" };
  }
}

/** 永久删除 from the trash: owner or admin, file already in the trash (QA, 2 Oct). */
export async function purgeFileAction(fileId: unknown) {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "你没有权限做这件事" };
  if (typeof fileId !== "string" || !fileId || fileId.length > 64) return { error: "找不到这个文件" };
  try {
    await purgeFile(viewer, fileId);
    revalidatePath("/files/trash");
    return {};
  } catch (err) {
    return { error: err instanceof Error && /[\u4e00-\u9fff]/.test(err.message) ? err.message : "没能永久删除，这个文件可能还在别处用着" };
  }
}

/**
 * Delete a folder, and everything inside it.
 *
 * The count comes back so the screen can say what actually went — "Design
 * moved to trash · 41 files" — rather than leaving somebody to wonder whether
 * the contents went with it.
 */
export async function deleteFolderAction(folderId: unknown) {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "你没有权限做这件事" };
  if (typeof folderId !== "string" || !folderId || folderId.length > 64) return { error: "你没有权限做这件事" };
  try {
    const { files } = await deleteFolder(viewer, folderId);
    revalidatePath("/files");
    return { files };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "文件夹没删掉，请再试一次" };
  }
}

export async function restoreFolderAction(folderId: unknown) {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "你没有权限做这件事" };
  if (typeof folderId !== "string" || !folderId || folderId.length > 64) return { error: "你没有权限做这件事" };
  try {
    await restoreFolder(viewer, folderId);
    revalidatePath("/files");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "文件夹没恢复成功，请再试一次" };
  }
}

/**
 * Share. The ceiling is enforced in `rebac.share`, but it is also *reported*
 * so the dialog can say "you can share up to editor" before anyone tries —
 * the brief asks for the limit to be legible in advance.
 */
export async function shareAction(
  objectType: SharedObject,
  objectId: string,
  email: string,
  relation: Relation,
  expiresInDays?: number,
) {
  const viewer = await getViewer();
  /* A script is shared by somebody who holds Script, a file by somebody who
     holds Files. One sharing system, two entitlements — the alternative was a
     second sheet that would drift from this one. */
  const needed = objectType === "script" ? "script" : "files";
  /* A file's owner or editor shares it from the document editor without holding Files (法务, 财务, 1 Oct). */
  if (!viewer || (!viewer.modules.includes(needed) && !(objectType === "file" && ["owner", "editor"].includes((await relationOn(viewer, "file", objectId)) ?? "")))) return { error: "你没有权限做这件事" };
  if (objectType !== "file" && objectType !== "folder" && objectType !== "script") {
    return { error: "你没有权限做这件事" };
  }
  if (!isRelation(relation)) return { error: "没有这个权限级别" };
  if (typeof email !== "string" || email.length > 320) return { error: "请填写有效的邮箱" };

  let expiresAt: Date | undefined;
  if (expiresInDays !== undefined && expiresInDays !== null) {
    // Straight from the wire: NaN would become an Invalid Date and a negative
    // number an already-dead grant, both of which the insert would take.
    if (!Number.isFinite(expiresInDays) || expiresInDays <= 0 || expiresInDays > 3650) {
      return { error: "有效期请选 1 到 3650 天" };
    }
    expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);
  }

  // The viewer's own access is settled *before* the recipient is looked up.
  // Looking the address up first made this action an oracle for "does this
  // person have an account here", answerable by anyone signed in, on an object
  // they hold nothing on.
  const ceiling = await shareCeiling(viewer, objectType, objectId);
  if (!ceiling) return { error: "你没有共享这个文件的权限" };
  if (!atLeast(ceiling, relation)) {
    return { error: `你的权限是「${REL_ZH[ceiling]}」，最多只能共享到这一级` };
  }

  // Scoped to the viewer's own tenant. Unscoped, this granted a relation on a
  // studio's file to an account in a different studio, and told the caller
  // which addresses exist across every tenant on the box.
  const [target] = await db
    .select({ id: users.id, name: users.name, nameLocal: users.nameLocal })
    .from(users)
    .where(and(eq(users.tenantId, viewer.tenantId), eq(users.email, email.trim().toLowerCase())))
    .limit(1);
  if (!target) return { error: "工作室里没有这个邮箱的同事" };

  const result = await share(
    viewer,
    { type: objectType, id: objectId },
    relation,
    { type: "user", id: target.id },
    /* The sheet sets this person's one relation; it never stacks a second. */
    expiresAt ? { expiresAt, replace: true } : { replace: true },
  );

  if (!result.ok) {
    return {
      error:
        result.reason === "above-ceiling"
          ? `你的权限是「${result.ceiling ? REL_ZH[result.ceiling] : ""}」，最多只能共享到这一级`
          : result.reason === "protected-owner"
            ? "所有者的权限不能更改"
            : "你没有共享这个文件的权限",
    };
  }

  await audit(viewer, "file.share", {
    objectType,
    objectId,
    module: "files",
    meta: { to: target.id, relation },
  });
  revalidatePath(objectType === "script" ? `/script/${objectId}` : `/files/${objectId}`);
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  return { sharedWith: (zh && target.nameLocal) || target.name };
}

export async function revokeAction(
  objectType: SharedObject,
  objectId: string,
  subjectId: string,
  relation: Relation,
) {
  const viewer = await getViewer();
  const needed = objectType === "script" ? "script" : "files";
  /* A file's owner or editor shares it from the document editor without holding Files (法务, 财务, 1 Oct). */
  if (!viewer || (!viewer.modules.includes(needed) && !(objectType === "file" && ["owner", "editor"].includes((await relationOn(viewer, "file", objectId)) ?? "")))) return { error: "你没有权限做这件事" };
  if (objectType !== "file" && objectType !== "folder" && objectType !== "script") {
    return { error: "你没有权限做这件事" };
  }
  if (!isRelation(relation)) return { error: "没有这个权限级别" };
  if (typeof subjectId !== "string" || !subjectId || subjectId.length > 64) {
    return { error: "你没有权限做这件事" };
  }
  /* The owner's own grant, or the last owner grant, stays (QA, 2 Oct). */
  if (await isProtectedOwner({ type: objectType, id: objectId }, { type: "user", id: subjectId }, relation)) {
    return { error: "所有者不能被移除" };
  }
  const ok = await revoke(viewer, { type: objectType, id: objectId }, { type: "user", id: subjectId }, relation);
  if (!ok) return { error: "你没有编辑权限，不能改共享设置" };
  await audit(viewer, "file.unshare", { objectType, objectId, module: "files", meta: { subjectId } });
  revalidatePath(objectType === "script" ? `/script/${objectId}` : `/files/${objectId}`);
  return {};
}

/**
 * Rename a file or a folder.
 *
 * The relation is re-checked inside the service, not here: a server action is
 * a public endpoint whatever the screen around it looked like, and renaming
 * somebody else's master is exactly the thing an unchecked one would allow.
 */
export async function renameFileAction(fileId: unknown, name: unknown) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("files")) return { error: "你没有权限做这件事" };
  if (typeof fileId !== "string" || !fileId || fileId.length > 64) return { error: "找不到这个文件" };
  if (typeof name !== "string") return { error: "请填写文件名" };

  try {
    const row = await renameFile(viewer, fileId, name);
    revalidatePath("/files", "layout");
    return { name: row.name };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没改成功，请再试一次" };
  }
}

export async function renameFolderAction(folderId: unknown, name: unknown) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("files")) return { error: "你没有权限做这件事" };
  if (typeof folderId !== "string" || !folderId || folderId.length > 64) return { error: "找不到这个文件" };
  if (typeof name !== "string") return { error: "请填写文件夹名称" };

  try {
    const row = await renameFolder(viewer, folderId, name);
    revalidatePath("/files", "layout");
    return { name: row.name };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没改成功，请再试一次" };
  }
}

/** Who sees these files: private, everyone, or chosen groups. */
export async function setFileAccessAction(fileIds: unknown, choice: unknown) {
  const viewer = await getViewer();
  if (!viewer) return { error: "你没有权限做这件事" };
  if (!Array.isArray(fileIds)) return { error: "还没选文件" };
  /* Without Files, only one's own documents (`setFileAccess` refuses anything else anyway). */
  if (!viewer.modules.includes("files") && !(fileIds.length === 1 && typeof fileIds[0] === "string" && (await relationOn(viewer, "file", fileIds[0])) === "owner")) return { error: "你没有权限做这件事" };
  try {
    await setFileAccess(viewer, fileIds.filter((x): x is string => typeof x === "string"), parseChoice(choice));
    revalidatePath("/files", "layout");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没改成功，请再试一次" };
  }
}

/** The studio's people, for "specific people" in the access picker. */
export async function studioPeopleAction() {
  const viewer = await getViewer();
  if (!viewer) return { error: "你没有权限做这件事" };
  // A guest is not handed the studio's staff list.
  if (viewer.role === "guest") return { people: [] };
  return { people: await studioPeople(viewer) };
}

const isId = (x: unknown): x is string => typeof x === "string" && x.length > 0 && x.length < 64;

/** The folders the 移动到 dialog offers: every one this person may put things into. */
export async function moveTargetsAction() {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "你没有权限做这件事", folders: [] };
  return { folders: await listMoveTargets(viewer) };
}

/**
 * 移动到… for one file, one folder, or the files ticked in 选择多个文件.
 * `targetId` null is 根目录. Every item is re-checked in the service: the
 * mover must be able to edit it and the destination both.
 */
export async function moveItemsAction(items: unknown, targetId: unknown) {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "你没有权限做这件事" };
  if (targetId !== null && !isId(targetId)) return { error: "请选择要移到的位置" };
  const given = (items ?? {}) as { files?: unknown; folders?: unknown };
  const fileIds = Array.isArray(given.files) ? given.files.filter(isId).slice(0, 500) : [];
  const folderIds = Array.isArray(given.folders) ? given.folders.filter(isId).slice(0, 50) : [];
  if (!fileIds.length && !folderIds.length) return { error: "还没选要移动的内容" };

  try {
    let name = "";
    let moved = 0;
    let failed = 0;
    let firstError = "";
    for (const id of folderIds) {
      try {
        const res = await moveFolder(viewer, id, targetId);
        name = res.name;
        if (res.moved) moved++;
      } catch (err) {
        failed++;
        firstError ||= err instanceof Error ? err.message : "";
      }
    }
    if (fileIds.length === 1 && !folderIds.length) {
      const res = await moveFile(viewer, fileIds[0], targetId);
      name = res.name;
      if (res.moved) moved++;
    } else if (fileIds.length) {
      const res = await moveFiles(viewer, fileIds, targetId);
      name ||= res.name;
      moved += res.moved;
      failed += res.failed;
      firstError ||= res.error ?? "";
    }
    revalidatePath("/files", "layout");
    if (!moved && failed) return { error: firstError || "没移动成功，请再试一次" };
    return { moved, failed, name };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没移动成功，请再试一次" };
  }
}

/** 恢复为当前版本: an earlier version becomes the newest one. */
export async function restoreVersionAction(fileId: unknown, versionNo: unknown) {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "你没有权限做这件事" };
  if (!isId(fileId) || !Number.isInteger(versionNo)) return { error: "找不到这个版本" };
  try {
    const row = await restoreVersion(viewer, fileId, versionNo as number);
    revalidatePath(`/files/${fileId}`);
    revalidatePath("/files", "layout");
    return { version: row.version };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没恢复成功，请再试一次" };
  }
}

/** For 永久删除 on a folder in the trash: how many files would go, said in the confirm dialog first. */
export async function folderPurgeCountAction(folderId: unknown) {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "你没有权限做这件事" };
  if (!isId(folderId)) return { error: "找不到这个文件夹" };
  try {
    return await folderPurgeCount(viewer, folderId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能读取这个文件夹" };
  }
}

/** 永久删除 on a folder in the trash: the folder's creator or an admin. */
export async function purgeFolderAction(folderId: unknown) {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "你没有权限做这件事" };
  if (!isId(folderId)) return { error: "找不到这个文件夹" };
  try {
    const res = await purgeFolder(viewer, folderId);
    revalidatePath("/files/trash");
    return res;
  } catch (err) {
    return { error: err instanceof Error && /[\u4e00-\u9fff]/.test(err.message) ? err.message : "没能永久删除，里面的文件可能还在别处用着" };
  }
}
