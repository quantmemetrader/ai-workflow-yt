import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { moduleEnum, users } from "./core";

/**
 * The job pipeline (spec §6). Postgres-backed rather than Redis-backed:
 * `SELECT … FOR UPDATE SKIP LOCKED` gives exactly the semantics the spec asks
 * for — one worker per job, visible state, retry with backoff — with one less
 * service to run, and the queue is transactional with the rows it mutates.
 *
 * Workers are ordinary processes (Vercel cron, or the render box when FFmpeg
 * work starts); nothing here assumes where they run.
 */
export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const jobs = pgTable(
  "jobs",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    type: text().notNull(),
    module: moduleEnum(),
    status: jobStatusEnum().notNull().default("queued"),
    priority: integer().notNull().default(0),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb().$type<unknown>(),
    /** The provider's own error, surfaced intact to the user (brief, Video). */
    error: text(),
    provider: text(),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(3),
    progress: real().notNull().default(0),
    costMicros: bigint({ mode: "number" }).notNull().default(0),
    /** What this job is about, so a screen can show "your render is running"
     * without a table per job type. */
    objectType: text(),
    objectId: text(),
    runAfter: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp({ withTimezone: true }),
    lockedBy: text(),
    createdBy: text().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    /** The claim query's index: ready jobs, best first. */
    index("jobs_claim_idx").on(t.status, t.runAfter, t.priority),
    index("jobs_object_idx").on(t.objectType, t.objectId),
    index("jobs_creator_idx").on(t.createdBy, t.createdAt),
    /**
     * What actually makes `dedupeKey` mean something. Reading the queue before
     * inserting is a race two people opening the same chart can lose; the
     * index refuses the second row instead. Partial, so the key is free again
     * once the job finishes — the next refresh must still be allowed to queue.
     */
    uniqueIndex("jobs_dedupe_idx")
      .on(t.tenantId, t.type, sql`(payload->>'dedupeKey')`)
      .where(sql`status in ('queued','running') and (payload->>'dedupeKey') is not null`),
  ],
);

/** Append-only trail per job: every state change, every attempt, what the
 * provider said. This is what the Video screen shows when a job is stuck. */
export const jobEvents = pgTable(
  "job_events",
  {
    id: text().primaryKey(),
    jobId: text().notNull().references(() => jobs.id, { onDelete: "cascade" }),
    status: jobStatusEnum().notNull(),
    attempt: integer().notNull().default(0),
    note: text(),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("job_events_job_idx").on(t.jobId, t.at)],
);
