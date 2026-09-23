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
  postMetrics,
  researchSources,
} from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { assertBudget, BudgetStop, recordUsage } from "@/lib/ai/ledger";
import { servicePrincipal } from "@/lib/authz/service-principal";
import { env } from "@/lib/env";
import * as zernio from "./zernio";
import * as tikhub from "./tikhub";

/**
 * Pulling the studio's own social data in, on a schedule.
 *
 * Everything here runs in the worker. Nothing on this path is reachable from
 * a page render: Zernio bills per request, and a Content performance screen
 * that called `/analytics` on every filter change would cost money for a
 * number that changes once a day.
 *
 * The sync is idempotent by construction — every write is an upsert on the
 * platform's own id — so running it twice is the same as running it once, and
 * a half-finished round is safe to retry.
 */

const UNKNOWN_TENANT = "the tenant has no channels and no id could be resolved";

/** The single tenant these channels belong to. The studio is one tenant; this
 * stays a lookup rather than a constant so a second one does not silently
 * inherit the first one's channels. */
async function tenantId(): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(sql`select id from tenants order by created_at asc limit 1`);
  if (!rows[0]?.id) throw new Error(UNKNOWN_TENANT);
  return rows[0].id;
}

const toDateOrNull = (v: unknown): Date | null => {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

/** `Number(undefined)` is NaN and NaN in an integer column is an error, not a
 * zero. Absent stays absent all the way to the screen. */
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ------------------------------------------------------------- 1. channels

/**
 * Mirrors the connected accounts and their health.
 *
 * Health is the half that matters to a person: `/accounts` says a channel
 * exists, `/accounts/health` says whether it can actually post and when its
 * token runs out. The channel board shows the second one.
 */
export async function syncChannels() {
  const tenant = await tenantId();
  const [accounts, health] = await Promise.all([
    zernio.listAccounts(),
    zernio.accountHealth().catch(() => ({ accounts: [] as zernio.ZernioHealth[] })),
  ]);

  const healthById = new Map(health.accounts.map((h) => [h.accountId, h]));
  const now = new Date();
  let written = 0;

  for (const a of accounts) {
    const h = healthById.get(a._id);
    const scopes = (a.metadata?.scope ?? "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    const values = {
      tenantId: tenant,
      externalId: a._id,
      platform: a.platform,
      username: a.username ?? null,
      displayName: a.displayName ?? null,
      avatarUrl: a.profilePicture ?? null,
      profileUrl: a.profileUrl ?? null,
      platformUserId: a.platformUserId ?? null,
      followers: num(a.followersCount) ?? 0,
      status: h?.status ?? (a.needsReconnection ? "error" : "unknown"),
      canPost: h?.canPost ?? false,
      canReadAnalytics: h?.canFetchAnalytics ?? false,
      needsReconnect: h?.needsReconnect ?? Boolean(a.needsReconnection),
      tokenExpiresAt: toDateOrNull(h?.tokenExpiresAt ?? a.tokenExpiresAt),
      scopes,
      issues: h?.issues ?? [],
      enabled: a.enabled !== false,
      syncedAt: now,
    };

    await db
      .insert(channels)
      .values({ id: newId("chn"), ...values, lastError: null })
      /*
       * `lastError` is deliberately not in the `set`. Clearing it on every
       * channel refresh erased the per-channel reason written when a post's
       * comments could not be read, so the board said a connection was fine
       * moments after something on it had failed. Only the thing that fixes a
       * connection clears its error.
       */
      .onConflictDoUpdate({ target: [channels.tenantId, channels.externalId], set: values });
    written++;
  }

  return { channels: written };
}

// ---------------------------------------------------- 2. posts and metrics

/**
 * Mirrors published posts and takes one reading of their numbers.
 *
 * `asOf` is truncated to the day so two rounds in one day update a single row
 * rather than stacking two points on the chart. The day is the resolution the
 * platforms themselves report at, so nothing is lost.
 */
export async function syncPosts() {
  const tenant = await tenantId();
  const known = await db
    .select({ id: channels.id, externalId: channels.externalId, platform: channels.platform })
    .from(channels)
    .where(eq(channels.tenantId, tenant));

  if (!known.length) return { posts: 0, metrics: 0, note: "no channels connected" };

  const byExternal = new Map(known.map((c) => [c.externalId, c]));
  const byPlatform = new Map(known.map((c) => [c.platform, c]));

  const posts = await zernio.analyticsAll();
  const asOf = new Date();
  asOf.setUTCHours(0, 0, 0, 0);

  let postCount = 0;
  let metricCount = 0;

  for (const p of posts ?? []) {
    // A Zernio post can fan out to several platforms; each one is its own row
    // here, because "views on YouTube" and "views on LinkedIn" are not a sum.
    const targets = p.platforms?.length
      ? p.platforms
      : [{ platform: p.platform ?? "", platformPostId: null, platformPostUrl: p.platformPostUrl, accountId: null, analytics: p.analytics, status: p.status, accountUsername: null, errorMessage: null }];

    for (const t of targets) {
      const channel = (t.accountId && byExternal.get(t.accountId)) || byPlatform.get(t.platform);
      /*
       * Key on the platform's own id, and only on the platform's own id
       * (REVIEW.md #9).
       *
       * Falling back to Zernio's id meant a post ingested while it was still
       * publishing got Zernio's id, and the next round got the platform's:
       * two rows, two metric series, one video appearing twice on the table.
       * A post with no platform id has not been published yet, and skipping it
       * is the honest reading of that.
       */
      const externalId = t.platformPostId;
      if (!channel || !t.platform || !externalId) continue;

      /*
       * Zernio's own word for where this post got to (REVIEW.md #8).
       *
       * `status` was read off the response and never used, and `publishedAt`
       * fell back to `scheduledFor`, so a post scheduled for next Tuesday
       * sorted to the top of Content performance with a future date and a dash
       * in every column. Only something the platform actually took carries a
       * published date.
       */
      const state = String(t.status ?? p.status ?? "").toLowerCase();
      const isPublished = state === "published" || state === "posted" || state === "" ;
      const publishedAt = isPublished ? toDateOrNull(p.publishedAt) : null;

      const values = {
        tenantId: tenant,
        channelId: channel.id,
        externalId,
        zernioPostId: p.isExternal ? null : p._id,
        platform: t.platform,
        title: (p.content ?? "").split("\n")[0].slice(0, 300) || null,
        body: p.content ?? null,
        permalink: t.platformPostUrl ?? p.platformPostUrl ?? null,
        thumbnailUrl: p.thumbnailUrl ?? null,
        isExternal: Boolean(p.isExternal),
        publishedAt,
        status: state || "published",
        scheduledFor: toDateOrNull(p.scheduledFor),
        commentCount: num(t.analytics?.comments ?? p.analytics?.comments) ?? 0,
        syncedAt: new Date(),
      };

      const [row] = await db
        .insert(channelPosts)
        .values({ id: newId("post"), ...values })
        .onConflictDoUpdate({
          target: [channelPosts.tenantId, channelPosts.platform, channelPosts.externalId],
          set: values,
        })
        .returning({ id: channelPosts.id });
      postCount++;

      const a = t.analytics ?? p.analytics;
      if (!a || !row) continue;

      const metrics = {
        views: num(a.views),
        impressions: num(a.impressions),
        reach: num(a.reach),
        likes: num(a.likes),
        comments: num(a.comments),
        shares: num(a.shares),
        saves: num(a.saves),
        clicks: num(a.clicks),
        follows: num(a.follows),
        /**
         * Zernio sends 0 for a metric the platform did not report, which is
         * not the same thing as zero. A video with six hundred views cannot
         * have a 0% watch-through, and a table of "0.0%" down every row is
         * exactly the invented number the brief forbids. Zero becomes absent,
         * and the screen shows "not reported".
         */
        /*
         * A fraction, like the column says (REVIEW.md #5).
         *
         * Zernio reports this as a percentage and the daily job writes
         * `averageViewPercentage / 100`, so this column held two different
         * quantities and `PerfScreen` multiplied both by 100. That was masked
         * only by the empirical fact that Zernio reports 0 for YouTube — a
         * coincidence the code relied on and never asserted.
         */
        completionRate: (num(a.completionRate) || null) === null ? null : num(a.completionRate)! / 100,
        // Zernio reports this as a percentage; the column is a fraction, so
        // one place converts and every reader gets the same unit.
        engagementRate: a.engagementRate === null || a.engagementRate === undefined ? null : Number(a.engagementRate) / 100,
      };

      /*
       * Running it twice is the same as running it once (REVIEW.md #9).
       *
       * The `set` used to include `completionRate`, which meant the hourly
       * round wrote null over the watch-through the daily job had measured
       * from YouTube Analytics an hour earlier. "Sync now" reproduced it on
       * demand. A null here is "Zernio did not say", which is not a reason to
       * forget what somebody else did say.
       */
      const { completionRate, ...alwaysSet } = metrics;
      await db
        .insert(postMetrics)
        .values({ id: newId("pm"), postId: row.id, asOf, ...metrics })
        .onConflictDoUpdate({
          target: [postMetrics.postId, postMetrics.asOf],
          set: completionRate === null ? alwaysSet : metrics,
        });
      metricCount++;
    }
  }

  return { posts: postCount, metrics: metricCount };
}

/**
 * Backfills views gained per day, and the real watch-through.
 *
 * This is the expensive call in the module: YouTube Analytics is addressed per
 * video, so this is one request per post. It therefore runs once a day over a
 * bounded, recent set rather than on the hourly round, and it is the reason
 * the Daily views chart has a line on it the moment a channel is connected
 * instead of after a month of watching.
 *
 * Watch-through comes from the same response. `/analytics` reports it as 0
 * for YouTube, which is not a measurement; `averageViewPercentage` is.
 */
async function inBatches<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let at = 0; at < items.length; at += size) {
    out.push(...(await Promise.all(items.slice(at, at + size).map(work))));
  }
  return out;
}

export async function syncDailyViews(opts: { days?: number; maxPosts?: number } = {}) {
  const days = opts.days ?? 90;
  const maxPosts = opts.maxPosts ?? 40;
  const tenant = await tenantId();

  const rows = await db
    .select({
      id: channelPosts.id,
      externalId: channelPosts.externalId,
      channelExternalId: channels.externalId,
    })
    .from(channelPosts)
    .innerJoin(channels, eq(channels.id, channelPosts.channelId))
    .where(
      and(
        eq(channelPosts.tenantId, tenant),
        eq(channelPosts.platform, "youtube"),
        eq(channels.canReadAnalytics, true),
        sql`${channelPosts.publishedAt} >= now() - ${`${days} days`}::interval`,
      ),
    )
    .orderBy(desc(channelPosts.publishedAt))
    .limit(maxPosts);

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - days);
  const startDate = since.toISOString().slice(0, 10);
  const endDate = new Date().toISOString().slice(0, 10);

  let posts = 0;
  let points = 0;

  // Five questions in the air at once rather than one after another: at
  // twenty seconds a call this was the one job that never finished inside its
  // ten minutes, and a sync that always times out is a sync that never ran.
  const fetched = await inBatches(rows, 5, async (p) => {
    try {
      const res = await zernio.youtubeDailyViews(p.channelExternalId, p.externalId, { startDate, endDate });
      return { p, daily: res.dailyViews ?? [] };
    } catch {
      // One video's analytics being unavailable is normal, not a failure of
      // the round: YouTube returns nothing for a video with very few views.
      return null;
    }
  });

  for (const got of fetched) {
    if (!got) continue;
    const { p, daily } = got;
    posts++;
    const rows90: (typeof postMetrics.$inferInsert)[] = [];

    for (const d of daily) {
      const asOf = new Date(`${d.date}T00:00:00.000Z`);
      if (Number.isNaN(asOf.getTime())) continue;

      const views = num(d.views) ?? 0;
      /**
       * A day with no views carries no information about watch-through, and a
       * reported 0% alongside actual views is YouTube saying "not processed
       * yet" rather than "nobody watched any of it". Both become absent.
       *
       * Values above 100 are real — people rewatch — and are kept as measured.
       * They are not shown raw on the table: `performance()` averages across
       * days weighted by views, which is what stops a day with one viewer who
       * looped the video from reading as a 104% watch-through for the video.
       */
      const raw = num(d.averageViewPercentage);
      const pct = views > 0 && raw !== null && raw > 0 ? raw : null;

      rows90.push({
        id: newId("pm"),
        postId: p.id,
        asOf,
        viewsDay: views,
        minutesWatchedDay: num(d.estimatedMinutesWatched),
        subscribersGainedDay: num(d.subscribersGained),
        completionRate: pct === null ? null : pct / 100,
      });
    }

    /*
     * One statement per video, not one per day. Three and a half thousand
     * single-row upserts against a database in another country was the
     * fourteen minutes this job took, not the vendor. A null watch-through
     * keeps whatever was stored before, as the single-row version did.
     */
    for (let at = 0; at < rows90.length; at += 200) {
      const chunk = rows90.slice(at, at + 200);
      await db
        .insert(postMetrics)
        .values(chunk)
        .onConflictDoUpdate({
          target: [postMetrics.postId, postMetrics.asOf],
          set: {
            viewsDay: sql`excluded.views_day`,
            minutesWatchedDay: sql`excluded.minutes_watched_day`,
            subscribersGainedDay: sql`excluded.subscribers_gained_day`,
            completionRate: sql`coalesce(excluded.completion_rate, ${postMetrics.completionRate})`,
          },
        });
      points += chunk.length;
    }
  }

  return { dailyPosts: posts, dailyPoints: points };
}

// ------------------------------------------------------------- 3. comments

/**
 * Mirrors the comments on our own posts.
 *
 * Only posts that report a comment count are asked about — an inbox with
 * fifty posts and three comments should cost three requests, not fifty.
 */
export async function syncComments(limitPosts = 100) {
  const tenant = await tenantId();
  // `minComments: 1` is the whole reason this is cheap: Zernio filters out the
  // posts nobody has commented on, so we only pay for the ones with something
  // to read.
  const { data: inbox } = await zernio.inboxPosts({ limit: limitPosts, minComments: 1 });

  const rows = await db
    .select({ id: channelPosts.id, externalId: channelPosts.externalId, channelId: channelPosts.channelId })
    .from(channelPosts)
    .where(eq(channelPosts.tenantId, tenant));
  const postByExternal = new Map(rows.map((r) => [r.externalId, r]));

  const channelRows = await db
    .select({ id: channels.id, externalId: channels.externalId })
    .from(channels)
    .where(eq(channels.tenantId, tenant));
  const channelByExternal = new Map(channelRows.map((c) => [c.externalId, c.id]));

  let fetched = 0;
  let written = 0;

  for (const p of inbox ?? []) {
    /*
     * Zernio has already filtered this list by `minComments`, so re-checking
     * the field is redundant — and if it is ever absent, this skipped every
     * post and the round reported success with zero comments, which is the
     * silent-empty-inbox failure this module has already hit once. Only an
     * explicit zero is a reason to skip.
     */
    if (num(p.commentCount) === 0) continue;

    // `syncPosts` only reaches back as far as the analytics window, and the
    // posts people are still commenting on are often older than that. Rather
    // than drop their comments, the post is created from what the inbox
    // already told us about it.
    let local = postByExternal.get(p.id);
    if (!local) {
      const channelId = channelByExternal.get(p.accountId);
      if (!channelId) continue;

      const values = {
        tenantId: tenant,
        channelId,
        externalId: p.id,
        platform: p.platform,
        title: (p.content ?? "").split("\n")[0].slice(0, 300) || null,
        body: p.content ?? null,
        permalink: p.permalink ?? null,
        thumbnailUrl: p.picture ?? null,
        isExternal: true,
        publishedAt: toDateOrNull(p.createdTime),
        commentCount: num(p.commentCount) ?? 0,
        syncedAt: new Date(),
      };
      const [created] = await db
        .insert(channelPosts)
        .values({ id: newId("post"), ...values })
        .onConflictDoUpdate({
          target: [channelPosts.tenantId, channelPosts.platform, channelPosts.externalId],
          set: values,
        })
        .returning({ id: channelPosts.id });
      if (!created) continue;
      local = { id: created.id, externalId: p.id, channelId };
      postByExternal.set(p.id, local);
    }

    let batch: zernio.ZernioComment[] = [];
    try {
      /*
       * Every page, not the first hundred (REVIEW.md #12).
       *
       * `pagination.hasMore` and `cursor` were typed in `zernio.ts` and never
       * read, so a video with four hundred comments contributed a hundred and
       * the inbox reported that as the whole of it. Bounded at ten pages: a
       * thousand comments on one video is already more than a person will work
       * through in a sitting, and an unbounded loop against a metered vendor
       * is a bill nobody approved.
       */
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const res = await zernio.postComments(p.id, { accountId: p.accountId, limit: 100, cursor });
        // Replies arrive nested inside their parent. Flattened to one row each
        // with `parentExternalId` set, so a reply is a comment the inbox can
        // show, filter and act on like any other.
        batch = batch.concat(flatten(res.comments ?? []));
        cursor = res.pagination?.hasMore ? (res.pagination.cursor ?? undefined) : undefined;
        if (!cursor) break;
      }
    } catch (err) {
      // One unreadable post must not abandon the round. The reason is kept on
      // the channel so the screen can say which connection is unhappy.
      await db
        .update(channels)
        .set({ lastError: err instanceof Error ? err.message.slice(0, 500) : String(err) })
        .where(eq(channels.id, local.channelId));
      continue;
    }
    fetched += batch.length;

    for (const c of batch) {
      const body = c.message ?? c.text ?? "";
      const values = {
        tenantId: tenant,
        postId: local.id,
        channelId: local.channelId,
        externalId: c.id,
        parentExternalId: c.parentId ?? null,
        authorName: c.from?.name ?? null,
        // YouTube puts the @handle in `name` and sends no `username`, so the
        // inbox would have shown every commenter as anonymous.
        authorHandle: c.from?.username ?? (c.from?.name?.startsWith("@") ? c.from.name : null),
        authorAvatarUrl: c.from?.picture ?? null,
        authorExternalId: c.from?.id ?? null,
        body,
        likeCount: num(c.likeCount) ?? 0,
        replyCount: num(c.replyCount) ?? 0,
        permalink: c.url ?? c.permalink ?? null,
        postedAt: toDateOrNull(c.createdTime),
      };

      // `state` is deliberately absent from the update set: a comment someone
      // has already hidden must not come back as open on the next round.
      await db
        .insert(comments)
        .values({ id: newId("cmt"), ...values, state: c.isHidden ? "hidden" : "open" })
        .onConflictDoUpdate({ target: [comments.tenantId, comments.externalId], set: values });
      written++;
    }
  }

  return { fetched, written };
}

/** A threaded comment list as a flat one, each reply carrying its parent. */
function flatten(list: zernio.ZernioComment[], parentId: string | null = null): zernio.ZernioComment[] {
  const out: zernio.ZernioComment[] = [];
  for (const c of list) {
    out.push({ ...c, parentId: c.parentId ?? parentId });
    if (c.replies?.length) out.push(...flatten(c.replies, c.id));
  }
  return out;
}

// --------------------------------------------------------- 4. the reading

/** What the model is asked to decide about one comment. */
type Classification = {
  sentiment: (typeof comments.$inferInsert)["sentiment"];
  language: string | null;
  translation: string | null;
  flagged: boolean;
  flagReason: string | null;
  isLead: boolean;
  leadReason: string | null;
  reply: string | null;
};

const SENTIMENTS = ["very_negative", "negative", "neutral", "positive", "very_positive"] as const;

const CLASSIFY_PROMPT = `You read comments left on a Hong Kong video studio's social posts and prepare a reply for a human to approve.

Answer with a single JSON object and nothing else:
{
  "sentiment": one of "very_negative" | "negative" | "neutral" | "positive" | "very_positive",
  "language": BCP-47 tag of the comment ("yue" for Cantonese, "zh-Hans", "zh-Hant", "en", ...),
  "translation": the comment in English if it is not already English, else null,
  "flagged": true if it is abusive, spam, or politically sensitive in a Hong Kong context,
  "flagReason": one short sentence saying why, else null,
  "isLead": true only if it is a genuine business or sponsorship enquiry,
  "leadReason": one short sentence saying why, else null,
  "reply": a reply the studio could send, in the SAME language and register as the comment, at most two sentences. null if no reply is appropriate (spam, abuse, or nothing to say).
}

Write the reply as the studio: warm, specific, never salesy, never promising a date you were not told. Do not invent facts about the video.`;

/**
 * Reads and drafts, for comments nothing has looked at yet.
 *
 * Classification is stored, not recomputed: the inbox filters on sentiment and
 * language, and a filter that costs a model call per comment per keystroke is
 * not a filter.
 *
 * Every call goes through the ledger like any other (spec §5). A comment that
 * cannot be classified is left unclassified rather than guessed at — it still
 * appears in the inbox, just without a badge.
 */
export async function classifyComments(batchSize = 20) {
  const tenant = await tenantId();
  const pending = await db
    .select({ id: comments.id, body: comments.body, postId: comments.postId })
    .from(comments)
    .where(and(eq(comments.tenantId, tenant), isNull(comments.classifiedAt), eq(comments.state, "open")))
    .orderBy(desc(comments.postedAt))
    .limit(batchSize);

  if (!pending.length) return { classified: 0, drafted: 0 };

  // The post's own title is the only context the model gets. It stops a reply
  // inventing what the video was about.
  const titles = new Map(
    (
      await db
        .select({ id: channelPosts.id, title: channelPosts.title })
        .from(channelPosts)
        .where(inArray(channelPosts.id, [...new Set(pending.map((p) => p.postId))]))
    ).map((r) => [r.id, r.title ?? ""]),
  );

  const model = modelFor.utility();
  // Scheduled work is charged to the service principal, not to whoever
  // happens to open the inbox afterwards (spec §2).
  const principal = await servicePrincipal(tenant);

  /*
   * The cap stops scheduled work too (REVIEW.md #10).
   *
   * This loop recorded its spend and never checked it, so with the cap
   * exhausted `regenerateDraftAction` correctly refused every person while
   * this kept billing twenty calls an hour, unattended. Checked once before
   * the batch and again between comments, because a batch of fifty can cross
   * the cap halfway through.
   */
  try {
    await assertBudget(principal);
  } catch (err) {
    if (err instanceof BudgetStop) {
      console.warn("[social] classification stopped: the studio is at its cap");
      return { classified: 0, drafted: 0, stopped: "budget" as const };
    }
    throw err;
  }

  let classified = 0;
  let drafted = 0;

  for (const c of pending) {
    if (!c.body.trim()) {
      await db.update(comments).set({ classifiedAt: new Date() }).where(eq(comments.id, c.id));
      continue;
    }

    // Re-checked between comments: a long batch can cross the cap partway.
    try {
      await assertBudget(principal);
    } catch (err) {
      if (err instanceof BudgetStop) {
        console.warn("[social] classification stopped partway: the studio reached its cap");
        return { classified, drafted, stopped: "budget" as const };
      }
      throw err;
    }

    let parsed: Classification | null = null;
    let costMicros = 0;
    try {
      const out = await complete({
        model,
        temperature: 0,
        maxTokens: 500,
        messages: [
          { role: "system", content: CLASSIFY_PROMPT },
          { role: "user", content: `Video: ${titles.get(c.postId) || "(untitled)"}\n\nComment:\n${c.body.slice(0, 2000)}` },
        ],
      });
      costMicros = out.costMicros;
      parsed = parseClassification(out.text);

      await recordUsage({
        viewer: principal,
        module: "research",
        provider: out.provider ?? "openrouter",
        model: out.model,
        promptTokens: out.promptTokens,
        completionTokens: out.completionTokens,
        costMicros: out.costMicros,
        requestId: out.requestId,
      });
    } catch {
      // Leave it unclassified; the next round tries again. An unread comment
      // is better than a wrong badge on someone's words.
      continue;
    }

    if (!parsed) continue;

    await db
      .update(comments)
      .set({
        sentiment: parsed.sentiment,
        language: parsed.language,
        translation: parsed.translation,
        flagged: parsed.flagged,
        flagReason: parsed.flagReason,
        isLead: parsed.isLead,
        leadReason: parsed.leadReason,
        classifiedAt: new Date(),
      })
      .where(eq(comments.id, c.id));
    classified++;

    if (parsed.reply?.trim()) {
      await db.insert(commentDrafts).values({
        id: newId("cd"),
        tenantId: tenant,
        commentId: c.id,
        body: parsed.reply.trim(),
        model,
        costMicros,
      });
      drafted++;
    }
  }

  return { classified, drafted };
}

/** Models fence JSON, prefix it with prose, or return a near-miss enum value.
 * Anything that cannot be read as the shape above is refused rather than
 * half-applied. */
function parseClassification(text: string): Classification | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }

  const s = String(raw.sentiment ?? "").toLowerCase().replace(/[\s-]/g, "_");
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 1000) : null);

  return {
    sentiment: (SENTIMENTS as readonly string[]).includes(s) ? (s as Classification["sentiment"]) : null,
    language: str(raw.language)?.slice(0, 20) ?? null,
    translation: str(raw.translation),
    flagged: raw.flagged === true,
    flagReason: raw.flagged === true ? str(raw.flagReason) : null,
    isLead: raw.isLead === true,
    leadReason: raw.isLead === true ? str(raw.leadReason) : null,
    reply: str(raw.reply),
  };
}

/**
 * Tells the Research sidebar whether this source is actually answering.
 *
 * The dot next to "Our own channels" is the outcome of the last round, not a
 * decoration — the same rule the news sources follow.
 */
async function markSource(key: string, ok: boolean, error?: string) {
  await db
    .update(researchSources)
    .set(
      ok
        ? { status: "live" as const, lastOkAt: new Date(), lastError: null }
        : { status: "degraded" as const, lastError: (error ?? "").slice(0, 500) },
    )
    .where(eq(researchSources.key, key))
    .catch(() => {});
}

/** One round of everything, in order. Channels first because posts need them,
 * posts before comments because a comment hangs off a post. */
export async function syncAll() {
  try {
    const ch = await syncChannels();
    const po = await syncPosts();
    const dv = await syncDailyViews();
    const co = await syncComments();
    const cl = await classifyComments();
    await markSource("zernio", true);
    await checkTikHub();
    return { ...ch, ...po, ...dv, ...co, ...cl };
  } catch (err) {
    await markSource("zernio", false, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * One cheap call per round, so the sidebar's dot for "Other channels" is the
 * outcome of actually reaching TikHub rather than a guess from whether a key
 * is present.
 *
 * Nothing on a screen reads TikHub yet — it is for competitor rows on the
 * Trends dashboard, which is not built. A source that is reachable but unused
 * should still read as reachable; a source whose key has expired should say
 * so before someone builds against it.
 */
async function checkTikHub() {
  if (!env.tikhub.configured) return;
  try {
    await tikhub.keyInfo();
    await markSource("tikhub", true);
  } catch (err) {
    await markSource("tikhub", false, err instanceof Error ? err.message : String(err));
  }
}

// -------------------------------------------------------- 4. competitors

/**
 * Somebody else's channel, read from the outside.
 *
 * The one thing Zernio cannot do and TikHub can: the studio's own accounts are
 * mirrored by `syncChannels`, and this is everybody else. Public figures only,
 * exactly what the platform shows anybody.
 *
 * Each competitor is fetched independently and a failure is kept on that row:
 * one channel that has been renamed must not abandon the round for the rest.
 */
export async function syncCompetitors(limit = 25) {
  if (!env.tikhub.configured) return { competitors: 0, posts: 0, skipped: "no TikHub key" as const };

  const tenant = await tenantId();
  if (!tenant) return { competitors: 0, posts: 0 };

  const rows = await db
    .select()
    .from(competitors)
    .where(eq(competitors.tenantId, tenant))
    .orderBy(asc(competitors.syncedAt))
    .limit(limit);

  let synced = 0;
  let posts = 0;

  for (const c of rows) {
    try {
      // Only YouTube today. The client has TikTok, Instagram, Xiaohongshu and
      // WeChat helpers ready; each returns a differently shaped payload and
      // gets its own branch when the studio actually watches one.
      if (c.platform !== "youtube") {
        await db
          .update(competitors)
          .set({ syncedAt: new Date(), lastError: `No reader for ${c.platform} yet` })
          .where(eq(competitors.id, c.id));
        continue;
      }

      /*
       * A competitor may have been entered as `@handle` or as a URL, because
       * that is what a person has. `get_channel_videos` answers an empty list
       * for anything but a `UC…` id — no error, just nothing — so it is
       * resolved once and the id written back, and every later round is one
       * request instead of two.
       */
      let channelId = c.externalId;
      if (!/^UC[\w-]{20,}$/.test(channelId)) {
        const resolved = await tikhub.resolveYouTubeChannel(c.externalId);
        if (!resolved) {
          await db
            .update(competitors)
            .set({ syncedAt: new Date(), lastError: `No YouTube channel found for ${c.externalId}` })
            .where(eq(competitors.id, c.id));
          continue;
        }
        channelId = resolved;
        await db.update(competitors).set({ externalId: resolved }).where(eq(competitors.id, c.id));
      }

      const res = await tikhub.youtubeChannelVideos(channelId);
      const videos = res.videos ?? [];

      for (const v of videos.slice(0, 30)) {
        if (!v.video_id) continue;
        const values = {
          tenantId: tenant,
          competitorId: c.id,
          externalId: v.video_id,
          title: v.title ?? null,
          permalink: v.url ?? `https://www.youtube.com/watch?v=${v.video_id}`,
          thumbnailUrl: v.thumbnail ?? null,
          views: parseCount(v.view_count ?? v.short_view_count),
          durationSecs: parseDuration(v.duration),
          // The platform often gives "3 weeks ago" rather than a date. Kept as
          // it was said rather than turned into a date we invented.
          publishedLabel: v.published_time ?? null,
          syncedAt: new Date(),
        };

        await db
          .insert(competitorPosts)
          .values({ id: newId("post"), ...values })
          .onConflictDoUpdate({ target: [competitorPosts.competitorId, competitorPosts.externalId], set: values });
        posts++;
      }

      await db
        .update(competitors)
        .set({ syncedAt: new Date(), lastError: null })
        .where(eq(competitors.id, c.id));
      synced++;
    } catch (err) {
      await db
        .update(competitors)
        .set({
          syncedAt: new Date(),
          lastError: err instanceof Error ? err.message.slice(0, 500) : String(err),
        })
        .where(eq(competitors.id, c.id));
    }
  }

  return { competitors: synced, posts };
}

/** "1.2M views", "48,120", "3.4K" — whatever the platform felt like sending. */
function parseCount(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = String(value).replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const scale = { k: 1_000, m: 1_000_000, b: 1_000_000_000 }[(m[2] ?? "").toLowerCase()] ?? 1;
  return Math.round(n * scale);
}

/** "12:34" or "1:02:03". */
function parseDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const parts = String(value).split(":").map(Number);
  if (!parts.length || parts.some((p) => !Number.isFinite(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
