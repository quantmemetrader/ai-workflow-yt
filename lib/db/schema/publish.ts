import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./core";
import { channels } from "./social";

/**
 * Publish (spec §4.6).
 *
 * The module's promise, in the artboard's own words: **nothing leaves the
 * platform without an approval record.** Three shapes here exist to keep it:
 *
 *   1. **Approval is the generic `approvals` table** from `script.ts`, not a
 *      column here. A script and a post make the same promise, and an
 *      approval that lives in two shapes means two things.
 *   2. **A post and its channel versions are separate rows.** The composer's
 *      master text is the post; each channel's overrides are a target. That
 *      is also why a partial failure is representable: YouTube can succeed
 *      while LinkedIn refuses, and the screen has to say exactly that.
 *   3. **The log is append-only.** Every attempt against a platform is a row
 *      with the platform's own response kept intact, so "retry" is safe to
 *      offer and "it failed" is never the whole story a person gets.
 */

export const publishStateEnum = pgEnum("publish_state", [
  "draft",
  "awaiting_approval",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "cancelled",
]);

/**
 * One piece of work going out: a master caption plus the channels it is for.
 *
 * `fileId` points at the export in the media database. Null while a post is
 * being written against a video that Video Edit has not finished, which is
 * the artboard's "Not ready yet · Still in Video Edit" state.
 */
export const publishPosts = pgTable(
  "publish_posts",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    /** The script this came from, when it came from one. */
    scriptId: text(),
    /** The export in the file store that is actually being posted. */
    fileId: text(),
    title: text().notNull(),
    /** The master caption. A channel that overrides nothing uses this. */
    body: text().notNull().default(""),
    tags: text().array().notNull().default([]),

    state: publishStateEnum().notNull().default("draft"),
    /** When the studio wants it live. Null means "as soon as it is approved". */
    scheduledFor: timestamp({ withTimezone: true }),

    ownerId: text().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("publish_posts_state_idx").on(t.tenantId, t.state, t.scheduledFor)],
);

/**
 * One channel's version of a post.
 *
 * Every text field is nullable and means "follow the master". That is exactly
 * what the composer says on screen ("Anything you leave alone follows
 * Master"), and storing an override as a copy of the master would make
 * "Reset to Master" impossible to tell from "happens to match".
 */
export const publishTargets = pgTable(
  "publish_targets",
  {
    id: text().primaryKey(),
    postId: text()
      .notNull()
      .references(() => publishPosts.id, { onDelete: "cascade" }),
    channelId: text()
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),

    /** Overrides. Null follows the master. */
    title: text(),
    body: text(),
    tags: text().array(),
    /** Per-platform extras the composer collects: YouTube category, Instagram
     * first comment, LinkedIn visibility. Shapeless on purpose, because each
     * platform's extras are its own. */
    options: jsonb().$type<Record<string, unknown>>().notNull().default({}),

    state: publishStateEnum().notNull().default("draft"),
    /** What the platform said, kept intact (spec §6). */
    platformPostId: text(),
    platformUrl: text(),
    error: text(),
    attempts: integer().notNull().default(0),
    publishedAt: timestamp({ withTimezone: true }),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("publish_targets_idx").on(t.postId, t.channelId)],
);

/**
 * Every attempt, kept.
 *
 * Append-only. The publish log screen is this table, and "retry" is safe to
 * offer because each attempt carries the idempotency key it used: a retry
 * that the platform already accepted comes back as the same post rather than
 * a second one.
 */
export const publishLog = pgTable(
  "publish_log",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    targetId: text()
      .notNull()
      .references(() => publishTargets.id, { onDelete: "cascade" }),
    attempt: integer().notNull().default(1),
    idempotencyKey: text().notNull(),
    state: publishStateEnum().notNull(),
    /** The provider's raw response, truncated but not summarised. */
    response: jsonb(),
    error: text(),
    /** Who or what caused this attempt: a person's id, or the scheduler. */
    actorId: text().references(() => users.id),
    durationMs: integer(),
    costMicros: bigint({ mode: "number" }).notNull().default(0),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("publish_log_idx").on(t.targetId, t.at)],
);
