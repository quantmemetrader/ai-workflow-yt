import "server-only";
import type { Viewer } from "@/lib/auth/types";
import { enqueue } from "@/lib/jobs/queue";

/**
 * After a person puts filmed footage into a project: transcribe the whole clip once and write what the host says
 * into the script page (`video.clipScript` in scripts/worker.ts → `transcribeClip` → `syncScriptFromFootage`).
 * Footage the AI pulls in (stock, cutaways, link imports) does not come through here.
 */
export async function queueClipScript(viewer: Viewer, clipId: string) {
  await enqueue({
    tenantId: viewer.tenantId,
    type: "video.clipScript",
    module: "video",
    payload: { clipId },
    objectType: "video_clip",
    objectId: clipId,
    createdBy: viewer.id,
    dedupeKey: `clipscript:${clipId}`,
    priority: 2,
    runAfter: new Date(Date.now() + 15_000),
  }).catch((err) => console.error("[clip-script] could not queue", clipId, err));
}
