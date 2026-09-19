import "server-only";
import { sql } from "drizzle-orm";
import { db, toDate } from "@/lib/db/client";
import type { Viewer } from "@/lib/auth/dal";
import { subjectList } from "@/lib/authz/rebac";

/**
 * Retrieval for the agent, and the search box in the shell.
 *
 * The permission predicate is part of the query, not a filter applied to its
 * results (spec §2.2.1). The agent therefore cannot cite — or even mention the
 * existence of — a file the person who invoked it may not read (§2.2.4).
 *
 * `withheld` counts how many matches the filter removed. The count is safe to
 * show ("some results are not shown"); the titles are not, and never leave
 * this function.
 *
 * Chinese text is matched by substring and trigram rather than by a stemming
 * dictionary: Postgres has no segmenter for zh, and `to_tsvector('simple', …)`
 * would treat a whole Chinese phrase as one token. Trigram indexes give us
 * usable zh and en matching from one code path.
 */
export type Hit = {
  fileId: string;
  name: string;
  kind: string;
  folderId: string | null;
  snippet: string;
  score: number;
  updatedAt: Date;
};

export type SearchResult = { hits: Hit[]; withheld: number };

export async function searchFiles(
  viewer: Viewer,
  query: string,
  limit = 8,
): Promise<SearchResult> {
  const q = query.trim();
  if (!q) return { hits: [], withheld: 0 };

  const subjects = subjectList(viewer);
  const like = `%${q}%`;

  const permitted = sql`exists (
    select 1 from relation_tuples t
    where (t.subject_type || ':' || t.subject_id) in (${subjects})
      and (t.expires_at is null or t.expires_at > now())
      and ((t.object_type = 'file' and t.object_id = f.id)
        or (t.object_type = 'folder' and t.object_id = any(f.folder_path)))
  )`;

  const matches = sql`(
    f.name ilike ${like}
    or f.text ilike ${like}
    or similarity(f.name, ${q}) > 0.25
    or ${q} = any(f.tags)
  )`;

  const rows = await db.execute<{
    id: string;
    name: string;
    kind: string;
    folder_id: string | null;
    snippet: string;
    score: number;
    updated_at: Date;
  }>(sql`
    select f.id, f.name, f.kind, f.folder_id, f.updated_at,
           left(coalesce(substring(f.text from greatest(1, position(${q} in f.text) - 120)), f.text, ''), 320) as snippet,
           greatest(similarity(f.name, ${q}), case when f.text ilike ${like} then 0.4 else 0 end) as score
    from files f
    where f.tenant_id = ${viewer.tenantId} and f.deleted_at is null and ${matches} and ${permitted}
    order by score desc, f.updated_at desc
    limit ${limit}
  `);

  // What the filter removed — counted directly, as matches this viewer may
  // *not* read. Counting every match and subtracting the page returned three
  // wrong answers at once: it crossed the tenant boundary, so one studio's
  // query reported the existence of another's documents; it counted soft-
  // deleted rows; and once a search had more permitted matches than `limit` it
  // reported a withholding that never happened, which tells an employee their
  // answer is partial when it is complete.
  const [{ total = 0 } = { total: 0 }] = (
    await db.execute<{ total: number }>(sql`
      select count(*)::int as total from files f
      where f.tenant_id = ${viewer.tenantId} and f.deleted_at is null
        and ${matches} and not ${permitted}
    `)
  ).rows;

  const hits = rows.rows.map((r) => ({
    fileId: r.id,
    name: r.name,
    kind: r.kind,
    folderId: r.folder_id,
    snippet: (r.snippet ?? "").trim(),
    score: Number(r.score ?? 0),
    updatedAt: toDate(r.updated_at) ?? new Date(0),
  }));

  return { hits, withheld: Math.max(0, Number(total)) };
}

/** One file's text, permission-checked, truncated to something a prompt can
 * carry. Returns null when the viewer may not read it — the caller must treat
 * null as "does not exist", never as "denied". */
export async function readFileText(
  viewer: Viewer,
  fileId: string,
  maxChars = 24_000,
): Promise<{ name: string; text: string; truncated: boolean } | null> {
  const rows = await db.execute<{ name: string; text: string | null; len: number }>(sql`
    select f.name, left(coalesce(f.text, ''), ${maxChars}) as text, length(coalesce(f.text,'')) as len
    from files f
    where f.id = ${fileId} and f.tenant_id = ${viewer.tenantId} and f.deleted_at is null
      and exists (
        select 1 from relation_tuples t
        where (t.subject_type || ':' || t.subject_id) in (${subjectList(viewer)})
          and (t.expires_at is null or t.expires_at > now())
          and ((t.object_type = 'file' and t.object_id = f.id)
            or (t.object_type = 'folder' and t.object_id = any(f.folder_path)))
      )
    limit 1
  `);

  const row = rows.rows[0];
  if (!row) return null;
  return { name: row.name, text: row.text ?? "", truncated: Number(row.len) > maxChars };
}
