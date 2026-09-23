ALTER TABLE "channel_posts" ADD COLUMN "status" text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "channel_posts" ADD COLUMN "scheduled_for" timestamp with time zone;