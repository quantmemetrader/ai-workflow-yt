CREATE TABLE "work_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"title" text NOT NULL,
	"brief" text,
	"status" text DEFAULT 'active' NOT NULL,
	"mode" text DEFAULT 'full' NOT NULL,
	"source" jsonb,
	"channel_id" text NOT NULL,
	"script_id" text,
	"video_project_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "work_projects_tenant_idx" ON "work_projects" USING btree ("tenant_id","updated_at");