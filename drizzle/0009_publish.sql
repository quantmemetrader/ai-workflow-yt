CREATE TYPE "public"."publish_state" AS ENUM('draft', 'awaiting_approval', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "publish_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"target_id" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" "publish_state" NOT NULL,
	"response" jsonb,
	"error" text,
	"actor_id" text,
	"duration_ms" integer,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"script_id" text,
	"file_id" text,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"state" "publish_state" DEFAULT 'draft' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"owner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "publish_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"title" text,
	"body" text,
	"tags" text[],
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" "publish_state" DEFAULT 'draft' NOT NULL,
	"platform_post_id" text,
	"platform_url" text,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "publish_log" ADD CONSTRAINT "publish_log_target_id_publish_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."publish_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_log" ADD CONSTRAINT "publish_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_posts" ADD CONSTRAINT "publish_posts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_targets" ADD CONSTRAINT "publish_targets_post_id_publish_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."publish_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_targets" ADD CONSTRAINT "publish_targets_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "publish_log_idx" ON "publish_log" USING btree ("target_id","at");--> statement-breakpoint
CREATE INDEX "publish_posts_state_idx" ON "publish_posts" USING btree ("tenant_id","state","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "publish_targets_idx" ON "publish_targets" USING btree ("post_id","channel_id");