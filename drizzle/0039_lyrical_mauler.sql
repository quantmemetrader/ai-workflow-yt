CREATE TABLE IF NOT EXISTS "own_account_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"platform" text NOT NULL,
	"account_id" text NOT NULL,
	"source" text DEFAULT 'tikhub' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"posts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"fetched_by" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "project_post_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"platform" text NOT NULL,
	"url" text,
	"title" text,
	"source" text DEFAULT 'tikhub' NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"fetched_by" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage" ADD COLUMN IF NOT EXISTS "requested_by" text;--> statement-breakpoint
ALTER TABLE "script_comments" ADD COLUMN IF NOT EXISTS "quote" text;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN IF NOT EXISTS "doc" jsonb;--> statement-breakpoint
ALTER TABLE "scripts" ADD COLUMN IF NOT EXISTS "doc_html" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "own_account_snapshots_idx" ON "own_account_snapshots" USING btree ("tenant_id","platform","fetched_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_post_metrics_idx" ON "project_post_metrics" USING btree ("project_id","platform","fetched_at");