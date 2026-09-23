import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { channels, publishLog, publishPosts, publishTargets } from "@/lib/db/schema";
import { createPost as zernioCreatePost, ZernioUnconfigured } from "@/lib/social/zernio";
import { newId } from "@/lib/ids";

/**
 * The only thing in Publish that talks to a platform.
 *
 * Run by the worker, never by a page. Four rules, each of which exists because
 * the alternative has already gone wrong somewhere in this codebase:
 *
 *   1. **Claim before calling.** A target moves to `publishing` in the
 *      statement that checks it is not already publishing or published. Two
 *      workers, or a retry racing the scheduler, therefore produce one call.
 *      The comment-reply flow in Research does not do this, and can post the
 *      same reply twice in public (REVIEW.md #1).
 *   2. **An idempotency key per target and text.** A retry of the same content
 *      is the same key, so a platform that already accepted it returns the
 *      same post rather than making a second one.
 *   3. **A 200 is not a success.** Zernio answers `{"success": false}` with a
 *      200 when a platform refuses, and that refusal is recorded as a failure
 *      with the vendor's own words (REVIEW.md #3).
 *   4. **Every attempt is a row**, written before the state is touched. A
 *      database failure after a successful send leaves a log line saying it
 *      went out, not a post that reads as never having been tried.
 */

/** Zernio's own platform names. Ours come from `/accounts/health`, so they
 * already match; naming the mapping keeps it a stated thing. */
const PLATFORM = (p: string) => p.trim().toLowerCase();

function idempotencyKey(targetId: string, text: string): string {
  return createHash("sha256").update(`${targetId} ${text}`).digest("hex").slice(0, 40);
}

/** The vendor's reply, bounded. A provider that answers with a megabyte of
 * HTML should not put a megabyte into every row of the log screen. */
function boundedResponse(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const text = JSON.stringify(value);
  if (text.length <= 8000) return value as Record<string, unknown>;
  return { truncated: true, head: text.slice(0, 8000) };
}

/**
 * A platform that answered 200 and refused anyway.
 *
 * `ZernioError` carries an HTTP status and an error code, which is the shape
 * of a transport failure. This is a different thing: the call succeeded and
 * the platform said no, and what matters is the envelope it said no in.
 */
class Refusal extends Error {
  constructor(
    message: string,
    readonly envelope: Record<string, unknown>,
  ) {
    super(message);
    this.name = "Refusal";
  }
}

export type SendResult = {
  posted: number;
  failed: number;
  skipped: number;
  errors: string[];
};

export async function sendPost(postId: string, onlyTargetId?: string): Promise<SendResult> {
  const [post] = await db.select().from(publishPosts).where(eq(publishPosts.id, postId)).limit(1);
  if (!post) throw new Error(`publish.send: no post ${postId}`);

  // Approval is the gate, and it is checked here as well as in the action that
  // queued this. A job row is not a permission.
  if (post.state !== "approved" && post.state !== "failed" && post.state !== "publishing") {
    return { posted: 0, failed: 0, skipped: 1, errors: [`post is ${post.state}, not approved`] };
  }

  const targets = await db
    .select({ target: publishTargets, channel: channels })
    .from(publishTargets)
    .innerJoin(channels, eq(channels.id, publishTargets.channelId))
    .where(
      and(
        eq(publishTargets.postId, postId),
        onlyTargetId ? eq(publishTargets.id, onlyTargetId) : undefined,
        ne(publishTargets.state, "published"),
      ),
    );

  if (!targets.length) return { posted: 0, failed: 0, skipped: 0, errors: [] };

  await db
    .update(publishPosts)
    .set({ state: "publishing", updatedAt: new Date() })
    .where(eq(publishPosts.id, postId));

  const result: SendResult = { posted: 0, failed: 0, skipped: 0, errors: [] };

  for (const { target, channel } of targets) {
    const text = target.body ?? post.body;
    const title = target.title ?? post.title;
    const key = idempotencyKey(target.id, text);

    if (!channel.canPost || channel.needsReconnect || !channel.enabled) {
      const reason = !channel.enabled
        ? "that channel is switched off for publishing"
        : channel.needsReconnect
          ? "that connection needs reconnecting"
          : "that connection may not post";
      result.skipped += 1;
      result.errors.push(`${channel.platform}: ${reason}`);
      await record(post.tenantId, target.id, target.attempts + 1, key, "failed", null, reason, null);
      await db
        .update(publishTargets)
        .set({ state: "failed", error: reason, updatedAt: new Date() })
        .where(eq(publishTargets.id, target.id));
      continue;
    }

    // Rule 1: claim it.
    const claimed = await db
      .update(publishTargets)
      .set({ state: "publishing", attempts: target.attempts + 1, error: null, updatedAt: new Date() })
      .where(
        and(
          eq(publishTargets.id, target.id),
          inArray(publishTargets.state, ["draft", "approved", "scheduled", "failed"]),
        ),
      )
      .returning({ id: publishTargets.id, attempts: publishTargets.attempts });

    if (!claimed.length) {
      result.skipped += 1;
      continue;
    }

    const attempt = claimed[0].attempts;
    const started = Date.now();

    try {
      const response = await zernioCreatePost({
        accountIds: [channel.externalId],
        platforms: [PLATFORM(channel.platform)],
        content: text,
        title,
        tags: post.tags,
        idempotencyKey: key,
        ...(post.scheduledFor
          ? { scheduledFor: post.scheduledFor.toISOString() }
          : { publishNow: true }),
        ...(target.options ?? {}),
      });

      const envelope = response as Record<string, unknown> & {
        post?: Record<string, unknown>;
        _id?: string;
      };

      // Rule 3: a 200 carrying `success: false` is a refusal, not a send.
      if (envelope.success === false) {
        const said =
          typeof envelope.message === "string"
            ? envelope.message
            : "the platform refused it, without saying why";
        throw new Refusal(said, envelope);
      }

      const platformPostId =
        (typeof envelope.post?._id === "string" ? envelope.post._id : null) ??
        (typeof envelope._id === "string" ? envelope._id : null);
      const platformUrl =
        (typeof envelope.url === "string" ? envelope.url : null) ??
        (typeof envelope.post?.url === "string" ? envelope.post.url : null);

      await record(
        post.tenantId,
        target.id,
        attempt,
        key,
        "published",
        boundedResponse(envelope),
        null,
        Date.now() - started,
      );
      await db
        .update(publishTargets)
        .set({
          state: "published",
          platformPostId,
          platformUrl,
          error: null,
          publishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(publishTargets.id, target.id));
      result.posted += 1;
    } catch (err) {
      const message =
        err instanceof ZernioUnconfigured
          ? "No publishing key is configured on this deployment."
          : err instanceof Error
            ? err.message
            : String(err);

      // Rule 4: the attempt is written before the state, so a failure here
      // still leaves a record of what was tried.
      await record(
        post.tenantId,
        target.id,
        attempt,
        key,
        "failed",
        err instanceof Refusal ? boundedResponse(err.envelope) : null,
        message,
        Date.now() - started,
      );
      await db
        .update(publishTargets)
        .set({ state: "failed", error: message.slice(0, 2000), updatedAt: new Date() })
        .where(eq(publishTargets.id, target.id));
      result.failed += 1;
      result.errors.push(`${channel.platform}: ${message}`);
    }
  }

  /*
   * The post is published only when every channel is. A partial send stays
   * `failed`, because "published" on a screen has to mean the whole thing is
   * out: a post that reached YouTube and was refused by LinkedIn is not
   * published, and the screen has to be able to say exactly that.
   */
  const after = await db
    .select({ state: publishTargets.state })
    .from(publishTargets)
    .where(eq(publishTargets.postId, postId));

  const allDone = after.length > 0 && after.every((t) => t.state === "published");
  await db
    .update(publishPosts)
    .set({ state: allDone ? "published" : "failed", updatedAt: new Date() })
    .where(eq(publishPosts.id, postId));

  return result;
}

async function record(
  tenantId: string,
  targetId: string,
  attempt: number,
  idempotencyKey: string,
  state: "published" | "failed",
  response: Record<string, unknown> | null,
  error: string | null,
  durationMs: number | null,
) {
  await db.insert(publishLog).values({
    id: newId("job"),
    tenantId,
    targetId,
    attempt,
    idempotencyKey,
    state,
    response,
    error: error?.slice(0, 2000) ?? null,
    durationMs,
  });
}
