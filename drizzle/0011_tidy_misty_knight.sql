CREATE TYPE "public"."export_state" AS ENUM('queued', 'rendering', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "captions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"start_ms" integer DEFAULT 0 NOT NULL,
	"end_ms" integer DEFAULT 2000 NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"language" text DEFAULT 'zh-HK' NOT NULL,
	"ord" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_items" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"clip_id" text,
	"kind" text DEFAULT 'clip' NOT NULL,
	"ord" integer DEFAULT 0 NOT NULL,
	"in_ms" integer DEFAULT 0 NOT NULL,
	"out_ms" integer,
	"text" text,
	"hold_ms" integer DEFAULT 2500 NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_clips" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"file_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"duration_ms" integer,
	"width" integer,
	"height" integer,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"aspect" text DEFAULT '16:9' NOT NULL,
	"burn_captions" text DEFAULT 'burn' NOT NULL,
	"caption_language" text DEFAULT 'zh-HK' NOT NULL,
	"state" "export_state" DEFAULT 'queued' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"file_id" text,
	"subtitle_file_id" text,
	"duration_ms" integer,
	"size_bytes" bigint,
	"command" text,
	"error" text,
	"requested_by" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"script_id" text,
	"master_file_id" text,
	"notes" text DEFAULT '' NOT NULL,
	"owner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "captions" ADD CONSTRAINT "captions_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_items" ADD CONSTRAINT "timeline_items_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_items" ADD CONSTRAINT "timeline_items_clip_id_video_clips_id_fk" FOREIGN KEY ("clip_id") REFERENCES "public"."video_clips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_clips" ADD CONSTRAINT "video_clips_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_exports" ADD CONSTRAINT "video_exports_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_exports" ADD CONSTRAINT "video_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "captions_idx" ON "captions" USING btree ("project_id","language","start_ms");--> statement-breakpoint
CREATE INDEX "timeline_items_idx" ON "timeline_items" USING btree ("project_id","ord");--> statement-breakpoint
CREATE INDEX "video_clips_idx" ON "video_clips" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "video_exports_idx" ON "video_exports" USING btree ("tenant_id","state","created_at");--> statement-breakpoint
CREATE INDEX "video_projects_idx" ON "video_projects" USING btree ("tenant_id","updated_at");