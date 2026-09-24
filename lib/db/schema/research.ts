import {
  boolean,
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./core";

/**
 * Market Research (spec §4.3).
 *
 * Two rules from the brief shape these tables:
 *   — every chart states its date range *and its source*, so a series carries
 *     the source it came from rather than being an anonymous number;
 *   — adopt and reject feed back into ranking, so choices are events we keep,
 *     not a status field we overwrite.
 */

/** Where a number came from. The sidebar's "Connected sources" list is this
 * table, and its status dots are the last fetch's outcome — not decoration. */
export const sourceKindEnum = pgEnum("source_kind", ["news", "signal", "platform"]);
export const sourceStatusEnum = pgEnum("source_status", ["live", "degraded", "unconfigured"]);

export const researchSources = pgTable("research_sources", {
  key: text().primaryKey(),
  name: text().notNull(),
  kind: sourceKindEnum().notNull(),
  status: sourceStatusEnum().notNull().default("unconfigured"),
  /** What a person needs to know when the dot is not green. */
  note: text(),
  homepage: text(),
  lastOkAt: timestamp({ withTimezone: true }),
  lastError: text(),
});

export const topicStatusEnum = pgEnum("topic_status", ["new", "adopted", "rejected", "saved"]);

/**
 * Where an adopted topic has got to. The backlog board is four lanes and had
 * nothing behind them — every adopted topic sat in the first one for ever,
 * which made the board a picture of a board.
 *
 * The last two lanes are owned by Script: once a brief becomes a draft, the
 * stage follows the script rather than being set by hand here. Until Script is
 * built, a producer can still move a card, which is how they track the work
 * they are doing in the meantime.
 */
export const topicStageEnum = pgEnum("topic_stage", ["adopted", "briefing", "scripting", "handed"]);

export const topics = pgTable(
  "topics",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    /** The phrase actually queried against the sources. */
    query: text().notNull(),
    name: text().notNull(),
    nameLocal: text(),
    category: text(),
    region: text().notNull().default("HK"),
    summary: text(),
    angles: jsonb().$type<string[]>().notNull().default([]),
    /** Sensitive topics carry a flag *and a reason* — the reason is what makes
     * the flag actionable (brief, Trends dashboard). */
    flagged: boolean().notNull().default(false),
    flagReason: text(),

    /** Computed from the cached series: recent volume, and the change against
     * the previous window. Stored so a list can be ranked in one query. */
    heat: real().notNull().default(0),
    change14d: real().notNull().default(0),
    rising: boolean().notNull().default(false),
    sourceKeys: text().array().notNull().default([]),

    status: topicStatusEnum().notNull().default("new"),
    stage: topicStageEnum().notNull().default("adopted"),
    ownerId: text().references(() => users.id),
    targetChannel: text(),
    dueDate: date(),

    lastFetchedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("topics_rank_idx").on(t.tenantId, t.status, t.heat),
    uniqueIndex("topics_query_idx").on(t.tenantId, t.query, t.region),
  ],
);

/**
 * Cached time series, keyed by the exact query and window.
 *
 * GDELT asks for one request every five seconds, so a page must never fetch on
 * render. Everything is served from here and refreshed by a job; `fetchedAt`
 * is what the screen shows when it says how fresh a chart is.
 */
export const seriesCache = pgTable(
  "series_cache",
  {
    id: text().primaryKey(),
    /** Which source this round's numbers came from. An *attribute* of the
     * series, not part of its key: a chart falls back from GDELT to Hacker
     * News to article counts between rounds, and a key that included the
     * source would leave a stale row behind at every fallback for readers to
     * pick from at random. */
    sourceKey: text().notNull(),
    query: text().notNull(),
    window: text().notNull(),
    /** [{ d: "2026-09-01", v: 12.4 }, …] — small enough to keep inline. */
    points: jsonb().$type<{ d: string; v: number }[]>().notNull().default([]),
    /** Primary sources behind the numbers, for "links to primary sources". */
    articles: jsonb()
      .$type<{ title: string; url: string; domain: string; at: string }[]>()
      .notNull()
      .default([]),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    error: text(),
  },
  (t) => [uniqueIndex("series_cache_idx").on(t.query, t.window)],
);

/**
 * Every hot list as it was fetched, kept.
 *
 * Reading a platform takes seconds and TikHub bills per request, so pages
 * never call out: `scripts/collect-hot.ts` reads each list on the hour and
 * stores it here, and the Research page and the morning brief read the
 * newest row. Kept rows are also the history a rising topic is measured
 * against.
 */
export const hotSnapshots = pgTable(
  "hot_snapshots",
  {
    id: text().primaryKey(),
    platform: text().notNull(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    rows: jsonb().$type<unknown[]>().notNull().default([]),
    note: text(),
  },
  (t) => [index("hot_snapshots_platform_idx").on(t.platform, t.fetchedAt)],
);

export const topicActionEnum = pgEnum("topic_action", ["adopt", "reject", "save", "unsave"]);

/** Every adopt and reject, kept. The dashboard tells people their choices
 * train the ranking; this is the training data, and the count it shows.
 *
 * `topicId` therefore goes null when a topic stops being watched rather than
 * taking the event with it: `category` is already carried here, so the weights
 * survive the topic they were learned from. */
export const topicEvents = pgTable(
  "topic_events",
  {
    id: text().primaryKey(),
    topicId: text().references(() => topics.id, { onDelete: "set null" }),
    userId: text().notNull().references(() => users.id),
    action: topicActionEnum().notNull(),
    category: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("topic_events_idx").on(t.userId, t.at)],
);

/** A saved comparison, exported to the file store as a research report. */
export const comparisons = pgTable("comparisons", {
  id: text().primaryKey(),
  tenantId: text().notNull(),
  userId: text().notNull().references(() => users.id),
  queries: text().array().notNull(),
  window: text().notNull().default("3m"),
  region: text().notNull().default("HK"),
  fileId: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
