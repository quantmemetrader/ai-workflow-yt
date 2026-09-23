import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * The creator's own videos, as memory.
 *
 * The studio publishes to a YouTube channel, and everything the assistant
 * writes or cuts should sound like that channel rather than like a model's
 * idea of a video. So every upload on the connected channels is mirrored here
 * through YouTube's own Data API: the title, the description, the tags, the
 * length, what it earned, and the transcript where the platform can honestly
 * give one.
 *
 * Read by the agent through `creator_videos` and `creator_video`, and folded
 * by a model into one "Creator voice" knowledge row that goes in front of
 * every prompt. Nothing here is scraped: the metadata is the Data API's, and
 * a transcript is only stored when the video was cut in this product (its
 * captions are already in the database) or when somebody uploads the master
 * and asks for it.
 */
export const creatorVideos = pgTable(
  "creator_videos",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    /** The `channels` row this came from. */
    channelId: text().notNull(),
    platform: text().notNull().default("youtube"),
    /** The platform's own video id. */
    externalId: text().notNull(),
    title: text().notNull().default(""),
    description: text().notNull().default(""),
    tags: text().array().notNull().default([]),
    durationSec: integer(),
    views: bigint({ mode: "number" }).notNull().default(0),
    likes: integer().notNull().default(0),
    comments: integer().notNull().default(0),
    thumbnailUrl: text(),
    publishedAt: timestamp({ withTimezone: true }),
    /** Where the words came from: `captions` (cut here), `upload`, or null. */
    transcriptSource: text(),
    transcript: text(),
    /** What the video is about and how it opens, in the model's words. */
    notes: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    syncedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("creator_videos_external_idx").on(t.tenantId, t.platform, t.externalId),
    index("creator_videos_views_idx").on(t.tenantId, t.views),
  ],
);
