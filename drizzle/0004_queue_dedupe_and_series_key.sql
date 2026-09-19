ALTER TABLE "topic_events" DROP CONSTRAINT "topic_events_topic_id_topics_id_fk";
--> statement-breakpoint
DROP INDEX "series_cache_idx";--> statement-breakpoint
ALTER TABLE "topic_events" ALTER COLUMN "topic_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "topic_events" ADD CONSTRAINT "topic_events_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_deleted_idx" ON "files" USING btree ("deleted_at") WHERE deleted_at is not null;--> statement-breakpoint
-- Both indexes below are unique where an older one was not, so collapse what
-- the old keys allowed before asking Postgres to forbid it.

-- A dedupe key already held by two unfinished jobs: keep the oldest, cancel
-- the rest. They are duplicates of work already queued.
UPDATE "jobs" SET status = 'cancelled', finished_at = now(),
       error = coalesce(error, 'Duplicate of a job already queued under the same dedupe key')
 WHERE id IN (
   SELECT id FROM (
     SELECT id, row_number() over (
              PARTITION BY tenant_id, type, payload->>'dedupeKey' ORDER BY created_at, id
            ) AS n
       FROM "jobs"
      WHERE status in ('queued','running') AND (payload->>'dedupeKey') IS NOT NULL
   ) d WHERE d.n > 1
 );--> statement-breakpoint
-- A series that fell back between sources left one row per source for the same
-- chart. Keep the freshest; the others are what readers were picking at random.
DELETE FROM "series_cache" WHERE id IN (
  SELECT id FROM (
    SELECT id, row_number() over (
             PARTITION BY "query", "window" ORDER BY fetched_at DESC, id DESC
           ) AS n
      FROM "series_cache"
  ) d WHERE d.n > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_idx" ON "jobs" USING btree ("tenant_id","type",(payload->>'dedupeKey')) WHERE status in ('queued','running') and (payload->>'dedupeKey') is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "series_cache_idx" ON "series_cache" USING btree ("query","window");