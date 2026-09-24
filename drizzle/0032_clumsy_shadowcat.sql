CREATE TABLE "hot_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rows" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE INDEX "hot_snapshots_platform_idx" ON "hot_snapshots" USING btree ("platform","fetched_at");