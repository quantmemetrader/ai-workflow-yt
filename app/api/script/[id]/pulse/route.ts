import { type NextRequest } from "next/server";
import { and, count, eq, isNull } from "drizzle-orm";
import { getViewer } from "@/lib/auth/dal";
import { db } from "@/lib/db/client";
import { scriptBeats, scripts } from "@/lib/db/schema";
import { projectsVisibleTo } from "@/lib/projects/service";
import { scriptWriting } from "@/lib/script/writing";

/**
 * One script's state in a few fields, for a page waiting on a draft.
 *
 * After "start and write the script" the person lands on the script (or the
 * project) while 编剧 is still writing. The page asks this every few
 * seconds and refreshes once, when `writing` goes false or the beats
 * arrive, instead of re-rendering itself on a timer.
 *
 * `writing` is the projects' own mark (`work_projects.source.writing`), set
 * when the draft was started from the topic and cleared when it landed or
 * failed; true while any live project that has this script carries a fresh
 * one, and one older than ten minutes counts as gone (`scriptWriting`).
 *
 * Who may ask: someone with Script reads any of the studio's scripts, as the
 * script page lets them. Someone with only Chat waits on a script from a
 * project page, so they get an answer only for a script whose project they
 * can see. `projectId` is only ever a project the asker can see.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer || !(viewer.modules.includes("script") || viewer.modules.includes("chat"))) return Response.json({ error: "Not allowed" }, { status: 403 });
  const { id } = await params;
  const [row] = await db
    .select({ status: scripts.status, version: scripts.version, updatedAt: scripts.updatedAt })
    .from(scripts)
    .where(and(eq(scripts.id, id), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
    .limit(1);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  const [[beats], about] = await Promise.all([
    db.select({ n: count() }).from(scriptBeats).where(eq(scriptBeats.scriptId, id)),
    scriptWriting(viewer.tenantId, id, projectsVisibleTo(viewer)),
  ]);
  if (!viewer.modules.includes("script") && !about.projectId) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(
    { status: row.status, beats: beats?.n ?? 0, version: row.version, writing: about.writing, updatedAt: row.updatedAt.toISOString(), projectId: about.projectId },
    { headers: { "Cache-Control": "no-store" } },
  );
}
