"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getViewer, type Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { BudgetStop } from "@/lib/ai/ledger";
import {
  articleFromScript,
  createArticle,
  cutVersion,
  decideApproval,
  ownArticle,
  publishArticle,
  removeArticle,
  requestApproval,
  restoreVersion,
  retractPublication,
  saveArticle,
} from "@/lib/article/service";
import { draftArticle } from "@/lib/article/ai";

/**
 * Everything the Article screen can do.
 *
 * The same two rules the Script actions run on, for the same reasons:
 *
 *   — **A server action is a public endpoint.** Every one of these re-reads
 *     the viewer, re-checks the module, and resolves the id it was handed to a
 *     row in the caller's own studio before touching anything.
 *   — **A published article is read-only.** The check lives in
 *     `lib/article/service.ts` so it cannot be forgotten here, and the actions
 *     that would edit one simply fail.
 *
 * Article is gated on the Script module: it is the writing module's other
 * surface, not a twelfth entitlement for an admin to discover and grant.
 */

async function writer(): Promise<Viewer | null> {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("script")) return null;
  return viewer;
}

/**
 * One place that tells the router the screen has moved on.
 *
 * Every action below returns a plain object literal rather than routing its
 * answer through a helper: the screen's `run` takes `{ error?: string }`, and
 * a union of literals is what lets TypeScript see that a success has no error
 * on it. A generic pass-through would hide exactly that.
 */
function refresh() {
  revalidatePath("/article");
}

/** A model call the budget stopped is a message, not a crash. */
function asMessage(err: unknown): string {
  if (err instanceof BudgetStop) return err.message;
  return err instanceof Error ? err.message : "Something went wrong";
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ----------------------------------------------------------- the library

export async function createArticleAction(input: {
  title?: unknown;
  angle?: unknown;
  summary?: unknown;
  language?: unknown;
  tags?: unknown;
  /** Start it from a script that already exists, rather than from nothing. */
  scriptId?: unknown;
}) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };

  const scriptId = str(input.scriptId, 64);
  if (scriptId) {
    const id = await articleFromScript(viewer, scriptId);
    if (!id) return { error: "That script does not exist." };
    await audit(viewer, "article.fromScript", {
      objectType: "article",
      objectId: id,
      module: "script",
      meta: { scriptId },
    });
    refresh();
    return { ok: true, id };
  }

  const title = str(input.title, 300);
  if (!title) return { error: "An article needs a headline to start from." };

  const id = await createArticle(viewer, {
    title,
    angle: str(input.angle, 400) || null,
    summary: str(input.summary, 1000) || null,
    language: str(input.language, 40) || null,
    tags: Array.isArray(input.tags) ? input.tags.map((t) => str(t, 60)).filter(Boolean) : [],
  });

  await audit(viewer, "article.create", { objectType: "article", objectId: id, module: "script" });
  refresh();
  return { ok: true, id };
}

export async function deleteArticleAction(articleId: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownArticle(viewer, articleId);
  if (!id) return { error: "Not allowed" };

  await removeArticle(viewer, id);
  await audit(viewer, "article.delete", { objectType: "article", objectId: id, module: "script" });
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------ the editor

export async function saveArticleAction(
  articleId: unknown,
  input: { title?: unknown; angle?: unknown; summary?: unknown; body?: unknown; language?: unknown; tags?: unknown },
) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownArticle(viewer, articleId);
  if (!id) return { error: "Not allowed" };

  const res = await saveArticle(viewer, id, {
    title: input.title === undefined ? undefined : str(input.title, 300),
    angle: input.angle === undefined ? undefined : str(input.angle, 400) || null,
    summary: input.summary === undefined ? undefined : str(input.summary, 1000) || null,
    body: input.body === undefined ? undefined : String(input.body).slice(0, 200_000),
    language: input.language === undefined ? undefined : str(input.language, 40) || null,
    tags: Array.isArray(input.tags) ? input.tags.map((t) => str(t, 60)).filter(Boolean) : undefined,
  });
  if (!res) return { error: "That article is published. Retract it before editing." };
  refresh();
  return { ok: true, wordCount: res.wordCount };
}

/**
 * The assistant writes it.
 *
 * The draft that is there becomes a version first, so asking for a rewrite can
 * never be the thing that loses somebody's afternoon — exactly what
 * `generateDraftAction` does for a script.
 */
export async function draftArticleAction(articleId: unknown, instruction?: unknown, sources?: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownArticle(viewer, articleId);
  if (!id) return { error: "Not allowed" };

  try {
    await cutVersion(viewer, id, { note: "before the assistant rewrote it" });
    const res = await draftArticle(viewer, id, {
      instruction: str(instruction, 500) || null,
      sources: str(sources, 8000) || null,
    });
    refresh();
    if ("error" in res) return { error: res.error };

    await audit(viewer, "article.generate", {
      objectType: "article",
      objectId: id,
      module: "script",
      meta: { model: res.model, words: res.words },
    });
    return { ok: true, model: res.model, words: res.words };
  } catch (err) {
    return { error: asMessage(err) };
  }
}

export async function cutVersionAction(articleId: unknown, note?: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownArticle(viewer, articleId);
  if (!id) return { error: "Not allowed" };

  const res = await cutVersion(viewer, id, { note: str(note, 300) || null });
  if (!res) return { error: "There is nothing to save, or the article is published." };
  refresh();
  return { ok: true, versionNo: res.versionNo };
}

export async function restoreVersionAction(articleId: unknown, versionNo: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownArticle(viewer, articleId);
  if (!id) return { error: "Not allowed" };
  const n = Number(versionNo);
  if (!Number.isInteger(n) || n < 1) return { error: "Not allowed" };

  // What is in the editor is kept first: restoring v2 over v3 must not be the
  // thing that destroys v3.
  await cutVersion(viewer, id, { note: "before restoring an earlier version" });
  const res = await restoreVersion(viewer, id, n);
  if (!res) return { error: "That version does not exist, or the article is published." };

  await audit(viewer, "article.restore", {
    objectType: "article",
    objectId: id,
    module: "script",
    meta: { versionNo: n },
  });
  refresh();
  return { ok: true };
}

// ------------------------------------------------------------ approvals

export async function requestApprovalAction(articleId: unknown, approverId: unknown, note?: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownArticle(viewer, articleId);
  if (!id) return { error: "Not allowed" };
  if (typeof approverId !== "string" || !approverId) return { error: "Choose who should approve it." };
  if (approverId === viewer.id) return { error: "An article cannot be approved by the person who wrote it." };

  const [approver] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, approverId),
        eq(users.tenantId, viewer.tenantId),
        eq(users.status, "active"),
        eq(users.isAgent, false),
      ),
    )
    .limit(1);
  if (!approver) return { error: "That person is not in this studio." };

  const res = await requestApproval(viewer, id, approverId, str(note, 500) || undefined);
  if (!res) return { error: "There is nothing to approve yet, or the article is published." };

  await audit(viewer, "article.approval.request", {
    objectType: "article",
    objectId: id,
    module: "script",
    meta: { approverId, versionNo: res.versionNo },
  });
  refresh();
  return { ok: true, versionNo: res.versionNo };
}

export async function decideApprovalAction(approvalId: unknown, decision: unknown, note?: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  if (typeof approvalId !== "string") return { error: "Not allowed" };
  if (decision !== "approved" && decision !== "rejected") return { error: "Not allowed" };

  const res = await decideApproval(viewer, approvalId, decision, str(note, 500) || undefined);
  if ("error" in res) return { error: res.error };

  await audit(viewer, `article.approval.${decision}`, {
    objectType: "approval",
    objectId: approvalId,
    module: "script",
    meta: { versionNo: res.versionNo },
  });
  refresh();
  return { ok: true, versionNo: res.versionNo };
}

// ----------------------------------------------------------- publishing

/**
 * Records that it went out.
 *
 * Nothing is sent from here: there is no API for a 公众号 or the studio's own
 * site, so this is the log entry a person makes, and the service refuses it
 * unless an approval names these exact words.
 */
export async function publishArticleAction(
  articleId: unknown,
  input: { kind?: unknown; destination?: unknown; url?: unknown; note?: unknown; publishedAt?: unknown },
) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  const id = await ownArticle(viewer, articleId);
  if (!id) return { error: "Not allowed" };

  // A date off the wire is a string until it parses.
  let publishedAt: Date | null = null;
  if (typeof input.publishedAt === "string" && input.publishedAt) {
    const parsed = new Date(input.publishedAt);
    if (Number.isNaN(parsed.getTime())) return { error: "That is not a date and time." };
    publishedAt = parsed;
  }

  const res = await publishArticle(viewer, id, {
    kind: str(input.kind, 40) || "other",
    destination: str(input.destination, 200),
    url: str(input.url, 2000) || null,
    note: str(input.note, 1000) || null,
    publishedAt,
  });
  if ("error" in res) return { error: res.error };

  await audit(viewer, "article.publish", {
    objectType: "article",
    objectId: id,
    module: "script",
    meta: { publicationId: res.id, destination: str(input.destination, 200) },
  });
  refresh();
  return { ok: true, id: res.id };
}

export async function retractPublicationAction(publicationId: unknown, reason?: unknown) {
  const viewer = await writer();
  if (!viewer) return { error: "Not allowed" };
  if (typeof publicationId !== "string" || !publicationId) return { error: "Not allowed" };

  const res = await retractPublication(viewer, publicationId, str(reason, 500) || undefined);
  if ("error" in res) return { error: res.error };

  await audit(viewer, "article.retract", {
    objectType: "article",
    objectId: res.articleId,
    module: "script",
    meta: { publicationId },
  });
  refresh();
  return { ok: true, articleId: res.articleId };
}
