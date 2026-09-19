CREATE TYPE "public"."source_kind" AS ENUM('news', 'signal', 'platform');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('live', 'degraded', 'unconfigured');--> statement-breakpoint
CREATE TYPE "public"."topic_action" AS ENUM('adopt', 'reject', 'save', 'unsave');--> statement-breakpoint
CREATE TYPE "public"."topic_status" AS ENUM('new', 'adopted', 'rejected', 'saved');--> statement-breakpoint
CREATE TABLE "comparisons" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"queries" text[] NOT NULL,
	"window" text DEFAULT '3m' NOT NULL,
	"region" text DEFAULT 'HK' NOT NULL,
	"file_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_sources" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"status" "source_status" DEFAULT 'unconfigured' NOT NULL,
	"note" text,
	"homepage" text,
	"last_ok_at" timestamp with time zone,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "series_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"query" text NOT NULL,
	"window" text NOT NULL,
	"points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"articles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "topic_events" (
	"id" text PRIMARY KEY NOT NULL,
	"topic_id" text NOT NULL,
	"user_id" text NOT NULL,
	"action" "topic_action" NOT NULL,
	"category" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"query" text NOT NULL,
	"name" text NOT NULL,
	"name_local" text,
	"category" text,
	"region" text DEFAULT 'HK' NOT NULL,
	"summary" text,
	"angles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"heat" real DEFAULT 0 NOT NULL,
	"change14d" real DEFAULT 0 NOT NULL,
	"rising" boolean DEFAULT false NOT NULL,
	"source_keys" text[] DEFAULT '{}' NOT NULL,
	"status" "topic_status" DEFAULT 'new' NOT NULL,
	"owner_id" text,
	"target_channel" text,
	"due_date" date,
	"last_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comparisons" ADD CONSTRAINT "comparisons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_events" ADD CONSTRAINT "topic_events_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_events" ADD CONSTRAINT "topic_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "series_cache_idx" ON "series_cache" USING btree ("source_key","query","window");--> statement-breakpoint
CREATE INDEX "topic_events_idx" ON "topic_events" USING btree ("user_id","at");--> statement-breakpoint
CREATE INDEX "topics_rank_idx" ON "topics" USING btree ("tenant_id","status","heat");--> statement-breakpoint
CREATE UNIQUE INDEX "topics_query_idx" ON "topics" USING btree ("tenant_id","query","region");