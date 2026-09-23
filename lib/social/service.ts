import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  channelPosts,
  channels,
  commentDrafts,
  comments,
  competitorPosts,
  competitors,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";

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
       -- Published, and published inside the window. A scheduled or failed
       -- post has no published_at at all now, so it cannot sort to the top of
       -- this table with a dash in every column (REVIEW.md #8).
       and p.status = 'published'
       and p.published_at is not null
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
  /*
   * Totals over every post in the window, not over the two hundred the table
   * shows (REVIEW.md #7).
   *
   * This used to call `performance()` and add up what came back. That query
   * caps at 200 rows ordered by views, so a channel with 260 posts in a 90-day
   * window reported "Posts: 200" and totals missing the sixty smallest — and
   * it ran the same expensive query twice per render. One aggregate, over
   * everything.
   */
  const since = windowStart(opts.window ?? DEFAULT_WINDOW);

  const { rows } = await db.execute<Record<string, unknown>>(sql`
    select count(*)::int                                     as posts,
           coalesce(sum(m.views), 0)::bigint                  as views,
           coalesce(sum(m.likes), 0)::bigint                  as likes,
           coalesce(sum(m.comments), 0)::bigint               as comments,
           avg(m.engagement_rate) filter (where m.engagement_rate is not null) as engagement_rate
      from channel_posts p
      join channels c on c.id = p.channel_id
      left join lateral (
        select * from post_metrics pm
         where pm.post_id = p.id and pm.views is not null
         order by pm.as_of desc
         limit 1
      ) m on true
     where p.tenant_id = ${viewer.tenantId}
       and p.status = 'published'
       and p.published_at is not null
       and p.published_at >= ${since}
       ${opts.platform ? sql`and p.platform = ${opts.platform}` : sql``}
  `);

  /*
   * Two different quantities, named as two (REVIEW.md #6).
   *
   * `views` is the lifetime total of the posts published in this window.
   * `viewsInWindow` is what was gained during it, across every post however
   * old. Both are legitimate; under one "Last 28 days" chip they read as a
   * contradiction, because on a channel with history the tile said 1.4M and
   * the chart underneath summed to 40k. The screen now labels each.
   */
  const { rows: gained } = await db.execute<Record<string, unknown>>(sql`
    select coalesce(sum(m.views_day), 0)::bigint as v
      from post_metrics m
      join channel_posts p on p.id = m.post_id
     where p.tenant_id = ${viewer.tenantId}
       and m.as_of >= ${since}
       and m.views_day is not null
       ${opts.platform ? sql`and p.platform = ${opts.platform}` : sql``}
  `);

  const r = rows[0] ?? {};
  return {
    posts: Number(r.posts ?? 0),
    views: Number(r.views ?? 0),
    viewsInWindow: Number(gained[0]?.v ?? 0),
    likes: Number(r.likes ?? 0),
    comments: Number(r.comments ?? 0),
    /** Averaged over the posts that actually report it, so one platform's
     * silence does not drag the number to zero. */
    engagementRate: r.engagement_rate === null || r.engagement_rate === undefined ? null : Number(r.engagement_rate),
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
  draft: {
    id: string;
    body: string;
    model: string | null;
    editedAt: Date | null;
    /** What the platform said the last time this was tried (REVIEW.md #14).
     * It was written onto the row and nothing ever selected it, so three
     * overnight failures left three drafts that looked untouched. */
    error: string | null;
  } | null;
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
export const SENTIMENTS = ["very_negative", "negative", "neutral", "positive", "very_positive"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export function isSentiment(v: unknown): v is Sentiment {
  return typeof v === "string" && (SENTIMENTS as readonly string[]).includes(v);
}

export async function inbox(viewer: Viewer, filters: InboxFilters = {}): Promise<InboxGroup[]> {
  const where = [eq(comments.tenantId, viewer.tenantId)];

  where.push(eq(comments.state, filters.state ?? "open"));
  /*
   * A sentiment off the wire is a string until it is one of these five
   * (REVIEW.md #4). Binding an unvalidated URL parameter against a `pgEnum`
   * column — `as never` being the cast that silenced the type error — meant a
   * typo or a stale bookmark crashed the route with a Postgres 22P02. An
   * unknown value now narrows nothing, which is what a filter nobody asked for
   * should do.
   */
  if (isSentiment(filters.sentiment)) where.push(eq(comments.sentiment, filters.sentiment));
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
      error: commentDrafts.error,
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
      draft: d ? { id: d.id, body: d.body, model: d.model, editedAt: d.editedAt, error: d.error } : null,
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

/**
 * How many other comments each of these commenters has left, in one query.
 *
 * The inbox used to call `priorComments` once per distinct handle. Its comment
 * said "four queries, not forty", but the map is keyed per commenter over up to
 * three hundred comments, so 260 commenters meant 260 concurrent round trips to
 * Singapore against a pool of eight (REVIEW.md #13). One `group by` returns the
 * same data.
 *
 * The count excludes the comment being displayed, which is why the caller
 * passes the ids it is showing rather than only the handles.
 */
export async function priorCommentCounts(
  viewer: Viewer,
  shown: { id: string; authorHandle: string | null }[],
): Promise<Record<string, number>> {
  const handles = [...new Set(shown.map((c) => c.authorHandle).filter((h): h is string => Boolean(h)))];
  if (!handles.length) return {};

  const rows = await db
    .select({ handle: comments.authorHandle, n: sql<number>`count(*)::int` })
    .from(comments)
    .where(and(eq(comments.tenantId, viewer.tenantId), inArray(comments.authorHandle, handles)))
    .groupBy(comments.authorHandle);

  const total = new Map(rows.map((r) => [r.handle ?? "", r.n]));

  const out: Record<string, number> = {};
  for (const c of shown) {
    if (!c.authorHandle) continue;
    // Everything this person has said, less the one on screen.
    out[c.id] = Math.max(0, (total.get(c.authorHandle) ?? 0) - 1);
  }
  return out;
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

// --------------------------------------------------------- competitors

export type CompetitorRow = {
  id: string;
  platform: string;
  /** The platform's own id — a `UC…` for YouTube. Carried so a discovery
   * panel can tell which of the channels it found are already watched. */
  externalId: string;
  handle: string | null;
  displayName: string | null;
  note: string | null;
  syncedAt: Date | null;
  lastError: string | null;
  postCount: number;
  /** Median views over what they published recently. A median rather than a
   * mean: one video that went far should not describe a channel. */
  medianViews: number | null;
  topPost: { title: string | null; permalink: string | null; views: number | null } | null;
};

export async function listCompetitors(viewer: Viewer): Promise<CompetitorRow[]> {
  const rows = await db
    .select()
    .from(competitors)
    .where(eq(competitors.tenantId, viewer.tenantId))
    .orderBy(competitors.displayName);

  if (!rows.length) return [];

  const posts = await db
    .select({
      competitorId: competitorPosts.competitorId,
      title: competitorPosts.title,
      permalink: competitorPosts.permalink,
      views: competitorPosts.views,
    })
    .from(competitorPosts)
    .where(inArray(competitorPosts.competitorId, rows.map((r) => r.id)));

  const byCompetitor = new Map<string, typeof posts>();
  for (const p of posts) {
    byCompetitor.set(p.competitorId, [...(byCompetitor.get(p.competitorId) ?? []), p]);
  }

  return rows.map((c) => {
    const own = byCompetitor.get(c.id) ?? [];
    const views = own.map((p) => p.views).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
    const top = own.reduce<(typeof own)[number] | null>(
      (best, p) => ((p.views ?? 0) > (best?.views ?? -1) ? p : best),
      null,
    );

    return {
      id: c.id,
      platform: c.platform,
      externalId: c.externalId,
      handle: c.handle,
      displayName: c.displayName,
      note: c.note,
      syncedAt: c.syncedAt,
      lastError: c.lastError,
      postCount: own.length,
      medianViews: views.length ? views[Math.floor(views.length / 2)] : null,
      topPost: top ? { title: top.title, permalink: top.permalink, views: top.views } : null,
    };
  });
}

/**
 * The studio's own median, for the same comparison.
 *
 * A competitor table with no "us" row is a table of other people's numbers.
 * Median for the same reason: one video that went far is not the channel.
 */
export async function ourMedianViews(viewer: Viewer, opts: { window?: Window } = {}): Promise<number | null> {
  const since = windowStart(opts.window ?? DEFAULT_WINDOW);
  const { rows } = await db.execute<{ v: string | number }>(sql`
    select percentile_cont(0.5) within group (order by m.views)::bigint as v
      from channel_posts p
      join lateral (
        select * from post_metrics pm
         where pm.post_id = p.id and pm.views is not null
         order by pm.as_of desc limit 1
      ) m on true
     where p.tenant_id = ${viewer.tenantId}
       and p.status = 'published'
       and p.published_at is not null
       and p.published_at >= ${since}
  `);
  const v = rows[0]?.v;
  return v === null || v === undefined ? null : Number(v);
}

export async function addCompetitor(
  viewer: Viewer,
  input: { platform: string; externalId: string; handle: string | null; displayName: string | null; note: string | null },
) {
  const externalId = input.externalId.trim();
  if (!externalId) throw new Error("A channel id is needed");

  const id = newId("chn");
  await db
    .insert(competitors)
    .values({
      id,
      tenantId: viewer.tenantId,
      platform: input.platform,
      externalId,
      handle: input.handle?.trim() || null,
      displayName: input.displayName?.trim() || input.handle?.trim() || externalId,
      note: input.note?.slice(0, 500) || null,
      addedBy: viewer.id,
    })
    .onConflictDoNothing();

  await audit(viewer, "research.competitor.add", {
    module: "research",
    objectType: "competitor",
    objectId: id,
    meta: { platform: input.platform, externalId },
  });
  return id;
}

export async function removeCompetitor(viewer: Viewer, competitorId: string) {
  await db
    .delete(competitors)
    .where(and(eq(competitors.id, competitorId), eq(competitors.tenantId, viewer.tenantId)));
  await audit(viewer, "research.competitor.remove", { module: "research", objectId: competitorId });
}
