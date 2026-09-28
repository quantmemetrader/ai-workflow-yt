import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * 复盘 (review): the numbers behind a video once it is out.
 *
 * Both tables keep every reading rather than overwriting one row, so a
 * follower count or a post's likes can be drawn as a line over time; the
 * newest row is "now". Readings come from TikHub (public numbers, billed per
 * call, so they are cached here and read back from here) or were typed in by
 * somebody for a platform TikHub cannot read (`source = 'manual'`).
 */

/** The studio's own accounts (`lib/social/own-accounts.ts`), one row per reading. */
export const ownAccountSnapshots = pgTable(
  "own_account_snapshots",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    /** douyin · xiaohongshu · wechat_channels · bilibili */
    platform: text().notNull(),
    accountId: text().notNull(),
    /** tikhub · manual */
    source: text().notNull().default("tikhub"),
    /** followers, likes, works, views (whatever the platform gives; missing = null). */
    stats: jsonb().$type<Record<string, number | null>>().notNull().default({}),
    /** The latest posts, newest first, already reduced to what the page shows. */
    posts: jsonb().$type<unknown[]>().notNull().default([]),
    /** Why this reading failed, when it did (the row then carries no numbers). */
    error: text(),
    fetchedBy: text(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("own_account_snapshots_idx").on(t.tenantId, t.platform, t.fetchedAt)],
);

/** One published post of a project, one row per reading. */
export const projectPostMetrics = pgTable(
  "project_post_metrics",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    projectId: text().notNull(),
    /** A `PUBLISH_PLATFORMS` key (douyin, xiaohongshu, shipinhao, bilibili, youtube …). */
    platform: text().notNull(),
    url: text(),
    title: text(),
    /** tikhub · manual · account (read off the account's latest posts) · link (added, not read yet) */
    source: text().notNull().default("tikhub"),
    /** plays, likes, comments, shares, collects, completion (0–1) — missing = null. */
    stats: jsonb().$type<Record<string, number | null>>().notNull().default({}),
    error: text(),
    fetchedBy: text(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("project_post_metrics_idx").on(t.projectId, t.platform, t.fetchedAt)],
);
