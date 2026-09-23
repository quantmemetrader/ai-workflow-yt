/**
 * Measure media that was uploaded before anything measured it.
 *
 * Nothing ever wrote `files.duration_ms`, so every video and audio file in the
 * store has unknown length — which is why footage added to a project totalled
 * zero on the timeline. The job now measures on upload; this queues the same
 * job for everything already there.
 *
 *   npm run db:backfill-duration
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, videoClips, videoProjects } from "@/lib/db/schema";
import { enqueue } from "@/lib/jobs/queue";

async function main() {
  const rows = await db
    .select({ id: files.id, tenantId: files.tenantId, name: files.name, ownerId: files.ownerId })
    .from(files)
    .where(
      and(
        inArray(files.kind, ["video", "audio"]),
        isNull(files.durationMs),
        isNull(files.deletedAt),
        sql`${files.storageKey} is not null`,
      ),
    );

  for (const row of rows) {
    await enqueue({
      tenantId: row.tenantId,
      type: "files.poster",
      module: "files",
      payload: { fileId: row.id },
      objectType: "file",
      objectId: row.id,
      createdBy: row.ownerId,
      dedupeKey: `poster:${row.id}:measure`,
      priority: 7,
    });
  }

  /* Clips already made from those files carry the same null, and a clip is
     what the timeline measures. The peaks job fills it in now, so any clip
     that never got one is queued too. */
  const clips = await db
    .select({ id: videoClips.id, projectId: videoClips.projectId, tenantId: videoProjects.tenantId })
    .from(videoClips)
    .innerJoin(videoProjects, eq(videoProjects.id, videoClips.projectId))
    .where(isNull(videoClips.durationMs));

  for (const clip of clips) {
    await enqueue({
      tenantId: clip.tenantId,
      type: "video.peaks",
      module: "video",
      payload: { clipId: clip.id },
      objectType: "video_project",
      objectId: clip.projectId,
      dedupeKey: `video:peaks:${clip.id}:measure`,
      priority: 7,
    });
  }

  console.log(`queued ${rows.length} file(s) and ${clips.length} clip(s) to measure.`);
  process.exit(0);
}

void main();
