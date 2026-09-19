"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { channelPosts, channels, commentDrafts, comments } from "@/lib/db/schema";
import { getViewer, type Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { recordUsage, assertBudget, BudgetStop } from "@/lib/ai/ledger";
import { newId } from "@/lib/ids";
import * as zernio from "@/lib/social/zernio";

/**
 * Acting on a comment.
 *
 * The rule the whole file exists to keep (spec §4.3): **nothing is sent
 * without a named human approval, and a draft never reads as sent.** That is
 * enforced in three places rather than one, because a single check is one
 * refactor away from disappearing:
 *
 *   1. `sentAt` and `platformCommentId` are only ever written by
 *      `approveReplyAction`, and only after Zernio has confirmed the reply.
 *   2. `approvedBy` is the signed-in person, read from the session here —
 *      never taken from the form.
 *   3. The inbox query (`lib/social/service.ts`) refuses to return a draft
 *      that has been sent, so a sent reply cannot render in a draft's place
 *      even if something upstream got it wrong.
 */

async function researcher(): Promise<Viewer | null> {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("research")) return null;
  return viewer;
}

/**
 * Resolves a comment id off the wire to a row in the caller's own studio,
 * together with everything an action against the platform needs.
 *
 * A server action is a public endpoint whatever the screen around it looked
 * like, so an id is a claim until this says otherwise.
 */
async function ownComment(viewer: Viewer, commentId: unknown) {
  if (typeof commentId !== "string" || !commentId || commentId.length > 64) return null;

  const [row] = await db
    .select({
      id: comments.id,
      externalId: comments.externalId,
      state: comments.state,
      body: comments.body,
      language: comments.language,
      postExternalId: channelPosts.externalId,
      postTitle: channelPosts.title,
      channelExternalId: channels.externalId,
      platform: channels.platform,
    })
    .from(comments)
    .innerJoin(channelPosts, eq(channelPosts.id, comments.postId))
    .innerJoin(channels, eq(channels.id, comments.channelId))
    .where(and(eq(comments.id, commentId), eq(comments.tenantId, viewer.tenantId)))
    .limit(1);

  return row ?? null;
}

/** Re-renders the inbox and passes the result through unchanged, so each
 * action keeps its own return type instead of collapsing to a bag of
 * unknowns. */
function done<T>(result: T): T {
  revalidatePath("/research/inbox");
  return result;
}

// --------------------------------------------------------------- approving

/**
 * Approves a draft and sends it.
 *
 * Order matters: the platform call happens *before* `sentAt` is written, so a
 * failure leaves a draft that is still a draft with the provider's own error
 * attached — never a row that claims a reply exists when it does not.
 */
export async function approveReplyAction(draftId: unknown, editedBody?: unknown) {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  if (typeof draftId !== "string" || !draftId || draftId.length > 64) return { error: "Not allowed" };

  const [draft] = await db
    .select({ id: commentDrafts.id, commentId: commentDrafts.commentId, body: commentDrafts.body, sentAt: commentDrafts.sentAt })
    .from(commentDrafts)
    .where(and(eq(commentDrafts.id, draftId), eq(commentDrafts.tenantId, viewer.tenantId)))
    .limit(1);

  if (!draft) return { error: "Not allowed" };
  if (draft.sentAt) return { error: "That reply has already been sent." };

  const comment = await ownComment(viewer, draft.commentId);
  if (!comment) return { error: "Not allowed" };

  const body = typeof editedBody === "string" && editedBody.trim() ? editedBody.trim() : draft.body;
  if (!body) return { error: "There is nothing to send." };
  if (body.length > 10_000) return { error: "That reply is too long." };

  const edited = body !== draft.body;
  const approvedAt = new Date();

  try {
    const res = await zernio.replyToComment(comment.postExternalId, {
      comment: body,
      accountId: comment.channelExternalId,
      commentId: comment.externalId,
    });

    await db
      .update(commentDrafts)
      .set({
        body,
        ...(edited ? { editedBy: viewer.id, editedAt: approvedAt } : {}),
        approvedBy: viewer.id,
        approvedAt,
        sentAt: new Date(),
        platformCommentId: res.id ?? null,
        error: null,
      })
      .where(eq(commentDrafts.id, draft.id));

    await db
      .update(comments)
      .set({ state: "replied", actedBy: viewer.id, actedAt: new Date() })
      .where(eq(comments.id, comment.id));

    await audit(viewer, "comment.reply.send", {
      objectType: "comment",
      objectId: comment.id,
      module: "research",
      meta: { platform: comment.platform, edited },
    });

    return done({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The draft stays a draft. Keeping the provider's own words is the whole
    // point — "could not send" does not tell anyone that a token expired.
    await db.update(commentDrafts).set({ body, error: message.slice(0, 500) }).where(eq(commentDrafts.id, draft.id));
    await audit(viewer, "comment.reply.fail", {
      objectType: "comment",
      objectId: comment.id,
      module: "research",
      meta: { error: message.slice(0, 200) },
    });
    return done({ error: message });
  }
}

/** Saves an edit without sending. A draft that has been touched by a person
 * still needs approving. */
export async function editDraftAction(draftId: unknown, body: unknown) {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  if (typeof draftId !== "string" || typeof body !== "string") return { error: "Not allowed" };
  if (!body.trim()) return { error: "A reply cannot be empty." };
  if (body.length > 10_000) return { error: "That reply is too long." };

  const { rowCount } = await db
    .update(commentDrafts)
    .set({ body: body.trim(), editedBy: viewer.id, editedAt: new Date(), error: null })
    .where(
      and(
        eq(commentDrafts.id, draftId),
        eq(commentDrafts.tenantId, viewer.tenantId),
        isNull(commentDrafts.sentAt),
      ),
    );

  if (!rowCount) return { error: "That draft has already been sent or withdrawn." };
  return done({ ok: true });
}

/** Throws the draft away. The comment stays open. */
export async function discardDraftAction(draftId: unknown) {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  if (typeof draftId !== "string") return { error: "Not allowed" };

  await db
    .update(commentDrafts)
    .set({ discardedBy: viewer.id, discardedAt: new Date() })
    .where(
      and(eq(commentDrafts.id, draftId), eq(commentDrafts.tenantId, viewer.tenantId), isNull(commentDrafts.sentAt)),
    );

  return done({ ok: true });
}

// -------------------------------------------------------------- redrafting

const REDRAFT_PROMPT = `You write replies a Hong Kong video studio could post under its own videos.

Reply in the SAME language and register as the comment. At most two sentences. Warm and specific, never salesy. Never promise a date or a fact you were not given. Answer with the reply text alone — no quotes, no preamble, no explanation.`;

/**
 * Writes another draft, optionally steered ("shorter", "in Cantonese",
 * "point them at the sales inbox").
 *
 * Charged to the person who asked for it, and refused when they are over
 * budget — the same rule as any other model call (spec §5).
 */
export async function regenerateDraftAction(commentId: unknown, steer?: unknown) {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };

  const comment = await ownComment(viewer, commentId);
  if (!comment) return { error: "Not allowed" };

  try {
    await assertBudget(viewer);
  } catch (err) {
    if (err instanceof BudgetStop) return { error: err.message };
    throw err;
  }

  const instruction = typeof steer === "string" && steer.trim() ? steer.trim().slice(0, 300) : null;
  const model = modelFor.utility();

  try {
    const out = await complete({
      model,
      temperature: 0.7,
      maxTokens: 300,
      messages: [
        { role: "system", content: REDRAFT_PROMPT },
        {
          role: "user",
          content: [
            `Video: ${comment.postTitle || "(untitled)"}`,
            `Comment: ${comment.body.slice(0, 2000)}`,
            instruction ? `The studio asks for: ${instruction}` : null,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });

    await recordUsage({
      viewer,
      module: "research",
      provider: out.provider ?? "openrouter",
      model: out.model,
      promptTokens: out.promptTokens,
      completionTokens: out.completionTokens,
      costMicros: out.costMicros,
      requestId: out.requestId,
    });

    const body = out.text.trim();
    if (!body) return { error: "The model returned nothing to send." };

    // Previous unsent drafts for this comment are withdrawn, so the inbox
    // never shows two things a person might think are both waiting.
    await db
      .update(commentDrafts)
      .set({ discardedBy: viewer.id, discardedAt: new Date() })
      .where(and(eq(commentDrafts.commentId, comment.id), isNull(commentDrafts.sentAt), isNull(commentDrafts.discardedAt)));

    await db.insert(commentDrafts).values({
      id: newId("cd"),
      tenantId: viewer.tenantId,
      commentId: comment.id,
      body,
      model: out.model,
      costMicros: out.costMicros,
    });

    return done({ ok: true });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not draft a reply" };
  }
}

// -------------------------------------------------------------- moderating

type Moderation = "hide" | "spam" | "ignore";

/**
 * Hides, reports or sets aside a comment.
 *
 * `ignore` is local — it takes the comment out of the inbox without touching
 * the platform, which is what someone means when they say "I have read this".
 * The other two act on the platform, and are recorded with the name of the
 * person who did it: hiding what someone said is an action with an author.
 */
export async function moderateCommentAction(commentId: unknown, action: unknown) {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  if (action !== "hide" && action !== "spam" && action !== "ignore") return { error: "Not allowed" };

  const comment = await ownComment(viewer, commentId);
  if (!comment) return { error: "Not allowed" };

  const state: Record<Moderation, "hidden" | "spam" | "ignored"> = {
    hide: "hidden",
    spam: "spam",
    ignore: "ignored",
  };

  if (action !== "ignore") {
    try {
      if (action === "hide") {
        await zernio.hideComment(comment.postExternalId, comment.externalId, comment.channelExternalId);
      } else {
        await zernio.moderateComment(comment.postExternalId, comment.externalId, {
          action: "spam",
          accountId: comment.channelExternalId,
        });
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : "The platform refused that" };
    }
  }

  await db
    .update(comments)
    .set({ state: state[action], actedBy: viewer.id, actedAt: new Date() })
    .where(eq(comments.id, comment.id));

  await audit(viewer, `comment.${action}`, {
    objectType: "comment",
    objectId: comment.id,
    module: "research",
    meta: { platform: comment.platform },
  });

  return done({ ok: true });
}

/**
 * The same, for a selection.
 *
 * Applied one at a time on purpose: the platforms have no bulk endpoint, and
 * pretending otherwise would mean a partial failure reported as a success.
 * The count of what actually happened comes back.
 */
export async function bulkModerateAction(commentIds: unknown, action: unknown) {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };
  if (!Array.isArray(commentIds) || !commentIds.length) return { error: "Nothing selected" };
  if (commentIds.length > 100) return { error: "Too many at once. Select fewer than 100." };
  if (action !== "hide" && action !== "spam" && action !== "ignore") return { error: "Not allowed" };

  let ok = 0;
  const failures: string[] = [];

  for (const id of commentIds) {
    const res = await moderateCommentAction(id, action);
    if ("error" in res && res.error) failures.push(res.error);
    else ok++;
  }

  return done({ ok, failed: failures.length, firstError: failures[0] ?? null });
}

// ------------------------------------------------------------------ syncing

/** Pulls new comments now rather than waiting for the schedule. Queued, not
 * run inline: the vendor rate-limits, and a page must not wait on it. */
export async function syncNowAction() {
  const viewer = await researcher();
  if (!viewer) return { error: "Not allowed" };

  const { enqueue } = await import("@/lib/jobs/queue");
  for (const type of ["social.syncChannels", "social.syncPosts", "social.syncComments", "social.classifyComments"] as const) {
    await enqueue({ tenantId: viewer.tenantId, type, module: "research", createdBy: viewer.id, dedupeKey: type });
  }
  return done({ ok: true });
}

/** Comments waiting on a given set of posts, used by the inbox to refresh one
 * group without reloading the page. */
export async function draftsForAction(commentIds: string[]) {
  const viewer = await researcher();
  if (!viewer || !commentIds.length) return { drafts: [] };

  const rows = await db
    .select({ id: commentDrafts.id, commentId: commentDrafts.commentId, body: commentDrafts.body })
    .from(commentDrafts)
    .where(
      and(
        eq(commentDrafts.tenantId, viewer.tenantId),
        inArray(commentDrafts.commentId, commentIds.slice(0, 300)),
        isNull(commentDrafts.sentAt),
        isNull(commentDrafts.discardedAt),
      ),
    )
    .orderBy(desc(commentDrafts.createdAt));

  return { drafts: rows };
}
