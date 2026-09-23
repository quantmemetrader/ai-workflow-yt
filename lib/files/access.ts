import "server-only";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, relationTuples, users } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { relationOn } from "@/lib/authz/rebac";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";

/**
 * Who can see a file, as one choice made the moment it is added.
 *
 * Private (only the uploader), specific people, everyone on staff, or one or
 * more account-role groups. Stored as ordinary tuples on the file: `user:` per
 * person, `tenant:<id>` for everyone, `role:<tenant>:<role>` per group
 * (lib/authz/subjects.ts). This picker owns every *view* grant on the file;
 * edit grants made from the Share box are left alone.
 *
 * A file in a shared folder is also visible to whoever the folder is shared
 * with. That is the folder's setting, not the file's, and the picker says so.
 */

export const GROUPS = ["admin", "member", "guest"] as const;
export type Group = (typeof GROUPS)[number];
export type AccessChoice =
  | { mode: "private" }
  | { mode: "everyone" }
  | { mode: "groups"; groups: Group[] }
  | { mode: "people"; userIds: string[] };
export type FileVisibility = "private" | "everyone" | "groups" | "people";

/** A choice from the browser is untrusted: anything unrecognised is private. */
export function parseChoice(raw: unknown): AccessChoice {
  const v = raw as { mode?: unknown; groups?: unknown } | null;
  if (v?.mode === "everyone") return { mode: "everyone" };
  const p = raw as { mode?: unknown; userIds?: unknown } | null;
  if (p?.mode === "people" && Array.isArray(p.userIds)) {
    const userIds = [...new Set(p.userIds.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))].slice(0, 50);
    if (userIds.length) return { mode: "people", userIds };
  }
  if (v?.mode === "groups" && Array.isArray(v.groups)) {
    const groups = GROUPS.filter((g) => (v.groups as unknown[]).includes(g));
    if (groups.length) return { mode: "groups", groups };
  }
  return { mode: "private" };
}

/** The role subjects a group covers. "Admins" includes the studio's owner. */
function roleSubjects(tenantId: string, group: Group): string[] {
  return group === "admin" ? [`${tenantId}:admin`, `${tenantId}:owner`] : [`${tenantId}:${group}`];
}

/** Apply a choice to files the viewer owns (or any file in the studio, for an
 * owner/admin). Replaces the file's group-level grants; returns how many. */
export async function setFileAccess(viewer: Viewer, fileIds: string[], choice: AccessChoice): Promise<number> {
  const ids = [...new Set(fileIds)].filter((id) => typeof id === "string" && id.length > 0 && id.length <= 64).slice(0, 500);
  if (!ids.length) return 0;

  const rows = await db
    .select({ id: files.id, ownerId: files.ownerId })
    .from(files)
    .where(and(inArray(files.id, ids), eq(files.tenantId, viewer.tenantId), isNull(files.deletedAt)));

  const allowed: string[] = [];
  for (const r of rows) {
    if (viewer.isAdmin || r.ownerId === viewer.id || (await relationOn(viewer, "file", r.id)) === "owner") allowed.push(r.id);
  }
  if (!allowed.length) throw new Error("Only a file's owner or an admin can change who sees it");

  await db.transaction(async (trx) => {
    await trx
      .delete(relationTuples)
      .where(
        and(
          eq(relationTuples.objectType, "file"),
          inArray(relationTuples.objectId, allowed),
          or(
            eq(relationTuples.subjectType, "tenant"),
            eq(relationTuples.subjectType, "role"),
            // Per-person *view* grants belong to this picker too; an editor or
            // the owner's own tuple is left alone.
            and(eq(relationTuples.subjectType, "user"), eq(relationTuples.relation, "viewer")),
          ),
        ),
      );
    let people: string[] = [];
    if (choice.mode === "people") {
      // Only real, active people in this studio, and never the file's owner twice.
      const found = await trx
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, choice.userIds), eq(users.tenantId, viewer.tenantId), isNull(users.deletedAt)));
      people = found.map((u) => u.id);
      if (!people.length) throw new Error("Pick at least one person in this studio");
    }
    const subjects =
      choice.mode === "everyone"
        ? [{ type: "tenant", id: viewer.tenantId }]
        : choice.mode === "groups"
          ? choice.groups.flatMap((g) => roleSubjects(viewer.tenantId, g)).map((id) => ({ type: "role", id }))
          : choice.mode === "people"
            ? people.map((id) => ({ type: "user", id }))
            : [];
    if (subjects.length) {
      await trx.insert(relationTuples).values(
        allowed.flatMap((fileId) =>
          subjects.map((s) => ({
            id: newId("tup"),
            objectType: "file",
            objectId: fileId,
            relation: "viewer" as const,
            subjectType: s.type,
            subjectId: s.id,
            grantedBy: viewer.id,
          })),
        ),
      );
    }
  });

  await audit(viewer, "file.access", {
    module: "files",
    objectType: "file",
    objectId: allowed[0],
    meta: { files: allowed.length, choice },
  });
  return allowed.length;
}

/** What each file is set to, for the eye icon on a row. Only the file's own
 * grants: a folder's sharing is the folder's. */
export type FileAccess = {
  visibility: FileVisibility;
  groups: Group[];
  userIds: string[];
  /** The chosen people, named, for the hover card on a row. */
  people: { name: string; email: string }[];
};

export async function visibilityForFiles(ids: string[]): Promise<Map<string, FileAccess>> {
  const out = new Map<string, FileAccess>();
  if (!ids.length) return out;
  const tuples = await db
    .select({
      objectId: relationTuples.objectId,
      subjectType: relationTuples.subjectType,
      subjectId: relationTuples.subjectId,
      relation: relationTuples.relation,
      name: users.name,
      email: users.email,
    })
    .from(relationTuples)
    .leftJoin(users, and(eq(relationTuples.subjectType, "user"), eq(users.id, relationTuples.subjectId)))
    .where(
      and(
        eq(relationTuples.objectType, "file"),
        inArray(relationTuples.objectId, ids),
        or(
          eq(relationTuples.subjectType, "tenant"),
          eq(relationTuples.subjectType, "role"),
          and(eq(relationTuples.subjectType, "user"), eq(relationTuples.relation, "viewer")),
        ),
        sql`(${relationTuples.expiresAt} is null or ${relationTuples.expiresAt} > now())`,
      ),
    );
  for (const id of ids) out.set(id, { visibility: "private", groups: [], userIds: [], people: [] });
  for (const t of tuples) {
    const cur = out.get(t.objectId)!;
    if (t.subjectType === "user") {
      cur.userIds.push(t.subjectId);
      cur.people.push({ name: t.name ?? t.subjectId, email: t.email ?? "" });
      if (cur.visibility === "private") cur.visibility = "people";
    } else if (t.subjectType === "tenant") cur.visibility = "everyone";
    else if (cur.visibility !== "everyone") {
      cur.visibility = "groups";
      const role = t.subjectId.split(":").pop();
      const group: Group | null = role === "owner" || role === "admin" ? "admin" : role === "member" ? "member" : role === "guest" ? "guest" : null;
      if (group && !cur.groups.includes(group)) cur.groups.push(group);
    }
  }
  return out;
}

/** Everyone active in the studio but the viewer, for the "specific people" list. */
export async function studioPeople(viewer: Viewer) {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.tenantId, viewer.tenantId), isNull(users.deletedAt), eq(users.status, "active"), eq(users.isAgent, false), sql`${users.id} <> ${viewer.id}`))
    .orderBy(users.name);
}
