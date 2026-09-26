import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { videoExports } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { projectById } from "@/lib/video/service";
import type { DirectorState } from "@/lib/video/director";

/**
 * Where a long job stands, for the live chip under a chat message.
 *
 * An employee's message that started a director run or a render carries the
 * video project's id (`meta.job`); the chip under it asks here every few
 * seconds while the job runs, and stops once it is done or has failed. One
 * row and one small read, never the thread. Only for somebody who may open
 * that video project: the chip of a private project's render says nothing
 * to anybody else.
 *
 *   state   — queued · running · done · failed · idle
 *   step    — the director's step (footage, transcribe, cut, design,
 *             pictures, write, render), or "render" for a plain export
 *   percent — the render's progress, 0–100, when there is a render
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("chat")) return Response.json({ error: "Not allowed" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("project") ?? "";
  if (!/^prj_[0-9a-z]{10,40}$/i.test(id)) return Response.json({ error: "Bad request" }, { status: 400 });
  const project = await projectById(viewer, id, "viewer");
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });

  const [render] = await db
    .select({ state: videoExports.state, progress: videoExports.progress, fileId: videoExports.fileId, at: videoExports.createdAt })
    .from(videoExports)
    .where(eq(videoExports.projectId, project.id))
    .orderBy(desc(videoExports.createdAt))
    .limit(1);
  const director = (project.director ?? null) as DirectorState | null;
  /* Progress is stored as 0–1 by the renderer and as 0–100 by older rows. */
  const percent = render ? Math.max(0, Math.min(100, Math.round(render.progress > 1 ? render.progress : render.progress * 100))) : null;

  const directing = director && (director.state === "queued" || director.state === "running");
  const rendering = render && (render.state === "queued" || render.state === "rendering");
  const state = directing
    ? director.state
    : rendering
      ? render.state === "queued"
        ? "queued"
        : "running"
      : director?.state === "failed" && (!render || new Date(director.finishedAt ?? 0) >= render.at)
        ? "failed"
        : render?.state === "done"
          ? "done"
          : render?.state === "failed"
            ? "failed"
            : director?.state === "done"
              ? "done"
              : "idle";
  return Response.json(
    {
      state,
      step: directing ? (director.step ?? null) : rendering ? "render" : null,
      percent: rendering || (directing && director.step === "render") ? percent : state === "done" ? 100 : null,
      fileId: state === "done" ? (render?.fileId ?? null) : null,
      error: state === "failed" ? (director?.error ?? null) : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
