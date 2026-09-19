CREATE TYPE "public"."approval_state" AS ENUM('requested', 'approved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."script_status" AS ENUM('brief', 'drafting', 'awaiting_approval', 'locked', 'archived');--> statement-breakpoint
CREATE TYPE "public"."suggestion_kind" AS ENUM('house_style', 'length', 'register', 'clarity', 'sound_direction', 'fact_check');--> statement-breakpoint
CREATE TYPE "public"."suggestion_state" AS ENUM('open', 'accepted', 'rejected', 'moved');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"checksum" text,
	"version_no" integer,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approver_id" text,
	"state" "approval_state" DEFAULT 'requested' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "script_beats" (
	"id" text PRIMARY KEY NOT NULL,
	"script_id" text NOT NULL,
	"ord" integer NOT NULL,
	"start_seconds" integer,
	"visual" text DEFAULT '' NOT NULL,
	"voiceover" text DEFAULT '' NOT NULL,
	"subtitle" text DEFAULT '' NOT NULL,
	"natural_sound" boolean DEFAULT false NOT NULL,
	"spoken_seconds" real,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"script_id" text NOT NULL,
	"beat_ord" integer,
	"version_no" integer,
	"author_id" text,
	"body" text NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"name_local" text,
	"owner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "script_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"script_id" text NOT NULL,
	"beat_ord" integer,
	"kind" "suggestion_kind" NOT NULL,
	"label" text NOT NULL,
	"before" text,
	"after" text,
	"rationale" text,
	"state" "suggestion_state" DEFAULT 'open' NOT NULL,
	"acted_by" text,
	"acted_at" timestamp with time zone,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "script_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"script_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"beats" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checksum" text NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"spoken_seconds" real,
	"conformance" real,
	"guide_version" text,
	"reading_level" text,
	"flagged_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"mandatory_covered" integer DEFAULT 0 NOT NULL,
	"note" text,
	"author_id" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scripts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"folder_id" text,
	"topic_id" text,
	"title" text NOT NULL,
	"title_local" text,
	"status" "script_status" DEFAULT 'brief' NOT NULL,
	"angle" text,
	"target_channel" text,
	"aspect" text,
	"target_seconds" integer,
	"tolerance_percent" real DEFAULT 5 NOT NULL,
	"language" text,
	"subtitle_language" text,
	"mandatory_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_file_ids" text[] DEFAULT '{}' NOT NULL,
	"brief_updated_by" text,
	"brief_updated_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"locked_version" integer,
	"owner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_beats" ADD CONSTRAINT "script_beats_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_beats" ADD CONSTRAINT "script_beats_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_comments" ADD CONSTRAINT "script_comments_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_comments" ADD CONSTRAINT "script_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_comments" ADD CONSTRAINT "script_comments_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_folders" ADD CONSTRAINT "script_folders_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_suggestions" ADD CONSTRAINT "script_suggestions_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_suggestions" ADD CONSTRAINT "script_suggestions_acted_by_users_id_fk" FOREIGN KEY ("acted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_versions" ADD CONSTRAINT "script_versions_script_id_scripts_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."scripts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_versions" ADD CONSTRAINT "script_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_folder_id_script_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."script_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_brief_updated_by_users_id_fk" FOREIGN KEY ("brief_updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scripts" ADD CONSTRAINT "scripts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_object_idx" ON "approvals" USING btree ("object_type","object_id","requested_at");--> statement-breakpoint
CREATE INDEX "approvals_pending_idx" ON "approvals" USING btree ("tenant_id","state","approver_id");--> statement-breakpoint
CREATE UNIQUE INDEX "script_beats_ord_idx" ON "script_beats" USING btree ("script_id","ord");--> statement-breakpoint
CREATE INDEX "script_comments_idx" ON "script_comments" USING btree ("script_id","created_at");--> statement-breakpoint
CREATE INDEX "script_folders_tenant_idx" ON "script_folders" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "script_suggestions_idx" ON "script_suggestions" USING btree ("script_id","state","beat_ord");--> statement-breakpoint
CREATE UNIQUE INDEX "script_versions_no_idx" ON "script_versions" USING btree ("script_id","version_no");--> statement-breakpoint
CREATE INDEX "scripts_tenant_idx" ON "scripts" USING btree ("tenant_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "scripts_folder_idx" ON "scripts" USING btree ("folder_id");