import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { channelPosts, channels, commentDrafts, comments, postMetrics } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";

/**
 * What the Content performance and Comment inbox screens read.
 *
 * Every query is scoped to the viewer's tenant. Channels are a tenant-wide
 * resource rather than a per-file one — everybody with the `research` module
 * sees the studio's own numbers, which is what the brief describes — but the
 * tenant boundary is still in the SQL, not in the caller, because that is the
 * boundary a mistake here would cross.
 */

export type Window = "7d" | "28d" | "90d";

/** Spec §4.3: content performance defaults to the last 28 days. */
export const DEFAULT_WINDOW: Window = "28d";

const DAYS: Record<Window, number> = { "7d": 7, "28d": 28, "90d": 90 };

export function windowStart(w: Window): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (DAYS[w] - 1));
  return d;
}

// ------------------------------------------------------------- channels

export type ChannelRow = {
  id: string;
  platform: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  followers: number;
  status: string;
  canPost: boolean;
  canReadAnalytics: boolean;
  needsReconnect: boolean;
  tokenExpiresAt: Date | null;
  scopes: string[];
  issues: string[];
  syncedAt: Date | null;
  lastError: string | null;
};

export async function listChannels(viewer: Viewer): Promise<ChannelRow[]> {
  return db
    .select({
      id: channels.id,
      platform: channels.platform,
      username: channels.username,
      displayName: channels.displayName,
      avatarUrl: channels.avatarUrl,
      profileUrl: channels.profileUrl,
      followers: channels.followers,
      status: channels.status,
      canPost: channels.canPost,
      canReadAnalytics: channels.canReadAnalytics,
      needsReconnect: channels.needsReconnect,
      tokenExpiresAt: channels.tokenExpiresAt,
      scopes: channels.scopes,
      issues: channels.issues,
      syncedAt: channels.syncedAt,
      lastError: channels.lastError,
    })
    .from(channels)
    .where(and(eq(channels.tenantId, viewer.tenantId), eq(channels.enabled, true)))
    .orderBy(desc(channels.followers));
}

// -------------------------------------------------- content performance

export type PerformanceRow = {
  id: string;
  platform: string;
  channelName: string | null;
  title: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  publishedAt: Date | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  /** 0..1, or null when the platform does not report it. */
  completionRate: number | null;
  engagementRate: number | null;
};

/**
 * The post table, with each post's most recent reading of its numbers.
 *
 * `distinct on` is the point: `post_metrics` holds one row per post per day,
 * and what the table wants is the newest one per post. Doing that in SQL is
 * one query; doing it in TypeScript is one query per post.
 */
export async function performance(
  viewer: Viewer,
  opts: { window?: Window; platform?: string } = {},
): Promise<PerformanceRow[]> {
  const since = windowStart(opts.window ?? DEFAULT_WINDOW);

  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select p.id,
           p.platform,
           c.display_name as channel_name,
           p.title,
           p.permalink,
           p.thumbnail_url,
           p.published_at,
           m.views, m.likes, m.comments, m.shares,
           w.completion_rate, m.engagement_rate
      from channel_posts p
      join channels c on c.id = p.channel_id
      -- The newest row that actually carries cumulative totals. Rows written
      -- by the daily-views backfill hold per-day figures and leave the
      -- cumulative columns null, so "the newest row" on its own would hand the
      -- table a row of blanks.
      left join lateral (
        select * from post_metrics pm
         where pm.post_id = p.id and pm.views is not null
         order by pm.as_of desc
         limit 1
      ) m on true
      -- Watch-through is measured per day, so the post's figure is the average
      -- across days *weighted by that day's views*. The unweighted version
      -- read 104% for a video whose only reading came from a day with one
      -- viewer who looped it; weighting puts that day in proportion.
      left join lateral (
        select sum(pm.completion_rate * pm.views_day) / nullif(sum(pm.views_day), 0) as completion_rate
          from post_metrics pm
         where pm.post_id = p.id
           and pm.completion_rate is not null
           and pm.views_day > 0
      ) w on true
     where p.tenant_id = ${viewer.tenantId}
       and p.published_at >= ${since}
       ${opts.platform ? sql`and p.platform = ${opts.platform}` : sql``}
     order by m.views desc nulls last, p.published_at desc
     limit 200
  `);

  return rows.map((r) => ({
    id: String(r.id),
    platform: String(r.platform),
    channelName: (r.channel_name as string | null) ?? null,
    title: (r.title as string | null) ?? null,
    permalink: (r.permalink as string | null) ?? null,
    thumbnailUrl: (r.thumbnail_url as string | null) ?? null,
    publishedAt: r.published_at ? new Date(String(r.published_at)) : null,
    views: numOrNull(r.views),
    likes: numOrNull(r.likes),
    comments: numOrNull(r.comments),
    shares: numOrNull(r.shares),
    completionRate: numOrNull(r.completion_rate),
    engagementRate: numOrNull(r.engagement_rate),
  }));
}

/**
 * Views gained per day across the window, summed over every post.
 *
 * `views_day`, not `views`: the latter is a running total, and summing running
 * totals across a window counts every view once for every day the post has
 * existed. Days with no reading at all are left out rather than drawn as
 * zero, so a gap reads as "not measured" instead of "nobody watched".
 */
export async function viewsSeries(
  viewer: Viewer,
  opts: { window?: Window; platform?: string } = {},
): Promise<{ d: string; v: number }[]> {
  const since = windowStart(opts.window ?? DEFAULT_WINDOW);

  const { rows } = await db.execute<{ d: string; v: string | number }>(sql`
    select to_char(m.as_of, 'YYYY-MM-DD') as d, sum(m.views_day)::bigint as v
      from post_metrics m
      join channel_posts p on p.id = m.post_id
     where p.tenant_id = ${viewer.tenantId}
       and m.as_of >= ${since}
       and m.views_day is not null
       ${opts.platform ? sql`and p.platform = ${opts.platform}` : sql``}
     group by 1
     order by 1 asc
  `);

  return rows.map((r) => ({ d: r.d, v: Number(r.v) }));
}

/** Headline numbers for the window, and how many posts they cover. */
export async function performanceTotals(viewer: Viewer, opts: { window?: Window; platform?: string } = {}) {
  const rows = await performance(viewer, opts);
  const sum = (pick: (r: PerformanceRow) => number | null) =>
    rows.reduce((t, r) => t + (pick(r) ?? 0), 0);

  const withEngagement = rows.filter((r) => r.engagementRate !== null);

  return {
    posts: rows.length,
    views: sum((r) => r.views),
    likes: sum((r) => r.likes),
    comments: sum((r) => r.comments),
    /** Averaged over the posts that actually report it, so one platform's
     * silence does not drag the number to zero. */
    engagementRate: withEngagement.length
      ? withEngagement.reduce((t, r) => t + (r.engagementRate ?? 0), 0) / withEngagement.length
      : null,
  };
}

// -------------------------------------------------------- comment inbox

export type InboxFilters = {
  sentiment?: string;
  language?: string;
  flagged?: boolean;
  leads?: boolean;
  state?: "open" | "replied" | "hidden" | "spam";
};

export type InboxComment = {
  id: string;
  postId: string;
  externalId: string;
  authorName: string | null;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  body: string;
  translation: string | null;
  language: string | null;
  sentiment: string | null;
  flagged: boolean;
  flagReason: string | null;
  isLead: boolean;
  leadReason: string | null;
  state: string;
  likeCount: number;
  postedAt: Date | null;
  permalink: string | null;
  platform: string;
  /** The current draft, if one is waiting. Never includes a sent one —
   * a sent reply is not a draft and must not render as one. */
  draft: { id: string; body: string; model: string | null; editedAt: Date | null } | null;
};

export type InboxGroup = {
  postId: string;
  title: string | null;
  platform: string;
  thumbnailUrl: string | null;
  permalink: string | null;
  comments: InboxComment[];
};

/**
 * The inbox, grouped by video (spec §4.3).
 *
 * Grouping happens here rather than in SQL because the screen needs the posts
 * in comment-recency order and the comments inside each post in their own
 * order — two orderings of one list, which is a shape SQL returns awkwardly
 * and TypeScript returns plainly.
 */
export async function inbox(viewer: Viewer, filters: InboxFilters = {}): Promise<InboxGroup[]> {
  const where = [eq(comments.tenantId, viewer.tenantId)];

  where.push(eq(comments.state, filters.state ?? "open"));
  if (filters.sentiment) where.push(eq(comments.sentiment, filters.sentiment as never));
  if (filters.language) where.push(eq(comments.language, filters.language));
  if (filters.flagged) where.push(eq(comments.flagged, true));
  if (filters.leads) where.push(eq(comments.isLead, true));

  const rows = await db
    .select({
      id: comments.id,
      postId: comments.postId,
      externalId: comments.externalId,
      authorName: comments.authorName,
      authorHandle: comments.authorHandle,
      authorAvatarUrl: comments.authorAvatarUrl,
      body: comments.body,
      translation: comments.translation,
      language: comments.language,
      sentiment: comments.sentiment,
      flagged: comments.flagged,
      flagReason: comments.flagReason,
      isLead: comments.isLead,
      leadReason: comments.leadReason,
      state: comments.state,
      likeCount: comments.likeCount,
      postedAt: comments.postedAt,
      permalink: comments.permalink,
      platform: channelPosts.platform,
      title: channelPosts.title,
      thumbnailUrl: channelPosts.thumbnailUrl,
      postPermalink: channelPosts.permalink,
    })
    .from(comments)
    .innerJoin(channelPosts, eq(channelPosts.id, comments.postId))
    .where(and(...where))
    .orderBy(desc(comments.postedAt))
    .limit(300);

  if (!rows.length) return [];

  // The waiting drafts, in one query. A draft that has been sent, approved or
  // discarded is not one of them.
  const drafts = await db
    .select({
      id: commentDrafts.id,
      commentId: commentDrafts.commentId,
      body: commentDrafts.body,
      model: commentDrafts.model,
      editedAt: commentDrafts.editedAt,
      createdAt: commentDrafts.createdAt,
    })
    .from(commentDrafts)
    .where(
      and(
        inArray(commentDrafts.commentId, rows.map((r) => r.id)),
        isNull(commentDrafts.sentAt),
        isNull(commentDrafts.discardedAt),
      ),
    )
    .orderBy(asc(commentDrafts.createdAt));

  const draftByComment = new Map<string, (typeof drafts)[number]>();
  for (const d of drafts) draftByComment.set(d.commentId, d); // last wins: newest draft

  const groups = new Map<string, InboxGroup>();
  for (const r of rows) {
    let g = groups.get(r.postId);
    if (!g) {
      g = {
        postId: r.postId,
        title: r.title,
        platform: r.platform,
        thumbnailUrl: r.thumbnailUrl,
        permalink: r.postPermalink,
        comments: [],
      };
      groups.set(r.postId, g);
    }
    const d = draftByComment.get(r.id);
    g.comments.push({
      id: r.id,
      postId: r.postId,
      externalId: r.externalId,
      authorName: r.authorName,
      authorHandle: r.authorHandle,
      authorAvatarUrl: r.authorAvatarUrl,
      body: r.body,
      translation: r.translation,
      language: r.language,
      sentiment: r.sentiment,
      flagged: r.flagged,
      flagReason: r.flagReason,
      isLead: r.isLead,
      leadReason: r.leadReason,
      state: r.state,
      likeCount: r.likeCount,
      postedAt: r.postedAt,
      permalink: r.permalink,
      platform: r.platform,
      draft: d ? { id: d.id, body: d.body, model: d.model, editedAt: d.editedAt } : null,
    });
  }

  return [...groups.values()];
}

/** The two distributions the inbox draws above the list. */
export async function inboxSummary(viewer: Viewer) {
  const { rows } = await db.execute<{ sentiment: string | null; language: string | null; n: string }>(sql`
    select sentiment::text as sentiment, language, count(*)::int as n
      from comments
     where tenant_id = ${viewer.tenantId} and state = 'open'
     group by grouping sets ((sentiment), (language))
  `);

  const sentiment: Record<string, number> = {};
  const language: Record<string, number> = {};
  let total = 0;

  for (const r of rows) {
    const n = Number(r.n);
    if (r.sentiment) {
      sentiment[r.sentiment] = n;
      total += n;
    } else if (r.language) {
      language[r.language] = n;
    }
  }

  // Unclassified comments are in the inbox but in neither distribution; the
  // screen says so rather than quietly leaving them out of the total.
  const [{ rows: totals }] = [
    await db.execute<{ n: string }>(
      sql`select count(*)::int as n from comments where tenant_id = ${viewer.tenantId} and state = 'open'`,
    ),
  ];
  const open = Number(totals[0]?.n ?? 0);

  return { sentiment, language, classified: total, open, unclassified: open - total };
}

/** How many comments are waiting — the badge in the Research sidebar. */
export async function openCommentCount(viewer: Viewer): Promise<number> {
  const { rows } = await db.execute<{ n: string }>(
    sql`select count(*)::int as n from comments where tenant_id = ${viewer.tenantId} and state = 'open'`,
  );
  return Number(rows[0]?.n ?? 0);
}

/** How fresh any of this is. The screens state it, per the brief's rule that
 * a chart says its date range and its source. */
export async function lastSyncAt(viewer: Viewer): Promise<Date | null> {
  const { rows } = await db.execute<{ at: string | null }>(
    sql`select max(synced_at)::text as at from channels where tenant_id = ${viewer.tenantId}`,
  );
  return rows[0]?.at ? new Date(rows[0].at) : null;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** One comment with everything the detail pane shows. */
export async function commentDetail(viewer: Viewer, commentId: string) {
  const [row] = await db
    .select({
      id: comments.id,
      postId: comments.postId,
      channelId: comments.channelId,
      externalId: comments.externalId,
      authorName: comments.authorName,
      authorHandle: comments.authorHandle,
      authorAvatarUrl: comments.authorAvatarUrl,
      authorExternalId: comments.authorExternalId,
      body: comments.body,
      translation: comments.translation,
      language: comments.language,
      sentiment: comments.sentiment,
      flagged: comments.flagged,
      flagReason: comments.flagReason,
      isLead: comments.isLead,
      leadReason: comments.leadReason,
      state: comments.state,
      postedAt: comments.postedAt,
      permalink: comments.permalink,
      postTitle: channelPosts.title,
      postExternalId: channelPosts.externalId,
      platform: channelPosts.platform,
    })
    .from(comments)
    .innerJoin(channelPosts, eq(channelPosts.id, comments.postId))
    .where(and(eq(comments.id, commentId), eq(comments.tenantId, viewer.tenantId)))
    .limit(1);

  return row ?? null;
}

/**
 * Earlier comments by the same person, which is what "14 prior comments" on
 * the artboard means.
 *
 * Counted by handle rather than by the platform's internal author id: the
 * handle is what the screen already holds, and keeping the id off the wire
 * means one less piece of personal data in the browser for a number that does
 * not need it.
 */
export async function priorComments(viewer: Viewer, authorHandle: string | null, exceptId: string) {
  if (!authorHandle) return 0;
  const { rows } = await db.execute<{ n: string }>(sql`
    select count(*)::int as n from comments
     where tenant_id = ${viewer.tenantId}
       and author_handle = ${authorHandle}
       and id <> ${exceptId}
  `);
  return Number(rows[0]?.n ?? 0);
}

/** Whether there is anything to show at all, and if not, why not. The screens
 * use this instead of rendering an empty table with no explanation. */
export async function connectionState(viewer: Viewer) {
  const list = await listChannels(viewer);
  const synced = await lastSyncAt(viewer);
  const { rows } = await db.execute<{ n: string }>(
    sql`select count(*)::int as n from channel_posts where tenant_id = ${viewer.tenantId}`,
  );

  return {
    channels: list,
    connected: list.length > 0,
    posts: Number(rows[0]?.n ?? 0),
    syncedAt: synced,
    unhealthy: list.filter((c) => c.needsReconnect || c.status === "error"),
  };
}

/** Views per day for one post, when someone opens it. */
export async function postSeries(viewer: Viewer, postId: string, w: Window = DEFAULT_WINDOW) {
  const since = windowStart(w);
  const rows = await db
    .select({ asOf: postMetrics.asOf, views: postMetrics.viewsDay })
    .from(postMetrics)
    .innerJoin(channelPosts, eq(channelPosts.id, postMetrics.postId))
    .where(
      and(
        eq(postMetrics.postId, postId),
        eq(channelPosts.tenantId, viewer.tenantId),
        gte(postMetrics.asOf, since),
      ),
    )
    .orderBy(asc(postMetrics.asOf));

  return rows.map((r) => ({ d: r.asOf.toISOString().slice(0, 10), v: r.views ?? 0 }));
}
