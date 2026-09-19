CREATE TYPE "public"."topic_stage" AS ENUM('adopted', 'briefing', 'scripting', 'handed');--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "stage" "topic_stage" DEFAULT 'adopted' NOT NULL;