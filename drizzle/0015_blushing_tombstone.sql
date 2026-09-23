CREATE TABLE "video_graphics" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"kind" text DEFAULT 'lower-third' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"sub" text,
	"start_ms" integer DEFAULT 0 NOT NULL,
	"end_ms" integer DEFAULT 3000 NOT NULL,
	"ord" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "captions" ADD COLUMN "words" jsonb;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "caption_preset" text DEFAULT 'clean' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_projects" ADD COLUMN "accent" text DEFAULT '#007be0' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_graphics" ADD CONSTRAINT "video_graphics_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_graphics_idx" ON "video_graphics" USING btree ("project_id","start_ms");