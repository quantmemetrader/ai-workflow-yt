ALTER TABLE "video_graphics" ADD COLUMN "file_id" text;--> statement-breakpoint
ALTER TABLE "video_graphics" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "video_graphics" ADD COLUMN "placement" text DEFAULT 'center' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_graphics" ADD COLUMN "scale" integer DEFAULT 30 NOT NULL;