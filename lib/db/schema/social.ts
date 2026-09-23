import {
  bigint,
  boolean,
  index,
  integer,
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
 * The studio's own channels, what it published, and what people said back.
 *
 * Mirrored from Zernio by a job rather than read through on render: the vendor
 * bills per request and rate-limits per account, and a screen that fetches on
 * render would do both on every keystroke of a filter.
 *
 * Two shapes here exist because the brief insists on them:
 *
 *   — `commentDrafts` is a separate table from the comment. A draft that lived
 *     on the comment row as a nullable column would be one careless update away
 *     from reading as sent, and §4.3 is explicit that a draft must never be
 *     mistakable for something already sent. A draft becomes sent only when it
 *     has an `approvedBy`, an `approvedAt` and a `platformCommentId`.
 *   — `postMetrics` is a time series, not a column on the post. "Views" is a
 *     number that changes; a chart of the last 28 days cannot be drawn from a
 *     field that was overwritten this morning.
 */

/** Platforms we can hold an account on. Kept as text rather than an enum:
 * Zernio adds platforms faster than we can ship a migration, and an unknown
 * platform should appear in the channel list as itself, not as a crash. */
export const channels = pgTable(
  "channels",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    /** Zernio's own account id — the handle every write goes through. */
    externalId: text().notNull(),
    platform: text().notNull(),
    username: text(),
    displayName: text(),
    avatarUrl: text(),
    profileUrl: text(),
    /** The platform's own id for the account, which is what TikHub needs in
     * order to read the same channel from the outside. */
    platformUserId: text(),
    followers: integer().notNull().default(0),

    /** Connection state, straight from `/accounts/health`. The channel board
     * shows this; nobody has to guess why a publish failed. */
    status: text().notNull().default("unknown"),
    canPost: boolean().notNull().default(false),
    canReadAnalytics: boolean().notNull().default(false),
    needsReconnect: boolean().notNull().default(false),
    tokenExpiresAt: timestamp({ withTimezone: true }),
    /** The OAuth scopes actually granted, so the Admin screen can say what a
     * connection may do rather than what we hope it may do (spec §4.11). */
    scopes: text().array().notNull().default([]),
    issues: jsonb().$type<string[]>().notNull().default([]),

    enabled: boolean().notNull().default(true),
    syncedAt: timestamp({ withTimezone: true }),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("channels_external_idx").on(t.tenantId, t.externalId)],
);

/**
 * Something published on a channel.
 *
 * `externalId` is the platform's id (a YouTube video id, say) because that is
 * the key both vendors agree on: Zernio's inbox groups comments by it, and
 * TikHub reads the same video by it.
 */
export const channelPosts = pgTable(
  "channel_posts",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    channelId: text()
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    externalId: text().notNull(),
    /** Zernio's own post id, when the post went out through us. Null for the
     * ones already on the channel before the studio connected it. */
    zernioPostId: text(),
    platform: text().notNull(),
    title: text(),
    body: text(),
    permalink: text(),
    thumbnailUrl: text(),
    /** True when the post predates us, so Content performance can say which
     * numbers we are responsible for. */
    isExternal: boolean().notNull().default(false),
    /**
     * Where the platform actually got to with it.
     *
     * Read off Zernio's response and then thrown away, which is how a post
     * scheduled for next Tuesday came to sort to the top of Content
     * performance as though it had gone out (REVIEW.md #8). Text rather than
     * an enum: Zernio adds states faster than we ship migrations, and an
     * unknown one should show as itself rather than crash a sync.
     */
    status: text().notNull().default("published"),
    /** Set only when the platform has actually taken it. */
    publishedAt: timestamp({ withTimezone: true }),
    /** When it is due to go out, for the ones that have not yet. */
    scheduledFor: timestamp({ withTimezone: true }),
    commentCount: integer().notNull().default(0),
    syncedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("channel_posts_external_idx").on(t.tenantId, t.platform, t.externalId),
    index("channel_posts_published_idx").on(t.tenantId, t.publishedAt),
  ],
);

/**
 * One reading of a post's numbers.
 *
 * Kept per day (`asOf` is a date, and the unique index makes a day idempotent)
 * so a sync that runs twice does not double a chart, and so "last 28 days" is
 * a range scan rather than an arithmetic guess.
 */
export const postMetrics = pgTable(
  "post_metrics",
  {
    id: text().primaryKey(),
    postId: text()
      .notNull()
      .references(() => channelPosts.id, { onDelete: "cascade" }),
    asOf: timestamp({ withTimezone: true }).notNull(),
    /**
     * Cumulative totals as of this day, which is what `/analytics` reports.
     * "Views" on a post means every view it has ever had.
     */
    views: integer(),
    /**
     * Views gained *on* this day, from YouTube Analytics through Zernio.
     *
     * A separate column rather than a different row shape, because the two are
     * genuinely different quantities and summing the wrong one is the kind of
     * mistake that makes a chart confidently wrong: a cumulative total summed
     * across a window counts every view once per day it was already held.
     * The daily-views chart sums this one; the table shows the one above.
     */
    viewsDay: integer(),
    minutesWatchedDay: integer(),
    subscribersGainedDay: integer(),
    impressions: integer(),
    reach: integer(),
    likes: integer(),
    comments: integer(),
    shares: integer(),
    saves: integer(),
    clicks: integer(),
    follows: integer(),
    /** Fractions in 0..1. Absent means the platform does not report it, which
     * is not the same as zero — hence nullable all the way to the screen. */
    completionRate: real(),
    engagementRate: real(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("post_metrics_day_idx").on(t.postId, t.asOf),
    /*
     * The daily-views chart reads this table by date across every post, and
     * `(post_id, as_of)` cannot serve that — the leading column is wrong, so
     * the planner sequentially scans the whole table on every load of Content
     * performance. Five thousand rows today; one reading per post per day
     * makes it a million inside two years.
     */
    index("post_metrics_as_of_idx").on(t.asOf),
  ],
);

export const sentimentEnum = pgEnum("comment_sentiment", [
  "very_negative",
  "negative",
  "neutral",
  "positive",
  "very_positive",
]);

export const commentStateEnum = pgEnum("comment_state", ["open", "replied", "hidden", "spam", "ignored"]);

/**
 * A comment on one of our posts.
 *
 * The classification fields (`sentiment`, `language`, `flagged`, `isLead`) are
 * written once by a job and read many times, rather than computed on render —
 * the inbox filters on them, and a filter that costs a model call per comment
 * per keystroke is not a filter.
 */
export const comments = pgTable(
  "comments",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    postId: text()
      .notNull()
      .references(() => channelPosts.id, { onDelete: "cascade" }),
    channelId: text()
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    /** The platform's comment id — what a reply, a hide or a spam report is
     * addressed to. */
    externalId: text().notNull(),
    parentExternalId: text(),

    authorName: text(),
    authorHandle: text(),
    authorAvatarUrl: text(),
    /** Author ids are personal data under the HK PDPO, which the screen says
     * out loud. Kept because it is the only way to recognise a repeat
     * commenter, and nothing else. */
    authorExternalId: text(),

    body: text().notNull().default(""),
    /** Machine translation, shown beneath the original and labelled as such —
     * never in place of it. */
    translation: text(),
    language: text(),

    likeCount: integer().notNull().default(0),
    replyCount: integer().notNull().default(0),
    permalink: text(),

    sentiment: sentimentEnum(),
    /** Sensitive or abusive content carries a flag *and* a reason, the same
     * rule the Trends dashboard follows. */
    flagged: boolean().notNull().default(false),
    flagReason: text(),
    /** A business enquiry. The brief calls these out separately because they
     * are the ones worth money. */
    isLead: boolean().notNull().default(false),
    leadReason: text(),
    classifiedAt: timestamp({ withTimezone: true }),

    state: commentStateEnum().notNull().default("open"),
    /** Who acted, when a person did. Hiding someone's comment is an action
     * with a name on it. */
    actedBy: text().references(() => users.id),
    actedAt: timestamp({ withTimezone: true }),

    postedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("comments_external_idx").on(t.tenantId, t.externalId),
    index("comments_inbox_idx").on(t.tenantId, t.state, t.postedAt),
    index("comments_post_idx").on(t.postId, t.postedAt),
  ],
);

/**
 * A suggested reply, and its approval.
 *
 * Separate table, on purpose (see the note at the top of this file). The
 * lifecycle is one-way: drafted → approved → sent, or drafted → discarded.
 * A row with `sentAt` set is the *only* thing that means a reply exists on the
 * platform, and it can only be set by the action that got a `platformCommentId`
 * back from Zernio.
 */
export const commentDrafts = pgTable(
  "comment_drafts",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    commentId: text()
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    body: text().notNull(),
    /** Which model wrote it, and what it cost — the same accounting every
     * other model call gets (spec §5). */
    model: text(),
    costMicros: bigint({ mode: "number" }).notNull().default(0),
    /** Edited by a person before approval, so the screen can say so. */
    editedBy: text().references(() => users.id),
    editedAt: timestamp({ withTimezone: true }),

    approvedBy: text().references(() => users.id),
    approvedAt: timestamp({ withTimezone: true }),
    sentAt: timestamp({ withTimezone: true }),
    platformCommentId: text(),
    error: text(),

    discardedBy: text().references(() => users.id),
    discardedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("comment_drafts_comment_idx").on(t.commentId, t.createdAt)],
);


/**
 * Somebody else's channel, watched from the outside.
 *
 * This is what the TikHub key is for, and until now nothing used it: Zernio
 * can only ever see the accounts the studio owns, so "how are we doing against
 * them" had no source at all and the Trends dashboard had no competitor rows
 * (REVIEW.md, last item).
 *
 * Public figures only. TikHub reads what the platform publishes to anybody
 * with a browser; there is no login, no scrape and nothing here that is not on
 * the channel's own page.
 */
export const competitors = pgTable(
  "competitors",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    platform: text().notNull(),
    /** The platform's own id for the channel, which is what TikHub takes. */
    externalId: text().notNull(),
    handle: text(),
    displayName: text(),
    avatarUrl: text(),
    subscribers: bigint({ mode: "number" }),
    note: text(),
    addedBy: text().references(() => users.id),
    syncedAt: timestamp({ withTimezone: true }),
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("competitors_idx").on(t.tenantId, t.platform, t.externalId)],
);

/**
 * What they published, as the platform reports it.
 *
 * `views` is a single reading rather than a series: TikHub gives the count as
 * it stands, and inventing a history from repeated readings of somebody else's
 * channel is a different and much larger thing than this screen needs.
 */
export const competitorPosts = pgTable(
  "competitor_posts",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    competitorId: text()
      .notNull()
      .references(() => competitors.id, { onDelete: "cascade" }),
    externalId: text().notNull(),
    title: text(),
    permalink: text(),
    thumbnailUrl: text(),
    views: bigint({ mode: "number" }),
    durationSecs: integer(),
    publishedAt: timestamp({ withTimezone: true }),
    /** What the platform said the age was, when it gave no date. */
    publishedLabel: text(),
    syncedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("competitor_posts_idx").on(t.competitorId, t.externalId)],
);
