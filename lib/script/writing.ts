import "server-only";
import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workProjects } from "@/lib/db/schema";
import { isWriting, type ProjectSource } from "@/lib/projects/topic";

/**
 * Whether 编剧 is writing a draft into a script right now.
 *
 * The mark lives on the project (`work_projects.source.writing`), set by
 * `draftInBackground` when a draft starts and cleared when it lands or fails.
 * Every place that asks (the pulse a waiting page polls, the script page's
 * banner and flow panel, the guard that refuses a second draft) asks here,
 * so none of them can disagree.
 *
 * Every live project that has the script counts, not only the oldest. A
 * script is meant to belong to one project, but a pair made before
 * `chooseScriptAction` refused to share one still does (测试 and the digest
 * project it copied), and reading only the oldest said "not writing" while
 * 编剧 was writing from the newer one: the project page stopped waiting and
 * refreshed onto the old beats, and a second draft could be started into the
 * same script from the other project.
 *
 * A mark older than `WRITING_TTL_MS` is a draft that never cleared it (the
 * process was restarted mid-draft, so its `finally` never ran). It already
 * counts as gone; it is also cleared here, and only while it is still that
 * same mark, so a draft started a moment ago is never wiped.
 *
 * `projectId` is the project a waiting page should point at: the one writing,
 * else the oldest. `visible` narrows it to the projects this person may see
 * (`projectsVisibleTo(viewer)`, passed in by the caller so this file does not
 * import the projects service, which imports the script service); a script
 * whose projects are all hidden from them answers null.
 */
export async function scriptWriting(tenantId: string, scriptId: string, visible?: SQL): Promise<{ writing: boolean; projectId: string | null }> {
  const rows = await db
    .select({ id: workProjects.id, source: workProjects.source, seen: visible ? sql<boolean | null>`(${visible})` : sql<boolean>`true` })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, tenantId), eq(workProjects.scriptId, scriptId), isNull(workProjects.deletedAt)))
    .orderBy(asc(workProjects.createdAt));
  const { busy, stale } = writingMarks(rows, Date.now());
  if (stale.length) await Promise.all(stale.map((s) => clearStaleMark(s.id, s.at).catch(() => {})));
  const seen = rows.filter((r) => r.seen === true);
  const pick = seen.find((r) => busy.includes(r.id)) ?? seen[0] ?? null;
  return { writing: busy.length > 0, projectId: pick?.id ?? null };
}

/**
 * Which of a script's projects are writing now, and which carry a mark past
 * its time. Pure, so the rule can be checked without a database.
 */
export function writingMarks(rows: { id: string; source: unknown }[], now: number): { busy: string[]; stale: { id: string; at: string }[] } {
  const busy: string[] = [];
  const stale: { id: string; at: string }[] = [];
  for (const r of rows) {
    const src = (r.source as ProjectSource | null) ?? null;
    const at = src?.writing?.at;
    if (!at) continue;
    if (isWriting(src, now)) busy.push(r.id);
    else stale.push({ id: r.id, at });
  }
  return { busy, stale };
}

/** Drop one expired mark, only if it is still the one that was read (a jsonb merge, like `setProjectWriting`). */
async function clearStaleMark(projectId: string, at: string): Promise<void> {
  await db
    .update(workProjects)
    .set({ source: sql`coalesce(${workProjects.source}, '{}'::jsonb) || '{"writing":null}'::jsonb` })
    .where(and(eq(workProjects.id, projectId), sql`${workProjects.source} -> 'writing' ->> 'at' = ${at}`));
}
