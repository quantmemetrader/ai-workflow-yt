ALTER TABLE "script_comments" ADD COLUMN IF NOT EXISTS "parent_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "script_comments" ADD CONSTRAINT "script_comments_parent_id_script_comments_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."script_comments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "script_comments_parent_idx" ON "script_comments" ("parent_id");
