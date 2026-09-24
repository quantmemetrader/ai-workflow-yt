ALTER TABLE "captions" ALTER COLUMN "language" SET DEFAULT 'zh-CN';--> statement-breakpoint
ALTER TABLE "video_exports" ALTER COLUMN "caption_language" SET DEFAULT 'zh-CN';
--> statement-breakpoint
-- The studio publishes in Simplified Chinese only. zh-HK was the default for
-- every caption track, every export and the director's own language field,
-- which is how Whisper's Traditional output kept being labelled correct. The
-- tracks themselves are rewritten by scripts/simplify-existing.ts; this is the
-- label. `locale` on users keeps the enum value, because dropping a value from
-- a Postgres enum needs a rewrite and nothing offers it any more.
UPDATE "captions" SET "language" = 'zh-CN' WHERE "language" = 'zh-HK';--> statement-breakpoint
UPDATE "video_exports" SET "caption_language" = 'zh-CN' WHERE "caption_language" = 'zh-HK';--> statement-breakpoint
UPDATE "video_projects" SET "director" = jsonb_set("director", '{language}', '"zh-CN"')
  WHERE "director" ? 'language' AND "director"->>'language' = 'zh-HK';--> statement-breakpoint
UPDATE "users" SET "locale" = 'zh-CN' WHERE "locale" = 'zh-HK';
