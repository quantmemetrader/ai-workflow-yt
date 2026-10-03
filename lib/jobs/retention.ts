import "server-only";
import { and, eq, inArray, lt, notInArray, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobEvents, jobs } from "@/lib/db/schema";

/**
 * Finished jobs go after a while, and their events with them.
 *
 * Every screen that reads `jobs` asks for queued or running ones — what is
 * happening now — and `job_events` is only ever written (`queue.ts`), so a
 * finished job has one reader left: a chat turn that narrated a render to
 * its end names its job, and the thread finds the render through the job
 * row (`lib/chat/video-card.ts` → `lib/chat/videos.ts`). Render jobs are
 * therefore kept whatever their age; they are a handful of rows.
 *
 * Succeeded after fourteen days, failed after sixty: "why did the sync stop
 * in September" is a question that gets asked, "what synced in September" is
 * not. Never queued or running, whatever their age — the queue belongs to the
 * worker, and a job stuck in running is `requeueStalled`'s to fail. Cancelled
 * rows are left alone too: few, and a person's decision.
 *
 * `finished_at` is written by `succeed`, `fail` and `requeueStalled`; a row
 * without one is matched by nothing here and stays.
 *
 * Called by the nightly sweep (scripts/sweep.ts).
 */
const KEPT_TYPES = ["video.export", "video.direct"];

export async function purgeFinishedJobs(
  opts: { succeededDays?: number; failedDays?: number } = {},
): Promise<{ jobs: number; events: number }> {
  const now = Date.now();
  const succeededBefore = new Date(now - (opts.succeededDays ?? 14) * 86_400_000);
  const failedBefore = new Date(now - (opts.failedDays ?? 60) * 86_400_000);
  const doomed = and(
    or(
      and(eq(jobs.status, "succeeded"), lt(jobs.finishedAt, succeededBefore)),
      and(eq(jobs.status, "failed"), lt(jobs.finishedAt, failedBefore)),
    ),
    notInArray(jobs.type, KEPT_TYPES),
  );

  return db.transaction(async (trx) => {
    /* The foreign key cascades; deleting the events ourselves makes them a
       number in the log rather than a guess, and keeps the job delete small. */
    const events = await trx
      .delete(jobEvents)
      .where(inArray(jobEvents.jobId, trx.select({ id: jobs.id }).from(jobs).where(doomed)));
    const removed = await trx.delete(jobs).where(doomed);
    return { jobs: removed.rowCount ?? 0, events: events.rowCount ?? 0 };
  });
}
