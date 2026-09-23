CREATE TYPE "public"."article_status" AS ENUM('draft', 'in_review', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "article_publications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"article_id" text NOT NULL,
	"version_no" integer,
	"checksum" text,
	"kind" text DEFAULT 'other' NOT NULL,
	"destination" text NOT NULL,
	"url" text,
	"note" text,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_by" text,
	"retracted_at" timestamp with time zone,
	"retracted_by" text,
	"retracted_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"version_no" integer NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"body" text DEFAULT '' NOT NULL,
	"checksum" text NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"note" text,
	"author_id" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"script_id" text,
	"topic_id" text,
	"title" text NOT NULL,
	"title_local" text,
	"status" "article_status" DEFAULT 'draft' NOT NULL,
	"angle" text,
	"summary" text,
	"body" text DEFAULT '' NOT NULL,
	"language" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"source_file_ids" text[] DEFAULT '{}' NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"locked_version" integer,
	"published_at" timestamp with time zone,
	"owner_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "article_publications" ADD CONSTRAINT "article_publications_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_publications" ADD CONSTRAINT "article_publications_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_publications" ADD CONSTRAINT "article_publications_retracted_by_users_id_fk" FOREIGN KEY ("retracted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_versions" ADD CONSTRAINT "article_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_publications_tenant_idx" ON "article_publications" USING btree ("tenant_id","published_at");--> statement-breakpoint
CREATE INDEX "article_publications_article_idx" ON "article_publications" USING btree ("article_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "article_versions_no_idx" ON "article_versions" USING btree ("article_id","version_no");--> statement-breakpoint
CREATE INDEX "articles_tenant_idx" ON "articles" USING btree ("tenant_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "articles_script_idx" ON "articles" USING btree ("script_id");