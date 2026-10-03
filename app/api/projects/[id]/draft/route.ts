import { type NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getViewer } from "@/lib/auth/dal";
import { db } from "@/lib/db/client";
import { workProjects } from "@/lib/db/schema";
import { projectsVisibleTo } from "@/lib/projects/service";

/** Where a project's first draft is: the step, when it began, whether it failed. Polled by the script page. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return Response.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const [row] = await db
    .select({ source: workProjects.source })
    .from(workProjects)
    .where(and(eq(workProjects.id, id), eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), projectsVisibleTo(viewer)))
    .limit(1);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });
  const src = (row.source ?? {}) as { writing?: { at?: string; stage?: string | null; since?: string } | null; draftFailed?: { note?: string } | null };
  return Response.json(
    { writing: Boolean(src.writing?.at), stage: src.writing?.stage ?? null, since: src.writing?.since ?? src.writing?.at ?? null, failed: src.draftFailed?.note ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
