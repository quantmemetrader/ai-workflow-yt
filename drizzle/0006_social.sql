CREATE TYPE "public"."comment_state" AS ENUM('open', 'replied', 'hidden', 'spam', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."comment_sentiment" AS ENUM('very_negative', 'negative', 'neutral', 'positive', 'very_positive');--> statement-breakpoint
CREATE TABLE "channel_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"external_id" text NOT NULL,
	"zernio_post_id" text,
	"platform" text NOT NULL,
	"title" text,
	"body" text,
	"permalink" text,
	"thumbnail_url" text,
	"is_external" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"external_id" text NOT NULL,
	"platform" text NOT NULL,
	"username" text,
	"display_name" text,
	"avatar_url" text,
	"profile_url" text,
	"platform_user_id" text,
	"followers" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"can_post" boolean DEFAULT false NOT NULL,
	"can_read_analytics" boolean DEFAULT false NOT NULL,
	"needs_reconnect" boolean DEFAULT false NOT NULL,
	"token_expires_at" timestamp with time zone,
	"scopes" text[] DEFAULT '{}' NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"comment_id" text NOT NULL,
	"body" text NOT NULL,
	"model" text,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"edited_by" text,
	"edited_at" timestamp with time zone,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"platform_comment_id" text,
	"error" text,
	"discarded_by" text,
	"discarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"post_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"external_id" text NOT NULL,
	"parent_external_id" text,
	"author_name" text,
	"author_handle" text,
	"author_avatar_url" text,
	"author_external_id" text,
	"body" text DEFAULT '' NOT NULL,
	"translation" text,
	"language" text,
	"like_count" integer DEFAULT 0 NOT NULL,
	"reply_count" integer DEFAULT 0 NOT NULL,
	"permalink" text,
	"sentiment" "comment_sentiment",
	"flagged" boolean DEFAULT false NOT NULL,
	"flag_reason" text,
	"is_lead" boolean DEFAULT false NOT NULL,
	"lead_reason" text,
	"classified_at" timestamp with time zone,
	"state" "comment_state" DEFAULT 'open' NOT NULL,
	"acted_by" text,
	"acted_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"views" integer,
	"impressions" integer,
	"reach" integer,
	"likes" integer,
	"comments" integer,
	"shares" integer,
	"saves" integer,
	"clicks" integer,
	"follows" integer,
	"completion_rate" real,
	"engagement_rate" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_posts" ADD CONSTRAINT "channel_posts_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_drafts" ADD CONSTRAINT "comment_drafts_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_drafts" ADD CONSTRAINT "comment_drafts_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_drafts" ADD CONSTRAINT "comment_drafts_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment_drafts" ADD CONSTRAINT "comment_drafts_discarded_by_users_id_fk" FOREIGN KEY ("discarded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_channel_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."channel_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_acted_by_users_id_fk" FOREIGN KEY ("acted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_post_id_channel_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."channel_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_posts_external_idx" ON "channel_posts" USING btree ("tenant_id","platform","external_id");--> statement-breakpoint
CREATE INDEX "channel_posts_published_idx" ON "channel_posts" USING btree ("tenant_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "channels_external_idx" ON "channels" USING btree ("tenant_id","external_id");--> statement-breakpoint
CREATE INDEX "comment_drafts_comment_idx" ON "comment_drafts" USING btree ("comment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "comments_external_idx" ON "comments" USING btree ("tenant_id","external_id");--> statement-breakpoint
CREATE INDEX "comments_inbox_idx" ON "comments" USING btree ("tenant_id","state","posted_at");--> statement-breakpoint
CREATE INDEX "comments_post_idx" ON "comments" USING btree ("post_id","posted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_metrics_day_idx" ON "post_metrics" USING btree ("post_id","as_of");