ALTER TABLE "hot_snapshots" ADD COLUMN "judged" jsonb;--> statement-breakpoint
ALTER TABLE "topics" DROP COLUMN "judged";