CREATE TABLE "audio_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"project_id" text NOT NULL,
	"kind" text DEFAULT 'music' NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"file_id" text,
	"start_ms" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"gain" real DEFAULT 1 NOT NULL,
	"duck_under_speech" boolean DEFAULT true NOT NULL,
	"text" text,
	"voice_id" text,
	"state" text DEFAULT 'ready' NOT NULL,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_project_id_video_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."video_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_tracks" ADD CONSTRAINT "audio_tracks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_tracks_idx" ON "audio_tracks" USING btree ("project_id","kind");