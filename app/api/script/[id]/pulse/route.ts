import { type NextRequest } from "next/server";
import { and, count, eq, isNull } from "drizzle-orm";
import { getViewer } from "@/lib/auth/dal";
import { db } from "@/lib/db/client";
import { scriptBeats, scripts, workProjects } from "@/lib/db/schema";
import { isWriting, type ProjectSource } from "@/lib/projects/topic";

/**
 * One script's state in a few fields, for a page waiting on a draft.
 *
 * After "start and write the script" the person lands on the script (or the
 * project) while 编剧 is still writing. The page asks this every few
 * seconds and refreshes once, when `writing` goes false or the beats
 * arrive, instead of re-rendering itself on a timer.
 *
 * `writing` is the project's own mark (`work_projects.source.writing`), set
 * when the draft was started from the topic and cleared when it landed or
 * failed; one older than ten minutes counts as gone.
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
  const [[beats], [project]] = await Promise.all([
    db.select({ n: count() }).from(scriptBeats).where(eq(scriptBeats.scriptId, id)),
    db
      .select({ id: workProjects.id, source: workProjects.source })
      .from(workProjects)
      .where(and(eq(workProjects.tenantId, viewer.tenantId), eq(workProjects.scriptId, id), isNull(workProjects.deletedAt)))
      .orderBy(workProjects.createdAt)
      .limit(1),
  ]);
  const writing = isWriting((project?.source as ProjectSource | null) ?? null, Date.now());
  return Response.json(
    { status: row.status, beats: beats?.n ?? 0, version: row.version, writing, updatedAt: row.updatedAt.toISOString(), projectId: project?.id ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
