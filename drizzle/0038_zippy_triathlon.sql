CREATE TABLE "ideas" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"created_by" text NOT NULL,
	"seed" text,
	"title" text NOT NULL,
	"titles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"angle" text,
	"why" text,
	"hook" text,
	"format" text,
	"strength" integer,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"project_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "work_role" text;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD COLUMN "speaker" text;--> statement-breakpoint
ALTER TABLE "hot_snapshots" ADD COLUMN "relevance" jsonb;--> statement-breakpoint
ALTER TABLE "work_projects" ADD COLUMN "topic_id" text;--> statement-breakpoint
CREATE INDEX "ideas_tenant_idx" ON "ideas" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "work_projects_topic_idx" ON "work_projects" USING btree ("tenant_id","topic_id");