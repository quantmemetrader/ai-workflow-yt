"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, type Relation } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { atLeast, canWrite, isRelation, revoke, share, shareCeiling, type SharedObject } from "@/lib/authz/rebac";
import {
  createFolder,
  deleteFolder,
  renameFile,
  renameFolder,
  restore,
  restoreFolder,
  softDelete,
} from "@/lib/files/service";
import { audit } from "@/lib/audit";
import { parseChoice, setFileAccess, studioPeople } from "@/lib/files/access";

/** Server actions are public endpoints. Each one re-reads the viewer and
 * re-checks the relation; none of them trusts the screen it came from. */

/** Names come off the wire, so they are bounded here rather than trusted to be
 * whatever the input element allowed. */
const MAX_NAME = 200;

export async function newFolderAction(parentId: string | null, name: string) {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "Not allowed" };
  if (typeof name !== "string" || !name.trim()) return { error: "A folder needs a name" };
  if (name.length > MAX_NAME) return { error: "That name is too long" };

  // `createFolder` says "Parent folder not found" for an id that does not
  // exist and "You need edit access" for one that does, which is a way to test
  // whether any folder id is real (§2.2.4). The check is made here instead, and
  // both cases get the same answer.
  if (parentId) {
    if (!(await canWrite(viewer, "folder", parentId))) {
      return { error: "You need edit access to add a folder here" };
    }
  }

  try {
    const folder = await createFolder(viewer, { name: name.trim(), parentId });
    revalidatePath("/files");
    return { id: folder.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not create the folder" };
  }
}

export async function deleteFileAction(fileId: string) {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "Not allowed" };
  try {
    await softDelete(viewer, fileId);
    revalidatePath("/files");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete" };
  }
}

export async function restoreFileAction(fileId: string) {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "Not allowed" };
  if (typeof fileId !== "string" || !fileId || fileId.length > 64) return { error: "Not found" };
  try {
    await restore(viewer, fileId);
    revalidatePath("/files");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not restore that" };
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
  if (!viewer?.modules.includes("files")) return { error: "Not allowed" };
  if (typeof folderId !== "string" || !folderId || folderId.length > 64) return { error: "Not allowed" };
  try {
    const { files } = await deleteFolder(viewer, folderId);
    revalidatePath("/files");
    return { files };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete the folder" };
  }
}

export async function restoreFolderAction(folderId: unknown) {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "Not allowed" };
  if (typeof folderId !== "string" || !folderId || folderId.length > 64) return { error: "Not allowed" };
  try {
    await restoreFolder(viewer, folderId);
    revalidatePath("/files");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not restore the folder" };
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
  if (!viewer?.modules.includes(needed)) return { error: "Not allowed" };
  if (objectType !== "file" && objectType !== "folder" && objectType !== "script") {
    return { error: "Not allowed" };
  }
  if (!isRelation(relation)) return { error: "That is not a level of access" };
  if (typeof email !== "string" || email.length > 320) return { error: "That is not an email address" };

  let expiresAt: Date | undefined;
  if (expiresInDays !== undefined && expiresInDays !== null) {
    // Straight from the wire: NaN would become an Invalid Date and a negative
    // number an already-dead grant, both of which the insert would take.
    if (!Number.isFinite(expiresInDays) || expiresInDays <= 0 || expiresInDays > 3650) {
      return { error: "Choose an expiry between 1 and 3650 days" };
    }
    expiresAt = new Date(Date.now() + expiresInDays * 86_400_000);
  }

  // The viewer's own access is settled *before* the recipient is looked up.
  // Looking the address up first made this action an oracle for "does this
  // person have an account here", answerable by anyone signed in, on an object
  // they hold nothing on.
  const ceiling = await shareCeiling(viewer, objectType, objectId);
  if (!ceiling) return { error: "You do not have access to share this." };
  if (!atLeast(ceiling, relation)) {
    return { error: `You hold ${ceiling} on this, so you can share up to ${ceiling}.` };
  }

  // Scoped to the viewer's own tenant. Unscoped, this granted a relation on a
  // studio's file to an account in a different studio, and told the caller
  // which addresses exist across every tenant on the box.
  const [target] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.tenantId, viewer.tenantId), eq(users.email, email.trim().toLowerCase())))
    .limit(1);
  if (!target) return { error: "Nobody here has that email address" };

  const result = await share(
    viewer,
    { type: objectType, id: objectId },
    relation,
    { type: "user", id: target.id },
    expiresAt ? { expiresAt } : {},
  );

  if (!result.ok) {
    return {
      error:
        result.reason === "above-ceiling"
          ? `You hold ${result.ceiling} on this, so you can share up to ${result.ceiling}.`
          : "You do not have access to share this.",
    };
  }

  await audit(viewer, "file.share", {
    objectType,
    objectId,
    module: "files",
    meta: { to: target.id, relation },
  });
  revalidatePath(objectType === "script" ? `/script/${objectId}` : `/files/${objectId}`);
  return { sharedWith: target.name };
}

export async function revokeAction(
  objectType: SharedObject,
  objectId: string,
  subjectId: string,
  relation: Relation,
) {
  const viewer = await getViewer();
  const needed = objectType === "script" ? "script" : "files";
  if (!viewer?.modules.includes(needed)) return { error: "Not allowed" };
  if (objectType !== "file" && objectType !== "folder" && objectType !== "script") {
    return { error: "Not allowed" };
  }
  if (!isRelation(relation)) return { error: "That is not a level of access" };
  if (typeof subjectId !== "string" || !subjectId || subjectId.length > 64) {
    return { error: "Not allowed" };
  }
  const ok = await revoke(viewer, { type: objectType, id: objectId }, { type: "user", id: subjectId }, relation);
  if (!ok) return { error: "You need edit access to change sharing" };
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
  if (!viewer || !viewer.modules.includes("files")) return { error: "Not allowed" };
  if (typeof fileId !== "string" || !fileId || fileId.length > 64) return { error: "Not found" };
  if (typeof name !== "string") return { error: "A file needs a name" };

  try {
    const row = await renameFile(viewer, fileId, name);
    revalidatePath("/files", "layout");
    return { name: row.name };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not rename that" };
  }
}

export async function renameFolderAction(folderId: unknown, name: unknown) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("files")) return { error: "Not allowed" };
  if (typeof folderId !== "string" || !folderId || folderId.length > 64) return { error: "Not found" };
  if (typeof name !== "string") return { error: "A folder needs a name" };

  try {
    const row = await renameFolder(viewer, folderId, name);
    revalidatePath("/files", "layout");
    return { name: row.name };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not rename that" };
  }
}

/** Who sees these files: private, everyone, or chosen groups. */
export async function setFileAccessAction(fileIds: unknown, choice: unknown) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("files")) return { error: "Not allowed" };
  if (!Array.isArray(fileIds)) return { error: "Nothing chosen" };
  try {
    await setFileAccess(viewer, fileIds.filter((x): x is string => typeof x === "string"), parseChoice(choice));
    revalidatePath("/files", "layout");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change that" };
  }
}

/** The studio's people, for "specific people" in the access picker. */
export async function studioPeopleAction() {
  const viewer = await getViewer();
  if (!viewer) return { error: "Not allowed" };
  // A guest is not handed the studio's staff list.
  if (viewer.role === "guest") return { people: [] };
  return { people: await studioPeople(viewer) };
}
