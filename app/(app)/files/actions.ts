"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users, type Relation } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { atLeast, canWrite, isRelation, revoke, share, shareCeiling } from "@/lib/authz/rebac";
import { createDocument, createFolder, restore, softDelete } from "@/lib/files/service";
import { audit } from "@/lib/audit";

/** Server actions are public endpoints. Each one re-reads the viewer and
 * re-checks the relation; none of them trusts the screen it came from. */

/** Names come off the wire, so they are bounded here rather than trusted to be
 * whatever the input element allowed. */
const MAX_NAME = 200;
const MAX_TEXT = 1_000_000;

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

export async function newDocumentAction(folderId: string | null, name: string, text = "") {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "Not allowed" };
  if (typeof name !== "string" || !name.trim()) return { error: "A document needs a name" };
  if (name.length > MAX_NAME) return { error: "That name is too long" };
  if (typeof text !== "string" || text.length > MAX_TEXT) return { error: "That document is too large" };

  // `createDocument` trusts the folder id it is handed and falls back to the
  // caller's home folder, so the destination has to be checked here: without
  // this, any id at all could be posted and the document would be written into
  // someone else's folder, inheriting that folder's readers along with it.
  if (folderId) {
    if (!(await canWrite(viewer, "folder", folderId))) {
      // Same answer whether the folder is unreachable or does not exist: a
      // distinguishable refusal would confirm the folder is real (§2.2.4).
      return { error: "You need edit access to add a document here" };
    }
  }

  const doc = await createDocument(viewer, {
    name: name.endsWith(".md") ? name : `${name}.md`,
    text,
    folderId,
  });
  revalidatePath("/files");
  return { id: doc.id };
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
  await restore(viewer, fileId);
  revalidatePath("/files");
  return {};
}

/**
 * Share. The ceiling is enforced in `rebac.share`, but it is also *reported*
 * so the dialog can say "you can share up to editor" before anyone tries —
 * the brief asks for the limit to be legible in advance.
 */
export async function shareAction(
  objectType: "file" | "folder",
  objectId: string,
  email: string,
  relation: Relation,
  expiresInDays?: number,
) {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "Not allowed" };
  if (objectType !== "file" && objectType !== "folder") return { error: "Not allowed" };
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
  revalidatePath(`/files/${objectId}`);
  return { sharedWith: target.name };
}

export async function revokeAction(
  objectType: "file" | "folder",
  objectId: string,
  subjectId: string,
  relation: Relation,
) {
  const viewer = await getViewer();
  if (!viewer?.modules.includes("files")) return { error: "Not allowed" };
  if (objectType !== "file" && objectType !== "folder") return { error: "Not allowed" };
  if (!isRelation(relation)) return { error: "That is not a level of access" };
  if (typeof subjectId !== "string" || !subjectId || subjectId.length > 64) {
    return { error: "Not allowed" };
  }
  const ok = await revoke(viewer, { type: objectType, id: objectId }, { type: "user", id: subjectId }, relation);
  if (!ok) return { error: "You need edit access to change sharing" };
  await audit(viewer, "file.unshare", { objectType, objectId, module: "files", meta: { subjectId } });
  revalidatePath(`/files/${objectId}`);
  return {};
}
