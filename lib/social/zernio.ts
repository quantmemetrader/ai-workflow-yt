import "server-only";
import { env } from "@/lib/env";

/**
 * Zernio — the studio's own connected accounts.
 *
 * This is the credential that turned out to matter. Zernio holds the OAuth
 * grants the studio gave it, which is why it can do the two things a scraper
 * never can: read the comments on *our* posts as the account that owns them,
 * and act on them. The YouTube grant includes `youtube.force-ssl`, so a reply
 * posted through here appears as the channel, not as a bot.
 *
 * Rules this module keeps, because the spec and the billing both demand it:
 *
 *   — Nothing here is called from a page render. Every caller is a job
 *     (`lib/social/ingest.ts`) or a server action a person triggered. Zernio
 *     bills per request and rate-limits per account.
 *   — Errors keep the provider's own message (spec §6). "Something went wrong"
 *     is never enough for someone looking at a channel that will not connect.
 *   — The key is read here and nowhere else. Screens see connection *state*,
 *     never the credential (spec §8).
 */

export class ZernioError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly param?: string,
  ) {
    super(message);
    this.name = "ZernioError";
  }
}

/** Zernio is unreachable or unconfigured, as opposed to refusing a request. */
export class ZernioUnconfigured extends Error {
  constructor() {
    super("No ZERNIO_API_KEY is set, so no channel can be connected.");
    this.name = "ZernioUnconfigured";
  }
}

const TIMEOUT_MS = Number(process.env.ZERNIO_TIMEOUT_MS ?? 20_000);

type Query = Record<string, string | number | boolean | undefined | null>;

async function call<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  init: { query?: Query; body?: unknown } = {},
): Promise<T> {
  if (!env.zernio.configured) throw new ZernioUnconfigured();

  const url = new URL(env.zernio.baseUrl + path);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal,
      headers: {
        authorization: `Bearer ${env.zernio.apiKey}`,
        accept: "application/json",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
  } catch (err) {
    // A timeout and a DNS failure are the same thing to a caller: the vendor
    // did not answer. Say which, because one is worth retrying sooner.
    const why = err instanceof Error && err.name === "TimeoutError" ? `did not answer within ${TIMEOUT_MS}ms` : String(err);
    throw new ZernioError(`Zernio ${method} ${path} ${why}`, 0);
  }

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new ZernioError(`Zernio ${method} ${path} returned non-JSON (${res.status}): ${text.slice(0, 200)}`, res.status);
  }

  if (!res.ok) {
    const e = parsed as { error?: string; message?: string; code?: string; param?: string };
    throw new ZernioError(e.error ?? e.message ?? `Zernio ${method} ${path} failed with ${res.status}`, res.status, e.code, e.param);
  }

  /*
   * A 200 is not necessarily a yes (REVIEW.md #3).
   *
   * Zernio answers `{"success": false}` with a 200 when a platform refuses —
   * "comment thread closed", a revoked scope, a post that has been taken down.
   * Read as a success, that turned a refusal into a reply recorded as sent
   * with a null platform id: the comment left the inbox and the customer never
   * got an answer. `tikhub.ts:70` has handled exactly this pattern since it was
   * written; this is the same check, in the one place every call goes through,
   * so `replyToComment`, `hideComment` and `moderateComment` are all covered
   * rather than each remembering separately.
   */
  const envelope = parsed as { success?: boolean; error?: string; message?: string; code?: string };
  if (envelope && typeof envelope === "object" && envelope.success === false) {
    throw new ZernioError(
      envelope.error ?? envelope.message ?? `Zernio ${method} ${path} refused the request`,
      res.status,
      envelope.code,
    );
  }

  return parsed as T;
}

// ---------------------------------------------------------------- accounts

/** One connected account, as Zernio describes it. Only the fields we use. */
export type ZernioAccount = {
  _id: string;
  platform: string;
  username?: string | null;
  displayName?: string | null;
  profilePicture?: string | null;
  profileUrl?: string | null;
  platformUserId?: string | null;
  followersCount?: number | null;
  enabled?: boolean;
  needsReconnection?: boolean;
  tokenExpiresAt?: string | null;
  metadata?: { scope?: string } | null;
};

export type ZernioHealth = {
  accountId: string;
  platform: string;
  username?: string | null;
  displayName?: string | null;
  status: "healthy" | "warning" | "error" | string;
  canPost: boolean;
  canFetchAnalytics: boolean;
  tokenValid: boolean;
  tokenExpiresAt?: string | null;
  needsReconnect: boolean;
  issues: string[];
};

export const listAccounts = () =>
  call<{ accounts: ZernioAccount[] }>("GET", "/accounts").then((r) => r.accounts ?? []);

export const accountHealth = () =>
  call<{ summary: Record<string, number>; accounts: ZernioHealth[] }>("GET", "/accounts/health");

// --------------------------------------------------------------- analytics

/** Per-post numbers. Platforms fill in different subsets; absent is not zero,
 * which is why these stay nullable all the way to the screen. */
export type ZernioPostAnalytics = {
  impressions?: number | null;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  clicks?: number | null;
  views?: number | null;
  follows?: number | null;
  completionRate?: number | null;
  engagementRate?: number | null;
  lastUpdated?: string | null;
};

export type ZernioPost = {
  _id: string;
  content?: string | null;
  status?: string | null;
  publishedAt?: string | null;
  scheduledFor?: string | null;
  platform?: string | null;
  platformPostUrl?: string | null;
  thumbnailUrl?: string | null;
  isExternal?: boolean;
  analytics?: ZernioPostAnalytics | null;
  platforms?: {
    platform: string;
    status?: string | null;
    platformPostId?: string | null;
    platformPostUrl?: string | null;
    accountId?: string | null;
    accountUsername?: string | null;
    errorMessage?: string | null;
    analytics?: ZernioPostAnalytics | null;
  }[];
};

/** One page of posts with their numbers. `limit` is capped at 100 by Zernio,
 * so the caller pages rather than asking for everything at once. */
export const analyticsPage = (query: {
  fromDate?: string;
  toDate?: string;
  platform?: string;
  accountId?: string;
  limit?: number;
  page?: number;
} = {}) =>
  call<{ overview: Record<string, unknown>; posts: ZernioPost[]; pagination?: { page?: number; pages?: number; total?: number } }>(
    "GET",
    "/analytics",
    { query: { ...query, limit: Math.min(query.limit ?? 100, 100) } },
  );

/** Every post in the range, paged through. Bounded so a channel with years of
 * history cannot turn one sync round into a thousand billed requests. */
export async function analyticsAll(
  query: { fromDate?: string; toDate?: string; platform?: string } = {},
  maxPages = 10,
): Promise<ZernioPost[]> {
  const out: ZernioPost[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await analyticsPage({ ...query, limit: 100, page });
    const batch = res.posts ?? [];
    out.push(...batch);
    const pages = Number(res.pagination?.pages ?? 0);
    if (batch.length < 100 || (pages && page >= pages)) break;
  }
  return out;
}

export type ZernioDailyView = {
  date: string;
  views?: number | null;
  estimatedMinutesWatched?: number | null;
  averageViewPercentage?: number | null;
  subscribersGained?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
};

/**
 * Views gained per day for one video, from YouTube Analytics.
 *
 * Per video, not per channel: the endpoint requires a `videoId`. That makes it
 * the expensive call in the module, so it runs once a day in its own job over
 * a bounded set of recent posts rather than on every sync round.
 *
 * YouTube Analytics runs two to three days behind. The screens say so rather
 * than drawing a cliff at the right-hand edge and letting someone read it as a
 * collapse in viewing.
 */
export const youtubeDailyViews = (
  accountId: string,
  videoId: string,
  query: { startDate?: string; endDate?: string } = {},
) =>
  call<{ videoId: string; durationSeconds?: number; totalViews?: number; dailyViews?: ZernioDailyView[] }>(
    "GET",
    "/analytics/youtube/daily-views",
    { query: { accountId, videoId, ...query } },
  );

// ---------------------------------------------------------------- comments

/** A post as the comment inbox lists it: the thing comments hang off. */
export type ZernioInboxPost = {
  id: string;
  accountId: string;
  accountUsername?: string | null;
  platform: string;
  content?: string | null;
  createdTime?: string | null;
  permalink?: string | null;
  picture?: string | null;
  commentCount?: number | null;
  likeCount?: number | null;
};

export type ZernioComment = {
  id: string;
  from?: { id?: string | null; name?: string | null; username?: string | null; picture?: string | null } | null;
  message?: string | null;
  text?: string | null;
  createdTime?: string | null;
  likeCount?: number | null;
  replyCount?: number | null;
  /** Zernio calls this `url` on a comment and `permalink` on a post. */
  url?: string | null;
  permalink?: string | null;
  parentId?: string | null;
  isHidden?: boolean | null;
  /** What this grant may actually do to this comment, per platform. The inbox
   * shows an action only when the platform allows it. */
  canReply?: boolean | null;
  canHide?: boolean | null;
  canDelete?: boolean | null;
  /** Threaded replies come nested rather than as separate rows. */
  replies?: ZernioComment[] | null;
};

/**
 * The posts that have a comment surface, newest first.
 *
 * `minComments` is worth passing: it filters at Zernio's end, so a channel
 * with fifty posts and three comments costs one request rather than fifty.
 */
export const inboxPosts = (query: { limit?: number; accountId?: string; cursor?: string; minComments?: number } = {}) =>
  call<{ data: ZernioInboxPost[]; pagination?: { hasMore?: boolean; nextCursor?: string | null } }>(
    "GET",
    "/inbox/comments",
    { query: { ...query, limit: Math.min(query.limit ?? 100, 100) } },
  );

/**
 * The comments on one post. `accountId` is required — Zernio needs to know
 * which grant to read them with.
 *
 * Note the envelope: the *list* of posts comes back under `data`, but the
 * comments on one post come back under `comments`. Reading the wrong one is a
 * silent empty inbox rather than an error, which is exactly how this was found.
 */
export const postComments = (postId: string, query: { accountId: string; limit?: number; cursor?: string }) =>
  call<{ comments: ZernioComment[]; pagination?: { hasMore?: boolean; cursor?: string | null } }>(
    "GET",
    `/inbox/comments/${encodeURIComponent(postId)}`,
    { query: { ...query, limit: Math.min(query.limit ?? 100, 100) } },
  );

/**
 * Posts a reply, as the studio's own account.
 *
 * Deliberately not exported through anything that a page can reach. The only
 * caller is the server action behind "Approve & send", which requires a named
 * approver first — spec §4.3: nothing leaves without a human approval, and a
 * draft must never read as sent.
 */
export const replyToComment = (postId: string, body: { comment: string; accountId?: string; commentId?: string }) =>
  call<{ id?: string; success?: boolean }>("POST", `/inbox/comments/${encodeURIComponent(postId)}`, { body });

export const hideComment = (postId: string, commentId: string, accountId?: string) =>
  call<{ success?: boolean }>("POST", `/inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/hide`, {
    body: { accountId },
  });

/** Mark as spam / report. Zernio routes this per platform. */
export const moderateComment = (
  postId: string,
  commentId: string,
  body: { action: "spam" | "report" | "reject" | "publish"; accountId?: string },
) =>
  call<{ success?: boolean }>(
    "POST",
    `/inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/moderation`,
    { body },
  );

// ------------------------------------------------------------- publishing

export const createPost = (body: Record<string, unknown>) =>
  call<{ post?: { _id: string }; _id?: string }>("POST", "/posts", { body });

export type ZernioProfile = {
  _id: string;
  name: string;
  isDefault?: boolean;
  accountUsernames?: string[];
};

/** The workspaces Zernio holds for this key. A connection is made into one of
 * them, which is why `connectUrl` cannot be called without asking first. */
export const listProfiles = () => call<{ profiles?: ZernioProfile[] }>("GET", "/profiles");

/** The URL a person visits to connect another platform. Nothing about this is
 * secret, but it is minted server-side so the key never leaves this module. */
export const connectUrl = (platform: string, query: { redirectUrl?: string; profileId?: string } = {}) =>
  call<{ url?: string; authUrl?: string }>("GET", `/connect/${encodeURIComponent(platform)}`, { query });
