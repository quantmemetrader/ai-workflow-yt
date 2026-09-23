import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  approvals,
  channels,
  files,
  publishLog,
  publishPosts,
  publishTargets,
  users,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { enqueue } from "@/lib/jobs/queue";
import { connectUrl, listProfiles } from "@/lib/social/zernio";
import { CONNECTABLE, checkForPlatform, specFor } from "@/lib/publish/platforms";
import { env } from "@/lib/env";

/**
 * Publish (spec §4.6), the part that never touches a vendor.
 *
 * Everything here is SQL. The only thing that talks to Zernio is the job in
 * `lib/publish/dispatch.ts`, run by the worker — the same rule the Research
 * module follows, and for the same two reasons: the vendor bills per request,
 * and a page render that posts to a platform is a page render that can publish
 * something twice.
 *
 * The module's promise is one sentence: **nothing leaves without an approval
 * record naming a person.** That is enforced in `approveAndQueue` below, which
 * is the only path from `awaiting_approval` to a queued job, and the state is
 * claimed in the same statement that reads it so two people pressing Approve
 * cannot both queue it.
 */

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
  needsReconnect: boolean;
  tokenExpiresAt: Date | null;
  /** Decided here rather than in the component: "expiring soon" is a reading
   * of the clock, and a render that reads the clock is a render that differs
   * between the server and the browser. */
  tokenExpiresSoon: boolean;
  issues: string[];
  enabled: boolean;
  syncedAt: Date | null;
  lastError: string | null;
};

export type TargetRow = {
  id: string;
  channelId: string;
  platform: string;
  channelName: string;
  title: string | null;
  body: string | null;
  state: string;
  platformUrl: string | null;
  error: string | null;
  attempts: number;
  publishedAt: Date | null;
  /** The platform's own extras: category, first comment, visibility. */
  options: Record<string, unknown>;
};

export type PostRow = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  state: string;
  scheduledFor: Date | null;
  fileId: string | null;
  fileName: string | null;
  ownerName: string | null;
  updatedAt: Date;
  targets: TargetRow[];
  /** The live approval, if one has been asked for. */
  approval: {
    id: string;
    state: string;
    /** Who asked. The queue needs the id, not the name: the person who asked
     * for an approval must not be the person who grants it, and two people can
     * share a name. */
    requestedById: string;
    requestedByName: string | null;
    approverName: string | null;
    decidedByName: string | null;
    decidedAt: Date | null;
    note: string | null;
  } | null;
};

/* -------------------------------------------------------------- channels */

export async function listChannels(viewer: Viewer): Promise<ChannelRow[]> {
  const soon = Date.now() + 7 * 86_400_000;
  const rows = await db
    .select()
    .from(channels)
    .where(eq(channels.tenantId, viewer.tenantId))
    .orderBy(asc(channels.platform), asc(channels.username));

  return rows.map((c) => ({
    id: c.id,
    platform: c.platform,
    username: c.username,
    displayName: c.displayName,
    avatarUrl: c.avatarUrl,
    profileUrl: c.profileUrl,
    followers: c.followers,
    status: c.status,
    canPost: c.canPost,
    needsReconnect: c.needsReconnect,
    tokenExpiresAt: c.tokenExpiresAt,
    tokenExpiresSoon: c.tokenExpiresAt !== null && c.tokenExpiresAt.getTime() < soon,
    issues: c.issues,
    enabled: c.enabled,
    syncedAt: c.syncedAt,
    lastError: c.lastError,
  }));
}

/**
 * Where to send somebody to connect one of their own channels.
 *
 * Publish could list channels and switch them off, and there was no way to add
 * one: `zernio.connectUrl` existed and nothing called it, so a studio with a
 * new channel had to go to the vendor's own dashboard to attach it.
 *
 * The URL is minted here rather than in the browser because the key is here.
 * Nothing is written down until the person comes back and "Check now" reads
 * the grant from the platform — this only opens the consent screen.
 */
export async function connectChannelUrl(
  viewer: Viewer,
  platform: string,
): Promise<{ url: string } | { error: string }> {
  const chosen = String(platform).trim().toLowerCase();
  if (!(CONNECTABLE as readonly string[]).includes(chosen)) return { error: "Unknown platform" };

  try {
    const { profiles } = await listProfiles();
    // The key's default workspace, or its only one. A key with none cannot
    // hold a connection at all, and saying so beats a vendor 400.
    const profile = profiles?.find((p) => p.isDefault) ?? profiles?.[0];
    if (!profile) return { error: "Zernio has no workspace for this key to connect into." };

    const res = await connectUrl(chosen, {
      profileId: profile._id,
      redirectUrl: `${env.appUrl}/publish?connected=${encodeURIComponent(chosen)}`,
    });
    const url = res.authUrl ?? res.url;
    if (!url) return { error: "Zernio did not return a consent link." };

    await audit(viewer, "channel.connect.start", {
      objectType: "channel",
      objectId: chosen,
      module: "publish",
      meta: { platform: chosen, profile: profile.name },
    });
    return { url };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Zernio could not be reached." };
  }
}

/** Turn a channel off for publishing without disconnecting it at the vendor. */
export async function setChannelEnabled(viewer: Viewer, channelId: string, enabled: boolean) {
  await db
    .update(channels)
    .set({ enabled })
    .where(and(eq(channels.id, channelId), eq(channels.tenantId, viewer.tenantId)));
  await audit(viewer, enabled ? "publish.channel.enable" : "publish.channel.disable", {
    objectType: "channel",
    objectId: channelId,
    module: "publish",
  });
}

/* ----------------------------------------------------------------- posts */

const STATES = [
  "draft",
  "awaiting_approval",
  "approved",
  "scheduled",
  "publishing",
  "published",
  "failed",
  "cancelled",
] as const;
export type PublishState = (typeof STATES)[number];

/**
 * Every post, with its channels and its approval, in three queries.
 *
 * Not one query per post for the targets: the composer shows a dozen posts and
 * each has up to eight channels, and the Research module already learned what
 * a per-row fan-out costs against a database in Singapore.
 */
export async function listPosts(
  viewer: Viewer,
  options: { state?: PublishState | null; limit?: number } = {},
): Promise<PostRow[]> {
  const limit = Math.min(options.limit ?? 60, 200);

  const posts = await db
    .select({
      post: publishPosts,
      fileName: files.name,
      ownerName: users.name,
      ownerNameLocal: users.nameLocal,
    })
    .from(publishPosts)
    .leftJoin(files, eq(files.id, publishPosts.fileId))
    .leftJoin(users, eq(users.id, publishPosts.ownerId))
    .where(
      and(
        eq(publishPosts.tenantId, viewer.tenantId),
        isNull(publishPosts.deletedAt),
        options.state ? eq(publishPosts.state, options.state) : undefined,
      ),
    )
    .orderBy(desc(publishPosts.updatedAt))
    .limit(limit);

  if (!posts.length) return [];
  const ids = posts.map((p) => p.post.id);

  const [targets, live] = await Promise.all([
    db
      .select({
        target: publishTargets,
        platform: channels.platform,
        username: channels.username,
        displayName: channels.displayName,
      })
      .from(publishTargets)
      .innerJoin(channels, eq(channels.id, publishTargets.channelId))
      .where(inArray(publishTargets.postId, ids)),

    db
      .select({
        approval: approvals,
        requestedByName: sql<string | null>`requester.name`,
        approverName: sql<string | null>`approver.name`,
        decidedByName: sql<string | null>`decider.name`,
      })
      .from(approvals)
      .leftJoin(sql`${users} as requester`, sql`requester.id = ${approvals.requestedBy}`)
      .leftJoin(sql`${users} as approver`, sql`approver.id = ${approvals.approverId}`)
      .leftJoin(sql`${users} as decider`, sql`decider.id = ${approvals.decidedBy}`)
      .where(
        and(
          eq(approvals.tenantId, viewer.tenantId),
          eq(approvals.objectType, "publish_post"),
          inArray(approvals.objectId, ids),
        ),
      )
      .orderBy(desc(approvals.requestedAt)),
  ]);

  const byPost = new Map<string, TargetRow[]>();
  for (const t of targets) {
    const list = byPost.get(t.target.postId) ?? [];
    list.push({
      id: t.target.id,
      channelId: t.target.channelId,
      platform: t.platform,
      channelName: t.displayName ?? t.username ?? t.platform,
      title: t.target.title,
      body: t.target.body,
      state: t.target.state,
      platformUrl: t.target.platformUrl,
      error: t.target.error,
      attempts: t.target.attempts,
      publishedAt: t.target.publishedAt,
      options: t.target.options ?? {},
    });
    byPost.set(t.target.postId, list);
  }

  // The newest approval per post wins; the query is already newest first.
  const approvalByPost = new Map<string, (typeof live)[number]>();
  for (const a of live) {
    if (!approvalByPost.has(a.approval.objectId)) approvalByPost.set(a.approval.objectId, a);
  }

  return posts.map((p) => {
    const a = approvalByPost.get(p.post.id);
    return {
      id: p.post.id,
      title: p.post.title,
      body: p.post.body,
      tags: p.post.tags,
      state: p.post.state,
      scheduledFor: p.post.scheduledFor,
      fileId: p.post.fileId,
      fileName: p.fileName,
      ownerName: p.ownerNameLocal ?? p.ownerName,
      updatedAt: p.post.updatedAt,
      targets: byPost.get(p.post.id) ?? [],
      approval: a
        ? {
            id: a.approval.id,
            state: a.approval.state,
            requestedById: a.approval.requestedBy,
            requestedByName: a.requestedByName,
            approverName: a.approverName,
            decidedByName: a.decidedByName,
            decidedAt: a.approval.decidedAt,
            note: a.approval.note,
          }
        : null,
    };
  });
}

export async function createPost(
  viewer: Viewer,
  input: { title: string; body?: string; tags?: string[]; fileId?: string | null; channelIds: string[] },
) {
  const title = input.title.trim();
  if (!title) throw new Error("A post needs a title");
  if (title.length > 300) throw new Error("That title is too long");

  const id = newId("post");
  await db.insert(publishPosts).values({
    id,
    tenantId: viewer.tenantId,
    title,
    body: (input.body ?? "").slice(0, 20_000),
    tags: (input.tags ?? []).slice(0, 30),
    fileId: input.fileId ?? null,
    ownerId: viewer.id,
  });

  await setTargets(viewer, id, input.channelIds);

  await audit(viewer, "publish.post.create", {
    objectType: "publish_post",
    objectId: id,
    module: "publish",
    meta: { title, channels: input.channelIds.length },
  });
  return id;
}

/** Which channels a post goes to. Channels removed here lose their overrides,
 * which is the honest reading of "this is not going there any more". */
export async function setTargets(viewer: Viewer, postId: string, channelIds: string[]) {
  const post = await postById(viewer, postId);
  if (!post) throw new Error("That post does not exist");
  if (post.state === "published" || post.state === "publishing") {
    throw new Error("This post has already gone out; its channels cannot change");
  }

  const valid = channelIds.length
    ? await db
        .select({ id: channels.id })
        .from(channels)
        .where(
          and(
            eq(channels.tenantId, viewer.tenantId),
            eq(channels.enabled, true),
            inArray(channels.id, channelIds),
          ),
        )
    : [];

  const wanted = new Set(valid.map((c) => c.id));
  const existing = await db
    .select({ id: publishTargets.id, channelId: publishTargets.channelId, state: publishTargets.state })
    .from(publishTargets)
    .where(eq(publishTargets.postId, postId));

  // Never remove a target that has already gone out: the log has to keep
  // pointing at something.
  const removable = existing
    .filter((t) => !wanted.has(t.channelId) && t.state !== "published")
    .map((t) => t.id);
  if (removable.length) {
    await db.delete(publishTargets).where(inArray(publishTargets.id, removable));
  }

  const have = new Set(existing.map((t) => t.channelId));
  const toAdd = [...wanted].filter((c) => !have.has(c));
  if (toAdd.length) {
    await db
      .insert(publishTargets)
      .values(toAdd.map((channelId) => ({ id: newId("tgt"), postId, channelId })))
      .onConflictDoNothing();
  }
}

export async function postById(viewer: Viewer, postId: string) {
  if (typeof postId !== "string" || !postId || postId.length > 64) return null;
  const [row] = await db
    .select()
    .from(publishPosts)
    .where(
      and(
        eq(publishPosts.id, postId),
        eq(publishPosts.tenantId, viewer.tenantId),
        isNull(publishPosts.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function updatePost(
  viewer: Viewer,
  postId: string,
  input: { title?: string; body?: string; tags?: string[]; scheduledFor?: Date | null },
) {
  const post = await postById(viewer, postId);
  if (!post) throw new Error("That post does not exist");
  if (post.state === "published" || post.state === "publishing") {
    throw new Error("This post has already gone out and cannot be edited");
  }

  await db
    .update(publishPosts)
    .set({
      ...(input.title !== undefined ? { title: input.title.trim().slice(0, 300) } : {}),
      ...(input.body !== undefined ? { body: input.body.slice(0, 20_000) } : {}),
      ...(input.tags !== undefined ? { tags: input.tags.slice(0, 30) } : {}),
      ...(input.scheduledFor !== undefined ? { scheduledFor: input.scheduledFor } : {}),
      updatedAt: new Date(),
    })
    .where(eq(publishPosts.id, postId));
}

/** One channel's override. Null clears it and follows the master again. */
export async function setOverride(
  viewer: Viewer,
  targetId: string,
  input: { title?: string | null; body?: string | null },
) {
  const [target] = await db
    .select({ target: publishTargets, tenantId: publishPosts.tenantId, state: publishPosts.state })
    .from(publishTargets)
    .innerJoin(publishPosts, eq(publishPosts.id, publishTargets.postId))
    .where(eq(publishTargets.id, targetId))
    .limit(1);

  if (!target || target.tenantId !== viewer.tenantId) throw new Error("Not found");
  if (target.state === "published" || target.state === "publishing") {
    throw new Error("This post has already gone out and cannot be edited");
  }

  await db
    .update(publishTargets)
    .set({
      ...(input.title !== undefined ? { title: input.title?.slice(0, 300) ?? null } : {}),
      ...(input.body !== undefined ? { body: input.body?.slice(0, 20_000) ?? null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(publishTargets.id, targetId));
}

/* ------------------------------------------------------------- approvals */

export async function requestApproval(
  viewer: Viewer,
  postId: string,
  approverId: string | null,
  note: string | null,
) {
  const post = await postById(viewer, postId);
  if (!post) throw new Error("That post does not exist");
  if (post.state !== "draft" && post.state !== "failed") {
    throw new Error("This post is already in the queue");
  }

  const targets = await db
    .select({ id: publishTargets.id })
    .from(publishTargets)
    .where(eq(publishTargets.postId, postId));
  if (!targets.length) throw new Error("Choose at least one channel before asking for approval");

  /*
   * Refused here rather than at send time.
   *
   * A post 400 characters over X's limit is not going to be published, and
   * letting it into the queue means somebody approves it, the worker tries it,
   * and the failure surfaces in the publish log an hour later with their name
   * on the approval. The platforms' own limits are in `platforms.ts`, and the
   * check is a stop only for the ones that are certain — length and emptiness.
   * Everything softer is a warning the composer shows and this ignores.
   */
  const blocking = await checkTargets(postId);
  if (blocking.length) {
    throw new Error(
      `This cannot be published as written:\n${blocking.map((b) => `· ${b.channelName}: ${b.text}`).join("\n")}`,
    );
  }

  // Nothing leaves without a named *person* saying so (§4.6): an approver id
  // is checked, and an AI employee is never one — it cannot sign in to decide.
  if (approverId) {
    const [approver] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, approverId), eq(users.tenantId, viewer.tenantId), eq(users.status, "active"), eq(users.isAgent, false), isNull(users.deletedAt)))
      .limit(1);
    if (!approver) throw new Error("Choose a person in this studio to approve it");
  }

  const id = newId("apr");
  await db.insert(approvals).values({
    id,
    tenantId: viewer.tenantId,
    objectType: "publish_post",
    objectId: postId,
    requestedBy: viewer.id,
    approverId,
    note,
  });

  await db
    .update(publishPosts)
    .set({ state: "awaiting_approval", updatedAt: new Date() })
    .where(eq(publishPosts.id, postId));

  await audit(viewer, "publish.approval.request", {
    objectType: "publish_post",
    objectId: postId,
    module: "publish",
    meta: { approverId },
  });
  return id;
}

/**
 * What the platforms would refuse, per channel.
 *
 * Read by the composer to show a warning and by `requestApproval` to stop one.
 * Each target is checked against its *own* text — the override if it has one,
 * the master if not — because that is what would actually be sent.
 */
export async function checkTargets(
  postId: string,
): Promise<{ channelName: string; platform: string; level: "error" | "warning"; text: string; textZh: string }[]> {
  const [post] = await db.select().from(publishPosts).where(eq(publishPosts.id, postId)).limit(1);
  if (!post) return [];

  const rows = await db
    .select({ t: publishTargets, platform: channels.platform, name: channels.displayName, username: channels.username })
    .from(publishTargets)
    .innerJoin(channels, eq(channels.id, publishTargets.channelId))
    .where(eq(publishTargets.postId, postId));

  return rows.flatMap((r) =>
    checkForPlatform(r.platform, {
      title: r.t.title ?? post.title,
      body: r.t.body ?? post.body,
      tags: r.t.tags ?? post.tags,
    }).map((issue) => ({
      channelName: r.name ?? r.username ?? r.platform,
      platform: r.platform,
      level: issue.level,
      text: issue.text,
      textZh: issue.textZh,
    })),
  );
}

/**
 * Per-platform extras: YouTube's category, Instagram's first comment, and the
 * rest. Stored on the target because they are per channel, and shapeless
 * because each platform's extras are its own.
 */
export async function setTargetOptions(
  viewer: Viewer,
  targetId: string,
  options: Record<string, unknown>,
) {
  const [row] = await db
    .select({ postId: publishTargets.postId, platform: channels.platform })
    .from(publishTargets)
    .innerJoin(channels, eq(channels.id, publishTargets.channelId))
    .where(eq(publishTargets.id, targetId))
    .limit(1);
  if (!row) throw new Error("That channel is not on this post");

  const post = await postById(viewer, row.postId);
  if (!post) throw new Error("Not allowed");
  if (post.state !== "draft" && post.state !== "failed") {
    throw new Error("This post is already in the queue");
  }

  /* Only the keys this platform actually asks for. A model or a stale form
     sending `visibility` to YouTube would otherwise be stored and sent. */
  const spec = specFor(row.platform);
  const allowed = new Set((spec?.fields ?? []).map((f) => f.key));
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(options)) {
    if (!allowed.has(k)) continue;
    clean[k] = typeof v === "string" ? v.slice(0, 2200) : typeof v === "boolean" ? v : String(v).slice(0, 200);
  }

  await db.update(publishTargets).set({ options: clean, updatedAt: new Date() }).where(eq(publishTargets.id, targetId));
  await audit(viewer, "publish.target.options", {
    objectType: "publish_post",
    objectId: row.postId,
    module: "publish",
    meta: { platform: row.platform, keys: Object.keys(clean) },
  });
}

/**
 * Approve, and queue the send.
 *
 * The post's state is claimed in the same statement that checks it. Two people
 * pressing Approve at the same moment therefore produce one queued job and one
 * "already approved", rather than two identical posts under the same video —
 * the failure the Research module's reply flow actually hit.
 */
export async function approveAndQueue(viewer: Viewer, postId: string, note: string | null) {
  /*
   * The person who asked is not the person who approves.
   *
   * The spec wants an approval record naming somebody. A record naming the
   * author is a rubber stamp with extra steps, so it is refused here rather
   * than only hidden on the screen: the action is a public endpoint.
   */
  const [pending] = await db
    .select({ requestedBy: approvals.requestedBy })
    .from(approvals)
    .where(
      and(
        eq(approvals.tenantId, viewer.tenantId),
        eq(approvals.objectType, "publish_post"),
        eq(approvals.objectId, postId),
        eq(approvals.state, "requested"),
      ),
    )
    .orderBy(desc(approvals.requestedAt))
    .limit(1);

  if (pending && pending.requestedBy === viewer.id) {
    throw new Error("Somebody other than the person who asked has to approve this");
  }

  const claimed = await db
    .update(publishPosts)
    .set({ state: "approved", updatedAt: new Date() })
    .where(
      and(
        eq(publishPosts.id, postId),
        eq(publishPosts.tenantId, viewer.tenantId),
        eq(publishPosts.state, "awaiting_approval"),
      ),
    )
    .returning({ id: publishPosts.id, scheduledFor: publishPosts.scheduledFor });

  if (!claimed.length) throw new Error("That post is not waiting for approval any more");

  await db
    .update(approvals)
    .set({ state: "approved", decidedBy: viewer.id, decidedAt: new Date(), note })
    .where(
      and(
        eq(approvals.objectType, "publish_post"),
        eq(approvals.objectId, postId),
        eq(approvals.state, "requested"),
      ),
    );

  await audit(viewer, "publish.approval.approve", {
    objectType: "publish_post",
    objectId: postId,
    module: "publish",
  });

  // Every outbound call is a job (spec §6). The dedupe key is the post, so a
  // second approval of the same post cannot enqueue a second send.
  await enqueue({
    tenantId: viewer.tenantId,
    type: "publish.send",
    module: "publish",
    payload: { postId },
    createdBy: viewer.id,
    dedupeKey: `publish:${postId}`,
    priority: 3,
    runAfter: claimed[0].scheduledFor ?? undefined,
  });

  return { queued: true, scheduledFor: claimed[0].scheduledFor };
}

export async function rejectApproval(viewer: Viewer, postId: string, note: string | null) {
  const claimed = await db
    .update(publishPosts)
    .set({ state: "draft", updatedAt: new Date() })
    .where(
      and(
        eq(publishPosts.id, postId),
        eq(publishPosts.tenantId, viewer.tenantId),
        eq(publishPosts.state, "awaiting_approval"),
      ),
    )
    .returning({ id: publishPosts.id });
  if (!claimed.length) throw new Error("That post is not waiting for approval any more");

  await db
    .update(approvals)
    .set({ state: "rejected", decidedBy: viewer.id, decidedAt: new Date(), note })
    .where(
      and(
        eq(approvals.objectType, "publish_post"),
        eq(approvals.objectId, postId),
        eq(approvals.state, "requested"),
      ),
    );

  await audit(viewer, "publish.approval.reject", {
    objectType: "publish_post",
    objectId: postId,
    module: "publish",
    meta: { note },
  });
}

/* ------------------------------------------------------------------- log */

export type LogRow = {
  id: string;
  at: Date;
  attempt: number;
  state: string;
  error: string | null;
  postId: string;
  postTitle: string;
  platform: string;
  channelName: string;
  platformUrl: string | null;
  actorName: string | null;
  durationMs: number | null;
};

export async function listLog(viewer: Viewer, limit = 80): Promise<LogRow[]> {
  const rows = await db
    .select({
      log: publishLog,
      postId: publishPosts.id,
      postTitle: publishPosts.title,
      platform: channels.platform,
      username: channels.username,
      displayName: channels.displayName,
      platformUrl: publishTargets.platformUrl,
      actorName: users.name,
    })
    .from(publishLog)
    .innerJoin(publishTargets, eq(publishTargets.id, publishLog.targetId))
    .innerJoin(publishPosts, eq(publishPosts.id, publishTargets.postId))
    .innerJoin(channels, eq(channels.id, publishTargets.channelId))
    .leftJoin(users, eq(users.id, publishLog.actorId))
    .where(eq(publishLog.tenantId, viewer.tenantId))
    .orderBy(desc(publishLog.at))
    .limit(Math.min(limit, 300));

  return rows.map((r) => ({
    id: r.log.id,
    at: r.log.at,
    attempt: r.log.attempt,
    state: r.log.state,
    error: r.log.error,
    postId: r.postId,
    postTitle: r.postTitle,
    platform: r.platform,
    channelName: r.displayName ?? r.username ?? r.platform,
    platformUrl: r.platformUrl,
    actorName: r.actorName,
    durationMs: r.log.durationMs,
  }));
}

/** Retry one channel that refused. Safe because the job carries an
 * idempotency key the platform has already seen. */
export async function retryTarget(viewer: Viewer, targetId: string) {
  const [row] = await db
    .select({ target: publishTargets, tenantId: publishPosts.tenantId, postId: publishPosts.id })
    .from(publishTargets)
    .innerJoin(publishPosts, eq(publishPosts.id, publishTargets.postId))
    .where(eq(publishTargets.id, targetId))
    .limit(1);

  if (!row || row.tenantId !== viewer.tenantId) throw new Error("Not found");
  if (row.target.state === "published") throw new Error("That one already went out");

  await enqueue({
    tenantId: viewer.tenantId,
    type: "publish.send",
    module: "publish",
    payload: { postId: row.postId, targetId },
    createdBy: viewer.id,
    dedupeKey: `publish:${targetId}:retry:${row.target.attempts}`,
    priority: 3,
  });

  await audit(viewer, "publish.retry", {
    objectType: "publish_post",
    objectId: row.postId,
    module: "publish",
    meta: { targetId },
  });
}

/** Counts for the tab strip. One group-by, not four counts. */
export async function stateCounts(viewer: Viewer) {
  const rows = await db
    .select({ state: publishPosts.state, n: sql<number>`count(*)::int` })
    .from(publishPosts)
    .where(and(eq(publishPosts.tenantId, viewer.tenantId), isNull(publishPosts.deletedAt)))
    .groupBy(publishPosts.state);

  const out: Record<string, number> = {};
  let all = 0;
  for (const r of rows) {
    out[r.state] = r.n;
    all += r.n;
  }
  out.all = all;
  return out;
}
