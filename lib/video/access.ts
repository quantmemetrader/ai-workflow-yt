import "server-only";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { relationTuples, users, videoProjects, type Relation } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { atLeast, relationOn, subjectList } from "@/lib/authz/rebac";
import { newId } from "@/lib/ids";
import { audit } from "@/lib/audit";

/**
 * Who may see a video project, and so its footage.
 *
 * The client's rule: what a person makes is theirs alone until they share it,
 * and the studio's owner and admins can see and set access on everything. A
 * project is shared the way a file is, with a tuple on `project:<id>`, to one
 * person, to everyone on staff (`tenant:`), or to everybody holding an account
 * role (`role:<tenant>:<role>`, see lib/authz/subjects.ts).
 *
 * The creator is recorded in `owner_id` and that column is authoritative, so
 * there is no owner tuple to lose.
 */

/** A predicate over `video_projects` rows this viewer may open. */
export function canReadProjects(viewer: Viewer): SQL {
  if (viewer.isAdmin) return sql`true`;
  return sql`(${videoProjects.ownerId} = ${viewer.id} or exists (
    select 1 from relation_tuples t
     where t.object_type = 'project' and t.object_id = ${videoProjects.id}
       and (t.subject_type || ':' || t.subject_id) in (${subjectList(viewer)})
       and (t.expires_at is null or t.expires_at > now())
  ))`;
}

/** The strongest relation this viewer holds on one project, or null. */
export async function projectRelation(viewer: Viewer, projectId: string): Promise<Relation | null> {
  if (typeof projectId !== "string" || !projectId || projectId.length > 64) return null;
  const [row] = await db
    .select({ ownerId: videoProjects.ownerId, tenantId: videoProjects.tenantId, deletedAt: videoProjects.deletedAt })
    .from(videoProjects)
    .where(eq(videoProjects.id, projectId))
    .limit(1);
  if (!row || row.tenantId !== viewer.tenantId || row.deletedAt) return null;
  if (viewer.isAdmin || row.ownerId === viewer.id) return "owner";
  return relationOn(viewer, "project", projectId);
}

export async function canEditProject(viewer: Viewer, projectId: string): Promise<boolean> {
  return atLeast(await projectRelation(viewer, projectId), "editor");
}

/** Throws the sentence the screen shows when somebody may look but not touch. */
export async function assertCanEdit(viewer: Viewer, projectId: string): Promise<void> {
  const held = await projectRelation(viewer, projectId);
  if (held === null) throw new Error("Not found");
  if (!atLeast(held, "editor")) throw new Error("This project was shared with you to view. Ask its owner for edit access.");
}

/**
 * Whether a file is media inside a project this viewer can open: the master,
 * a clip, a graphic, an audio track or an export. Sharing a cut shares what is
 * in it; a cut whose footage will not play is not shared at all.
 */
export async function fileInVisibleProject(viewer: Viewer, fileId: string): Promise<boolean> {
  if (!viewer.modules.includes("video")) return false;
  const res = await db.execute<{ ok: boolean }>(sql`
    select exists (
      select 1 from ${videoProjects}
       where ${videoProjects.tenantId} = ${viewer.tenantId}
         and ${videoProjects.deletedAt} is null
         and ${canReadProjects(viewer)}
         and (
           ${videoProjects.masterFileId} = ${fileId}
           or exists (select 1 from video_clips c where c.project_id = ${videoProjects.id} and c.file_id = ${fileId})
           or exists (select 1 from video_graphics g where g.project_id = ${videoProjects.id} and g.file_id = ${fileId})
           or exists (select 1 from audio_tracks a where a.project_id = ${videoProjects.id} and a.file_id = ${fileId})
           or exists (select 1 from video_exports e where e.project_id = ${videoProjects.id} and e.file_id = ${fileId})
         )
    ) as ok
  `);
  return res.rows[0]?.ok === true;
}

/* ---------------------------------------------------------------- sharing */

export type AccessTarget = "everyone" | "role:member" | "role:guest" | `user:${string}`;
export type AccessEntry = { subjectType: string; subjectId: string; relation: Relation; label: string };
export type Visibility = "private" | "shared" | "everyone";

const ROLE_LABEL: Record<string, string> = { member: "All members", guest: "All guests", admin: "All admins" };

/** One word for each card: private, shared with someone, or with everyone. */
export async function visibilityFor(viewer: Viewer, projectIds: string[]): Promise<Map<string, Visibility>> {
  const out = new Map<string, Visibility>();
  if (!projectIds.length) return out;
  const rows = await db
    .select({ objectId: relationTuples.objectId, subjectType: relationTuples.subjectType })
    .from(relationTuples)
    .where(and(eq(relationTuples.objectType, "project"), inArray(relationTuples.objectId, projectIds)));
  for (const r of rows) {
    if (r.subjectType === "tenant") out.set(r.objectId, "everyone");
    else if (out.get(r.objectId) !== "everyone") out.set(r.objectId, "shared");
  }
  for (const id of projectIds) if (!out.has(id)) out.set(id, "private");
  return out;
}

/** Who can open this project besides its owner and the admins. */
export async function projectAccess(viewer: Viewer, projectId: string) {
  const held = await projectRelation(viewer, projectId);
  if (held === null) return null;
  const rows = await db
    .select({
      subjectType: relationTuples.subjectType,
      subjectId: relationTuples.subjectId,
      relation: relationTuples.relation,
      name: users.name,
      email: users.email,
    })
    .from(relationTuples)
    .leftJoin(users, and(eq(relationTuples.subjectType, "user"), eq(users.id, relationTuples.subjectId)))
    .where(and(eq(relationTuples.objectType, "project"), eq(relationTuples.objectId, projectId)));

  const entries: AccessEntry[] = rows.map((r) => ({
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    relation: r.relation,
    label:
      r.subjectType === "tenant"
        ? "Everyone in the studio"
        : r.subjectType === "role"
          ? (ROLE_LABEL[r.subjectId.split(":").pop() ?? ""] ?? r.subjectId)
          : r.name
            ? `${r.name} · ${r.email}`
            : r.subjectId,
  }));

  const people = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.tenantId, viewer.tenantId), sql`${users.deletedAt} is null`, sql`${users.status} = 'active'`, eq(users.isAgent, false), sql`${users.id} <> ${viewer.id}`));

  return { canManage: held === "owner", relation: held, entries, people };
}

/** Grant access. Only the project's owner, or an owner/admin of the studio. */
export async function shareProject(viewer: Viewer, projectId: string, target: AccessTarget, relation: Relation) {
  if (relation !== "viewer" && relation !== "editor") throw new Error("Pick view or edit");
  if ((await projectRelation(viewer, projectId)) !== "owner") throw new Error("Only the project's owner or an admin can change who has access");

  let subject: { type: string; id: string };
  if (target === "everyone") subject = { type: "tenant", id: viewer.tenantId };
  else if (target === "role:member" || target === "role:guest") subject = { type: "role", id: `${viewer.tenantId}:${target.slice(5)}` };
  else if (typeof target === "string" && target.startsWith("user:")) {
    const userId = target.slice(5);
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, viewer.tenantId)))
      .limit(1);
    if (!u) throw new Error("That person is not in this studio");
    subject = { type: "user", id: u.id };
  } else throw new Error("Pick who to share with");

  // One grant per subject: changing view to edit replaces, it does not stack.
  await db
    .delete(relationTuples)
    .where(
      and(
        eq(relationTuples.objectType, "project"),
        eq(relationTuples.objectId, projectId),
        eq(relationTuples.subjectType, subject.type),
        eq(relationTuples.subjectId, subject.id),
      ),
    );
  await db.insert(relationTuples).values({
    id: newId("tup"),
    objectType: "project",
    objectId: projectId,
    relation,
    subjectType: subject.type,
    subjectId: subject.id,
    grantedBy: viewer.id,
  });
  await audit(viewer, "video.project.share", {
    module: "video",
    objectType: "video_project",
    objectId: projectId,
    meta: { subject: `${subject.type}:${subject.id}`, relation },
  });
}

export async function unshareProject(viewer: Viewer, projectId: string, subjectType: string, subjectId: string) {
  if ((await projectRelation(viewer, projectId)) !== "owner") throw new Error("Only the project's owner or an admin can change who has access");
  await db
    .delete(relationTuples)
    .where(
      and(
        eq(relationTuples.objectType, "project"),
        eq(relationTuples.objectId, projectId),
        eq(relationTuples.subjectType, subjectType),
        eq(relationTuples.subjectId, subjectId),
      ),
    );
  await audit(viewer, "video.project.unshare", {
    module: "video",
    objectType: "video_project",
    objectId: projectId,
    meta: { subject: `${subjectType}:${subjectId}` },
  });
}
