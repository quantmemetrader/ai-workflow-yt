CREATE TABLE "competitor_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"competitor_id" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text,
	"permalink" text,
	"thumbnail_url" text,
	"views" bigint,
	"duration_secs" integer,
	"published_at" timestamp with time zone,
	"published_label" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"handle" text,
	"display_name" text,
	"avatar_url" text,
	"subscribers" bigint,
	"note" text,
	"added_by" text,
	"synced_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "competitor_posts" ADD CONSTRAINT "competitor_posts_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "competitor_posts_idx" ON "competitor_posts" USING btree ("competitor_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "competitors_idx" ON "competitors" USING btree ("tenant_id","platform","external_id");