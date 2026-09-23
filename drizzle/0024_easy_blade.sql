CREATE TABLE "creator_videos" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"platform" text DEFAULT 'youtube' NOT NULL,
	"external_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"duration_sec" integer,
	"views" bigint DEFAULT 0 NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"thumbnail_url" text,
	"published_at" timestamp with time zone,
	"transcript_source" text,
	"transcript" text,
	"notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_graphics" ADD COLUMN "options" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "director" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_videos_external_idx" ON "creator_videos" USING btree ("tenant_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "creator_videos_views_idx" ON "creator_videos" USING btree ("tenant_id","views");