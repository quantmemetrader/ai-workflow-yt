import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { HEAVY_JOBS_PAUSED, HEAVY_JOB_TYPES } from "./heavy";
import { db, toDate } from "@/lib/db/client";
import { jobEvents, jobs, type Module } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

/**
 * The job pipeline (spec §6), on Postgres.
 *
 * `SELECT … FOR UPDATE SKIP LOCKED` is the whole trick: several workers can
 * claim from the same table without ever handing the same job to two of them,
 * and without a second service to run. Each state change is also written to
 * `job_events`, because the Video screen has to be able to say *why* a job is
 * stuck, not just that it is.
 */
export type JobType =
  | "research.refreshTopic"
  | "research.series"
  | "research.refreshFeeds"
  /** The studio's own channels, mirrored from Zernio. Jobs rather than page
   * reads because the vendor bills per request (`lib/social/ingest.ts`). */
  | "social.syncChannels"
  | "social.syncPosts"
  | "social.syncDailyViews"
  | "social.syncComments"
  | "social.classifyComments"
  /** Somebody else's channel, read from the outside through TikHub. */
  | "social.syncCompetitors"
  /** Sending a post to its channels. Queued rather than done on the approval
   * request, so a slow platform cannot hold a page open and a retry cannot
   * become a second post (`lib/publish/dispatch.ts`). */
  | "publish.send"
  /** Assembling a cut with FFmpeg on this box. Minutes of CPU on a long
   * master, so it is never a request (`lib/video/render.ts`). */
  | "video.export"
  /** Captions from the cut's own audio, through ElevenLabs Scribe. Minutes of
   * extraction and upload, so never a request (`lib/video/transcribe.ts`). */
  | "video.transcribe"
  /** A voice-over spoken by ElevenLabs and written into the file store. */
  | "video.voiceover"
  /** A still out of a video, for the file lists. FFmpeg is on the box and not
   * on Vercel, which is why this is a job and not a request. */
  | "files.poster"
  /** The 480p copy of an uploaded clip that the editor plays instead of the
   * master (`lib/video/proxy.ts`). One FFmpeg pass on the box. */
  | "files.proxy"
  | "video.peaks"
  | "video.autoedit"
  /** Transcribe, cut, design, render: the whole video from a brief
   * (`lib/video/director.ts`). Minutes on the worker. */
  | "video.direct"
  /** Mirror the creator's own channel and rewrite the voice note
   * (`lib/creator/service.ts`). */
  | "creator.sync"
  /** 策划 reads a freshly transcribed upload and says in #制作 what could be
   * made from it (`lib/agents/footage.ts`). Queued by the transcription that
   * footage landing started, so the studio hears about a tape without anybody
   * asking. */
  | "agent.footage";

export type JobRow = typeof jobs.$inferSelect;

/**
 * A row as node-postgres hands it back from `returning *`: snake_case, with
 * timestamps as strings and `bigint` as a string. Typing `db.execute` as
 * `JobRow` was a lie — `maxAttempts` was always `undefined`, so `fail()` never
 * found a job exhausted and a permanently broken job retried for ever.
 */
type RawJobRow = {
  id: string;
  tenant_id: string;
  type: string;
  module: Module | null;
  status: JobRow["status"];
  priority: number;
  payload: Record<string, unknown> | null;
  result: unknown;
  error: string | null;
  provider: string | null;
  attempts: number;
  max_attempts: number;
  progress: number;
  cost_micros: string | number;
  object_type: string | null;
  object_id: string | null;
  run_after: unknown;
  locked_at: unknown;
  locked_by: string | null;
  created_by: string | null;
  created_at: unknown;
  started_at: unknown;
  finished_at: unknown;
};

function toJobRow(raw: RawJobRow): JobRow {
  return {
    id: raw.id,
    tenantId: raw.tenant_id,
    type: raw.type,
    module: raw.module,
    status: raw.status,
    priority: Number(raw.priority),
    payload: raw.payload ?? {},
    result: raw.result,
    error: raw.error,
    provider: raw.provider,
    attempts: Number(raw.attempts),
    maxAttempts: Number(raw.max_attempts),
    progress: Number(raw.progress),
    costMicros: Number(raw.cost_micros),
    objectType: raw.object_type,
    objectId: raw.object_id,
    runAfter: toDate(raw.run_after) ?? new Date(),
    lockedAt: toDate(raw.locked_at),
    lockedBy: raw.locked_by,
    createdBy: raw.created_by,
    createdAt: toDate(raw.created_at) ?? new Date(),
    startedAt: toDate(raw.started_at),
    finishedAt: toDate(raw.finished_at),
  };
}

/** Postgres' unique-violation code, which Drizzle keeps on the `cause` of the
 * error it throws rather than on the error itself. */
function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

/** The unfinished job already holding this dedupe key, if there is one. */
async function liveDuplicate(tenantId: string, type: JobType, dedupeKey: string) {
  const [existing] = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.tenantId, tenantId),
        eq(jobs.type, type),
        sql`${jobs.status} in ('queued','running')`,
        sql`${jobs.payload}->>'dedupeKey' = ${dedupeKey}`,
      ),
    )
    .limit(1);
  return existing ?? null;
}

export async function enqueue(input: {
  tenantId: string;
  type: JobType;
  payload?: Record<string, unknown>;
  module?: Module;
  objectType?: string;
  objectId?: string;
  createdBy?: string;
  priority?: number;
  runAfter?: Date;
  /** When set, an identical unfinished job is reused instead of queued twice —
   * two people opening the same chart should cause one fetch. */
  dedupeKey?: string;
}): Promise<JobRow> {
  if (input.dedupeKey) {
    const existing = await liveDuplicate(input.tenantId, input.type, input.dedupeKey);
    if (existing) return existing;
  }

  const values = {
    id: newId("job"),
    tenantId: input.tenantId,
    type: input.type,
    module: input.module,
    payload: { ...(input.payload ?? {}), ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}) },
    objectType: input.objectType,
    objectId: input.objectId,
    createdBy: input.createdBy,
    priority: input.priority ?? 0,
    runAfter: input.runAfter ?? new Date(),
  };

  let row: JobRow;
  try {
    [row] = await db.insert(jobs).values(values).returning();
  } catch (err) {
    // `jobs_dedupe_idx` is what actually prevents a duplicate: the check above
    // is only an optimisation, and two callers can pass it at the same moment.
    // Losing that race means the other one queued the work — which is the
    // outcome the caller asked for.
    if (input.dedupeKey && isUniqueViolation(err)) {
      const existing = await liveDuplicate(input.tenantId, input.type, input.dedupeKey);
      if (existing) return existing;
    }
    throw err;
  }

  await note(row.id, "queued", 0);
  return row;
}

/**
 * Takes one ready job and marks it running, atomically.
 *
 * The id breaks the tie in the ordering. `run_after` has millisecond
 * precision and a burst of enqueues shares one, which left the order among
 * them up to the planner — a job could be passed over indefinitely while its
 * neighbours were served. Ids are time-sortable, so this is first in, first
 * out.
 */
export async function claim(workerId: string): Promise<JobRow | null> {
  const { rows } = await db.execute<RawJobRow>(sql`
    update jobs set status = 'running',
                    attempts = attempts + 1,
                    locked_at = now(),
                    locked_by = ${workerId},
                    started_at = coalesce(started_at, now())
     where id = (
       select id from jobs
        where status = 'queued' and run_after <= now()
          and (${!HEAVY_JOBS_PAUSED} or not (type = any(${sql.raw(`array[${HEAVY_JOB_TYPES.map((t) => `'${t}'`).join(",")}]`)})))
        order by priority desc, run_after asc, id asc
        for update skip locked
        limit 1
     )
    returning *
  `);

  if (!rows[0]) return null;
  const job = toJobRow(rows[0]);
  await note(job.id, "running", job.attempts);
  return job;
}

export async function succeed(job: JobRow, result: unknown) {
  await db
    .update(jobs)
    .set({ status: "succeeded", result, finishedAt: new Date(), progress: 1, error: null })
    .where(eq(jobs.id, job.id));
  await note(job.id, "succeeded", job.attempts);
}

/**
 * Fails a job. Retries with exponential backoff until `maxAttempts`, then
 * stops and keeps the provider's own message — the brief requires the error be
 * surfaced intact rather than replaced with "something went wrong".
 */
export async function fail(job: JobRow, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.maxAttempts;
  const backoffMs = Math.min(60 * 60_000, 30_000 * 2 ** (job.attempts - 1));

  await db
    .update(jobs)
    .set(
      exhausted
        ? { status: "failed", error: message, finishedAt: new Date(), lockedBy: null, lockedAt: null }
        : { status: "queued", error: message, runAfter: new Date(Date.now() + backoffMs), lockedBy: null, lockedAt: null },
    )
    .where(eq(jobs.id, job.id));

  await note(job.id, exhausted ? "failed" : "queued", job.attempts, message);
}

/**
 * Put a job back as if it had never been claimed: the worker was told to
 * stop under it, and that is not the job's fault, so it keeps its attempts.
 */
export async function requeue(job: JobRow, why: string) {
  await db
    .update(jobs)
    .set({
      status: "queued",
      attempts: Math.max(0, job.attempts - 1),
      error: null,
      runAfter: new Date(Date.now() + 5_000),
      lockedBy: null,
      lockedAt: null,
      startedAt: null,
    })
    .where(eq(jobs.id, job.id));
  await note(job.id, "queued", job.attempts, why);
}

/** The worker is still on it: `locked_at` is what the stalled sweep reads. */
export async function heartbeat(jobId: string) {
  await db.update(jobs).set({ lockedAt: new Date() }).where(and(eq(jobs.id, jobId), eq(jobs.status, "running")));
}

export async function progress(jobId: string, fraction: number) {
  await db.update(jobs).set({ progress: Math.max(0, Math.min(1, fraction)) }).where(eq(jobs.id, jobId));
}

async function note(jobId: string, status: JobRow["status"], attempt: number, message?: string) {
  await db
    .insert(jobEvents)
    .values({ id: newId("job"), jobId, status, attempt, note: message?.slice(0, 500) })
    .catch(() => {});
}

/**
 * A worker that dies mid-job leaves it "running" forever; anything held for
 * more than fifteen minutes is considered abandoned.
 *
 * An abandoned job that has already used its attempts is failed rather than
 * re-queued: a job that kills its worker would otherwise be handed to the next
 * one for ever, and "stuck" is exactly what the Video screen must be able to
 * explain.
 */
export async function requeueStalled(olderThanMinutes = 15) {
  const { rows } = await db.execute<{ id: string; status: JobRow["status"]; attempts: number }>(sql`
    update jobs
       set status = case when attempts >= max_attempts then 'failed'::job_status else 'queued'::job_status end,
           error = case when attempts >= max_attempts
                        then coalesce(error, 'Abandoned by a worker that stopped responding')
                        else error end,
           finished_at = case when attempts >= max_attempts then now() else finished_at end,
           locked_by = null,
           locked_at = null
     where status = 'running' and locked_at < now() - ${`${olderThanMinutes} minutes`}::interval
    returning id, status, attempts
  `);

  for (const row of rows) {
    await note(row.id, row.status, Number(row.attempts), "reclaimed from a stalled worker");
  }
  return rows.length;
}
