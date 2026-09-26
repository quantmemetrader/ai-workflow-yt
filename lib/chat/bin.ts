import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { videoClips } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { addClip } from "@/lib/video/service";

/**
 * A video posted in a project's chat goes into that project's bin — once.
 *
 * The take may already be there: uploaded on the project page and then
 * dropped into the channel so 剪辑师 sees it, or attached twice while the
 * first message was still on its way. `addClip` adds every time it is
 * called (the bin may legitimately hold the same footage twice), so the
 * chat checks first, and says "已加入项目素材" for the clip that is there
 * rather than making a second block nobody asked for.
 */
export async function binVideo(viewer: Viewer, videoProjectId: string, fileId: string): Promise<{ clipId: string; existed: boolean }> {
  const [had] = await db
    .select({ id: videoClips.id })
    .from(videoClips)
    .where(and(eq(videoClips.projectId, videoProjectId), eq(videoClips.fileId, fileId)))
    .limit(1);
  if (had) return { clipId: had.id, existed: true };
  return { clipId: await addClip(viewer, videoProjectId, fileId), existed: false };
}
