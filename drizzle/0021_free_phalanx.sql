ALTER TABLE "timeline_items" ADD COLUMN "transition" text DEFAULT 'cut' NOT NULL;--> statement-breakpoint
ALTER TABLE "timeline_items" ADD COLUMN "transition_ms" integer DEFAULT 400 NOT NULL;