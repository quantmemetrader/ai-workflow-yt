import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { videoExports, videoProjects } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { projectRelation } from "@/lib/video/access";

/**
 * Where a project's render has got to, for the chip that follows it off the
 * page. Tenant-scoped and module-checked like every other read; a project id
 * from another studio is a 404 rather than a state.
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Unauthorized", { status: 401 });
  if (!viewer.modules.includes("video")) return new Response("Forbidden", { status: 403 });

  const id = new URL(request.url).searchParams.get("project") ?? "";
  if (!id || id.length > 64) return new Response("Bad request", { status: 400 });

  const [project] = await db
    .select({ id: videoProjects.id, title: videoProjects.title, director: videoProjects.director })
    .from(videoProjects)
    .where(and(eq(videoProjects.id, id), eq(videoProjects.tenantId, viewer.tenantId), isNull(videoProjects.deletedAt)))
    .limit(1);
  if (!project || (await projectRelation(viewer, id)) === null) return new Response("Not found", { status: 404 });

  const [latest] = await db
    .select({ id: videoExports.id, state: videoExports.state, progress: videoExports.progress, fileId: videoExports.fileId, error: videoExports.error, createdAt: videoExports.createdAt })
    .from(videoExports)
    .where(eq(videoExports.projectId, id))
    .orderBy(desc(videoExports.createdAt))
    .limit(1);

  return Response.json(
    { id: project.id, title: project.title, director: project.director ?? {}, export: latest ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
