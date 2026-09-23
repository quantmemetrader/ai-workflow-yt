import "server-only";
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, folders, relationTuples, type Relation } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { newId } from "@/lib/ids";

/**
 * Content permissions (spec §2). Relationship-based, not role-based: a person
 * reaches a file because a tuple says so, directly or through the folder it
 * sits in, as themselves or through a team.
 *
 * Two rules from the spec drive the whole design:
 *   §2.2.1 permission is checked at *query time*, never at index time — so the
 *          filter is a SQL predicate that rides along with every list query
 *          rather than a post-filter on results;
 *   §2.2.7 sharing is bounded by the sharer — you cannot grant a relation you
 *          do not hold.
 *
 * Tuples are shaped like OpenFGA's so the checker can be swapped for OpenFGA
 * (its datastore is already provisioned) without touching any caller.
 */

const RANK: Record<Relation, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 };

/** A server action is a public endpoint, so a `Relation` that TypeScript
 * guarantees at the call site is still an arbitrary string at runtime. Anything
 * unrecognised must fail closed here rather than reach `RANK[…]`, where an
 * undefined rank compares false against every ceiling test and would wave the
 * grant through (§2.2.7). */
export function isRelation(value: unknown): value is Relation {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RANK, value);
}

export function atLeast(held: Relation | null, needed: Relation): boolean {
  if (held === null || !isRelation(held) || !isRelation(needed)) return false;
  return RANK[held] >= RANK[needed];
}

/** Subjects this viewer answers to (`user:…`, `team:…`, `tenant:…`), as a SQL
 * list. Written out as individual parameters rather than one array parameter
 * so the planner sees literal values and can use the expression index on
 * `subject_type || ':' || subject_id`. */
export function subjectList(viewer: Viewer): SQL {
  return sql.join(
    viewer.subjects.map((s) => sql`${s}`),
    sql`, `,
  );
}

const live = sql`(${relationTuples.expiresAt} is null or ${relationTuples.expiresAt} > now())`;

/**
 * The predicate that makes every file list permission-filtered. Compose it
 * into any query over `files`:
 *
 *   db.select().from(files).where(and(eq(files.folderId, id), canReadFiles(viewer)))
 */
export function canReadFiles(viewer: Viewer): SQL {
  const subjects = subjectList(viewer);
  return sql`exists (
    select 1 from ${relationTuples} t
    where (t.subject_type || ':' || t.subject_id) in (${subjects})
      and (t.expires_at is null or t.expires_at > now())
      and (
        (t.object_type = 'file' and t.object_id = ${files.id})
        or (t.object_type = 'folder' and t.object_id = any(${files.folderPath}))
      )
  )`;
}

/** Same idea for folder lists. */
export function canReadFolders(viewer: Viewer): SQL {
  const subjects = subjectList(viewer);
  return sql`exists (
    select 1 from ${relationTuples} t
    where (t.subject_type || ':' || t.subject_id) in (${subjects})
      and (t.expires_at is null or t.expires_at > now())
      and t.object_type = 'folder' and t.object_id = any(${folders.path})
  )`;
}

/** The strongest relation this viewer holds on one object, or null. */
/**
 * What a tuple can be about.
 *
 * `relation_tuples.object_type` has always been open text; this was narrowed
 * to files and folders only because nothing else used it. A script is shared
 * the same way a document is — the same relations, the same ceiling, the same
 * "your agent can reach exactly what you can" rule — so it belongs here rather
 * than in a second sharing system that would drift from this one.
 */
export type SharedObject = "file" | "folder" | "script" | "project";

export async function relationOn(
  viewer: Viewer,
  objectType: SharedObject,
  objectId: string,
): Promise<Relation | null> {
  const subjects = subjectList(viewer);

  /* Files and folders inherit from the folder tree above them. Scripts do
     not: the Script library's folders are a separate, flat table, so a script
     is reachable only through a tuple on the script itself. Running the
     folders lookup on a script id would always return an empty path anyway —
     it is skipped so the query says what it means. */
  const path =
    objectType === "script" || objectType === "project"
      ? sql`'{}'::text[]`
      : objectType === "file"
        ? sql`coalesce((select f.folder_path from ${files} f where f.id = ${objectId}), '{}'::text[])`
        : sql`coalesce((select fo.path from ${folders} fo where fo.id = ${objectId}), '{}'::text[])`;

  const rows = await db.execute<{ relation: Relation }>(sql`
    select t.relation from ${relationTuples} t
    where (t.subject_type || ':' || t.subject_id) in (${subjects})
      and (t.expires_at is null or t.expires_at > now())
      and (
        (t.object_type = ${objectType} and t.object_id = ${objectId})
        or (t.object_type = 'folder' and t.object_id = any(${path}))
      )
  `);

  let best: Relation | null = null;
  for (const row of rows.rows) {
    if (best === null || RANK[row.relation] > RANK[best]) best = row.relation;
  }
  return best;
}

export async function canWrite(viewer: Viewer, objectType: SharedObject, id: string) {
  return atLeast(await relationOn(viewer, objectType, id), "editor");
}

/**
 * Grant a relation. Enforces the ceiling server-side: the granter must hold at
 * least what they are handing out, and only an `owner` may grant `owner`.
 * Returns the reason on refusal so the UI can state the ceiling rather than
 * just failing.
 */
export async function share(
  viewer: Viewer,
  object: { type: SharedObject; id: string },
  relation: Relation,
  subject: { type: "user" | "team" | "tenant"; id: string },
  opts: { expiresAt?: Date } = {},
): Promise<{ ok: true } | { ok: false; reason: string; ceiling: Relation | null }> {
  if (!isRelation(relation)) return { ok: false, reason: "unknown-relation", ceiling: null };
  if (subject.type !== "user" && subject.type !== "team" && subject.type !== "tenant") {
    return { ok: false, reason: "unknown-subject", ceiling: null };
  }
  const held = await relationOn(viewer, object.type, object.id);
  if (!held) return { ok: false, reason: "no-access", ceiling: null };
  if (!atLeast(held, relation)) {
    return { ok: false, reason: "above-ceiling", ceiling: held };
  }

  await db
    .insert(relationTuples)
    .values({
      id: newId("tup"),
      objectType: object.type,
      objectId: object.id,
      relation,
      subjectType: subject.type,
      subjectId: subject.id,
      grantedBy: viewer.id,
      expiresAt: opts.expiresAt,
    })
    .onConflictDoNothing();

  return { ok: true };
}

/** The highest relation a person could possibly grant on this object — what
 * the share dialog shows *before* someone tries (brief: make the ceiling
 * legible). */
export async function shareCeiling(viewer: Viewer, objectType: SharedObject, id: string) {
  return relationOn(viewer, objectType, id);
}

/**
 * Remove a grant. Bounded by the sharer in the same way `share` is: an editor
 * may take back an editor or a viewer, but may not delete the owner's tuple.
 * Without the second test, anyone holding `editor` on a folder could revoke the
 * owner's ownership of it and take the object over.
 */
export async function revoke(
  viewer: Viewer,
  object: { type: SharedObject; id: string },
  subject: { type: string; id: string },
  relation: Relation,
) {
  if (!isRelation(relation)) return false;
  const held = await relationOn(viewer, object.type, object.id);
  if (!atLeast(held, "editor")) return false;
  if (!atLeast(held, relation)) return false;
  await db
    .delete(relationTuples)
    .where(
      and(
        eq(relationTuples.objectType, object.type),
        eq(relationTuples.objectId, object.id),
        eq(relationTuples.subjectType, subject.type),
        eq(relationTuples.subjectId, subject.id),
        eq(relationTuples.relation, relation),
      ),
    );
  return true;
}

/**
 * The relation this person holds on each of a list of files, in one query.
 *
 * The Files list used to badge every row "Editor" or "Viewer" from a single
 * screen-wide flag — whether the person is a guest — which meant a row shared
 * with them as a viewer sat in a list of files claiming they could edit it.
 * The badge is a permission, so it has to be read per file.
 *
 * One statement for the whole page: every tuple that could touch any of these
 * files, folded down to the best relation per file in memory. The alternative
 * was `relationOn` per row, which is one round trip per file.
 */
export async function relationsForFiles(
  viewer: Viewer,
  rows: { id: string; folderPath: string[] | null; ownerId?: string | null }[],
): Promise<Map<string, Relation>> {
  const best = new Map<string, Relation>();
  if (rows.length === 0) return best;

  const put = (id: string, relation: Relation) => {
    const held = best.get(id);
    if (!held || RANK[relation] > RANK[held]) best.set(id, relation);
  };

  // The owner column is authoritative on its own: a file's owner holds owner
  // whether or not the tuple survived.
  for (const row of rows) if (row.ownerId && row.ownerId === viewer.id) put(row.id, "owner");

  const ids = rows.map((r) => r.id);
  const folderIds = [...new Set(rows.flatMap((r) => r.folderPath ?? []))];
  const subjects = subjectList(viewer);

  const tuples = await db
    .select({
      objectType: relationTuples.objectType,
      objectId: relationTuples.objectId,
      relation: relationTuples.relation,
    })
    .from(relationTuples)
    .where(
      and(
        or(
          and(eq(relationTuples.objectType, "file"), inArray(relationTuples.objectId, ids)),
          folderIds.length
            ? and(eq(relationTuples.objectType, "folder"), inArray(relationTuples.objectId, folderIds))
            : sql`false`,
        ),
        sql`(${relationTuples.subjectType} || ':' || ${relationTuples.subjectId}) in (${subjects})`,
        or(isNull(relationTuples.expiresAt), sql`${relationTuples.expiresAt} > now()`),
      ),
    );

  const onFile = new Map<string, Relation[]>();
  const onFolder = new Map<string, Relation[]>();
  for (const t of tuples) {
    const into = t.objectType === "file" ? onFile : onFolder;
    into.set(t.objectId, [...(into.get(t.objectId) ?? []), t.relation]);
  }

  for (const row of rows) {
    for (const relation of onFile.get(row.id) ?? []) put(row.id, relation);
    for (const folderId of row.folderPath ?? []) {
      for (const relation of onFolder.get(folderId) ?? []) put(row.id, relation);
    }
  }

  return best;
}

/** Used when something is created: its creator owns it. */
export async function grantOwner(
  subjectId: string,
  object: { type: SharedObject; id: string },
  grantedBy = subjectId,
) {
  await db
    .insert(relationTuples)
    .values({
      id: newId("tup"),
      objectType: object.type,
      objectId: object.id,
      relation: "owner",
      subjectType: "user",
      subjectId,
      grantedBy,
    })
    .onConflictDoNothing();
}

export { live };
