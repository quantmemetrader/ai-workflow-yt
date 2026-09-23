import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import {
  approvals,
  articlePublications,
  articleVersions,
  articles,
  scriptVersions,
  scripts,
  users,
} from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import { wordCount } from "@/lib/script/service";
import type { Viewer } from "@/lib/auth/dal";

/**
 * Article (the written sibling of Script, spec §4.4 by analogy).
 *
 * Three rules, and they are the Script module's own — an article that played
 * by different ones would be a second product sharing a rail icon:
 *
 *   1. **A published article is read-only.** `lockedVersion` is set when the
 *      first publication is recorded and cleared when the last one is
 *      retracted, and every write path here refuses while it is set.
 *   2. **Nothing is published without an approval naming a person.** The
 *      generic `approvals` table carries it, the approver may not be the
 *      author, and the approval names a *checksum* — so editing after an
 *      approval invalidates it rather than inheriting it.
 *   3. **The log is the record.** Publishing writes a row per destination and
 *      never overwrites one. Retracting adds a timestamp; the row stays.
 *
 * Visibility is the module entitlement, checked by the caller, exactly as the
 * Script library was before per-script sharing existed: the studio writes
 * together. Articles deliberately do not carry `relation_tuples` yet — half a
 * sharing model is worse than none, and adding it later is the same work
 * whether or not this file guesses at it now.
 */

export type ArticleRow = typeof articles.$inferSelect;
export type ArticleStatus = ArticleRow["status"];

/* -------------------------------------------------------------- reading */

export type ArticleListItem = {
  id: string;
  title: string;
  status: ArticleStatus;
  summary: string | null;
  wordCount: number;
  version: number;
  tags: string[];
  scriptId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
  /** How many live publications it has. The list says "published · 2 places". */
  publications: number;
};

export async function listArticles(
  viewer: Viewer,
  opts: { status?: ArticleStatus; query?: string } = {},
): Promise<ArticleListItem[]> {
  const where = [eq(articles.tenantId, viewer.tenantId), isNull(articles.deletedAt)];
  if (opts.status) where.push(eq(articles.status, opts.status));
  if (opts.query?.trim()) {
    const q = `%${opts.query.trim()}%`;
    where.push(sql`(${articles.title} ilike ${q} or coalesce(${articles.titleLocal}, '') ilike ${q} or coalesce(${articles.summary}, '') ilike ${q})`);
  }

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      titleLocal: articles.titleLocal,
      status: articles.status,
      summary: articles.summary,
      wordCount: articles.wordCount,
      version: articles.version,
      tags: articles.tags,
      scriptId: articles.scriptId,
      ownerId: articles.ownerId,
      ownerName: users.name,
      ownerNameLocal: users.nameLocal,
      publishedAt: articles.publishedAt,
      updatedAt: articles.updatedAt,
      publications: sql<number>`(
        select count(*)::int from article_publications p
         where p.article_id = ${articles.id} and p.retracted_at is null
      )`,
    })
    .from(articles)
    .leftJoin(users, eq(users.id, articles.ownerId))
    .where(and(...where))
    .orderBy(desc(articles.updatedAt))
    .limit(300);

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  return rows.map((r) => ({
    id: r.id,
    title: (zh && r.titleLocal) || r.title,
    status: r.status,
    summary: r.summary,
    wordCount: r.wordCount,
    version: r.version,
    tags: r.tags,
    scriptId: r.scriptId,
    ownerId: r.ownerId,
    ownerName: (zh && r.ownerNameLocal) || r.ownerName,
    publishedAt: r.publishedAt,
    updatedAt: r.updatedAt,
    publications: Number(r.publications ?? 0),
  }));
}

/** The counts above the list: All / Draft / In review / Published. */
export async function libraryCounts(viewer: Viewer) {
  const { rows } = await db.execute<{ status: string; n: number }>(sql`
    select status::text as status, count(*)::int as n
      from articles
     where tenant_id = ${viewer.tenantId} and deleted_at is null
     group by 1
  `);

  const by: Record<string, number> = {};
  let all = 0;
  for (const r of rows) {
    by[r.status] = Number(r.n);
    all += Number(r.n);
  }
  return {
    all,
    draft: by.draft ?? 0,
    in_review: by.in_review ?? 0,
    published: by.published ?? 0,
    archived: by.archived ?? 0,
  };
}

export type ArticleVersionRow = {
  id: string;
  versionNo: number;
  checksum: string;
  wordCount: number;
  note: string | null;
  model: string | null;
  createdAt: Date;
  authorName: string | null;
};

export type ArticleApprovalRow = {
  id: string;
  state: "requested" | "approved" | "rejected" | "withdrawn";
  versionNo: number | null;
  checksum: string | null;
  requestedAt: Date;
  decidedAt: Date | null;
  note: string | null;
  approverId: string | null;
  approverName: string | null;
  requestedBy: string;
};

export type PublicationRow = {
  id: string;
  articleId: string;
  articleTitle: string;
  versionNo: number | null;
  kind: string;
  destination: string;
  url: string | null;
  note: string | null;
  publishedAt: Date;
  publishedById: string | null;
  publishedBy: string | null;
  retractedAt: Date | null;
  retractedReason: string | null;
};

export type ArticleDetail = {
  article: ArticleRow;
  versions: ArticleVersionRow[];
  approvals: ArticleApprovalRow[];
  publications: PublicationRow[];
  ownerName: string | null;
  /** The checksum of the body as it stands, so the screen can say whether the
   * approval on file still covers what is on screen. */
  liveChecksum: string;
  locked: boolean;
};

export async function articleDetail(viewer: Viewer, articleId: string): Promise<ArticleDetail | null> {
  const [row] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.tenantId, viewer.tenantId), isNull(articles.deletedAt)))
    .limit(1);
  if (!row) return null;

  /* Two joins onto `users` in one statement — the version's author and the
     approval's approver — so the second one needs a name of its own. */
  const approver = alias(users, "approver");
  const [versions, approvalRows, publications, owner] = await Promise.all([
    db
      .select({
        id: articleVersions.id,
        versionNo: articleVersions.versionNo,
        checksum: articleVersions.checksum,
        wordCount: articleVersions.wordCount,
        note: articleVersions.note,
        model: articleVersions.model,
        createdAt: articleVersions.createdAt,
        authorName: users.name,
        authorNameLocal: users.nameLocal,
      })
      .from(articleVersions)
      .leftJoin(users, eq(users.id, articleVersions.authorId))
      .where(eq(articleVersions.articleId, articleId))
      .orderBy(desc(articleVersions.versionNo)),
    db
      .select({
        id: approvals.id,
        state: approvals.state,
        versionNo: approvals.versionNo,
        checksum: approvals.checksum,
        requestedAt: approvals.requestedAt,
        decidedAt: approvals.decidedAt,
        note: approvals.note,
        approverId: approvals.approverId,
        approverName: approver.name,
        approverNameLocal: approver.nameLocal,
        requestedBy: approvals.requestedBy,
      })
      .from(approvals)
      .leftJoin(approver, eq(approver.id, approvals.approverId))
      .where(and(eq(approvals.objectType, "article"), eq(approvals.objectId, articleId)))
      .orderBy(desc(approvals.requestedAt)),
    publicationsFor(viewer, articleId),
    row.ownerId
      ? db.select({ name: users.name, nameLocal: users.nameLocal }).from(users).where(eq(users.id, row.ownerId)).limit(1)
      : Promise.resolve([]),
  ]);

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  return {
    article: row,
    versions: versions.map((v) => ({
      id: v.id,
      versionNo: v.versionNo,
      checksum: v.checksum,
      wordCount: v.wordCount,
      note: v.note,
      model: v.model,
      createdAt: v.createdAt,
      authorName: (zh && v.authorNameLocal) || v.authorName,
    })),
    approvals: approvalRows.map((a) => ({
      id: a.id,
      state: a.state,
      versionNo: a.versionNo,
      checksum: a.checksum,
      requestedAt: a.requestedAt,
      decidedAt: a.decidedAt,
      note: a.note,
      approverId: a.approverId,
      approverName: (zh && a.approverNameLocal) || a.approverName,
      requestedBy: a.requestedBy,
    })),
    publications,
    ownerName: owner[0] ? ((zh && owner[0].nameLocal) || owner[0].name) : null,
    liveChecksum: checksumOf(row.title, row.summary, row.body),
    locked: row.lockedVersion !== null,
  };
}

/** The publishing log: what went out, when, where, by whom. Tenant-wide with
 * no article id, one article's history with one. */
export async function publicationsFor(viewer: Viewer, articleId?: string, limit = 200): Promise<PublicationRow[]> {
  const where = [eq(articlePublications.tenantId, viewer.tenantId)];
  if (articleId) where.push(eq(articlePublications.articleId, articleId));

  const rows = await db
    .select({
      id: articlePublications.id,
      articleId: articlePublications.articleId,
      articleTitle: articles.title,
      articleTitleLocal: articles.titleLocal,
      versionNo: articlePublications.versionNo,
      kind: articlePublications.kind,
      destination: articlePublications.destination,
      url: articlePublications.url,
      note: articlePublications.note,
      publishedAt: articlePublications.publishedAt,
      publishedById: articlePublications.publishedBy,
      publishedBy: users.name,
      publishedByLocal: users.nameLocal,
      retractedAt: articlePublications.retractedAt,
      retractedReason: articlePublications.retractedReason,
    })
    .from(articlePublications)
    .innerJoin(articles, eq(articles.id, articlePublications.articleId))
    .leftJoin(users, eq(users.id, articlePublications.publishedBy))
    .where(and(...where))
    .orderBy(desc(articlePublications.publishedAt))
    .limit(Math.min(500, Math.max(1, limit)));

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  return rows.map((r) => ({
    id: r.id,
    articleId: r.articleId,
    articleTitle: (zh && r.articleTitleLocal) || r.articleTitle,
    versionNo: r.versionNo,
    kind: r.kind,
    destination: r.destination,
    url: r.url,
    note: r.note,
    publishedAt: r.publishedAt,
    publishedById: r.publishedById,
    publishedBy: (zh && r.publishedByLocal) || r.publishedBy,
    retractedAt: r.retractedAt,
    retractedReason: r.retractedReason,
  }));
}

/* -------------------------------------------------------------- writing */

/** sha-256 over the headline, the standfirst and the body — what an approval
 * names, and what a publication records as "these words went out". */
export function checksumOf(title: string, summary: string | null, body: string): string {
  return createHash("sha256").update([title, summary ?? "", body].join("\u0000")).digest("hex");
}

export async function createArticle(
  viewer: Viewer,
  input: {
    title: string;
    angle?: string | null;
    summary?: string | null;
    body?: string | null;
    language?: string | null;
    tags?: string[];
    scriptId?: string | null;
    topicId?: string | null;
    sourceFileIds?: string[];
  },
): Promise<string> {
  const id = newId("art");
  const body = input.body ?? "";
  await db.insert(articles).values({
    id,
    tenantId: viewer.tenantId,
    title: input.title.trim().slice(0, 300),
    angle: input.angle ?? null,
    summary: input.summary ?? null,
    body,
    language: input.language ?? null,
    tags: (input.tags ?? []).slice(0, 20),
    scriptId: input.scriptId ?? null,
    topicId: input.topicId ?? null,
    sourceFileIds: input.sourceFileIds ?? [],
    wordCount: wordCount(body),
    ownerId: viewer.id,
  });
  return id;
}

/**
 * An article from a script that already exists.
 *
 * The obvious move for this studio: the research, the angle and the facts are
 * in the script, and re-typing them into an article is how the two drift. The
 * locked version wins when there is one — that is the text somebody approved —
 * and the voice-over becomes the prose, with the visual direction left behind
 * because an article has no camera.
 *
 * A script that has already been turned into an article keeps that article
 * rather than spawning a second one on every press, exactly as
 * `scriptFromTopic` does.
 */
export async function articleFromScript(viewer: Viewer, scriptId: string): Promise<string | null> {
  const [script] = await db
    .select()
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
    .limit(1);
  if (!script) return null;

  const [existing] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.scriptId, scriptId), eq(articles.tenantId, viewer.tenantId), isNull(articles.deletedAt)))
    .limit(1);
  if (existing) return existing.id;

  const [version] = await db
    .select({ beats: scriptVersions.beats, versionNo: scriptVersions.versionNo })
    .from(scriptVersions)
    .where(
      script.lockedVersion === null
        ? eq(scriptVersions.scriptId, scriptId)
        : and(eq(scriptVersions.scriptId, scriptId), eq(scriptVersions.versionNo, script.lockedVersion)),
    )
    .orderBy(desc(scriptVersions.versionNo))
    .limit(1);

  /* Paragraphs, not beats. A beat with no voice-over is a shot of something,
     which has nothing to say in prose, so it is dropped rather than left as an
     empty line the writer has to clean up. */
  const body = (version?.beats ?? [])
    .map((b) => b.voiceover.trim())
    .filter(Boolean)
    .join("\n\n");

  return createArticle(viewer, {
    title: script.title,
    angle: script.angle,
    language: script.language,
    body,
    scriptId,
    topicId: script.topicId,
    sourceFileIds: script.sourceFileIds,
  });
}

/** Guard for every write: a published article is read-only until its
 * publications are retracted. */
async function assertUnlocked(viewer: Viewer, articleId: string): Promise<ArticleRow | null> {
  const [row] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.tenantId, viewer.tenantId), isNull(articles.deletedAt)))
    .limit(1);
  if (!row || row.lockedVersion !== null) return null;
  return row;
}

/** The article this viewer may write to, or null. The id is never trusted:
 * a server action is a public endpoint. */
export async function ownArticle(viewer: Viewer, articleId: unknown): Promise<string | null> {
  if (typeof articleId !== "string" || !articleId || articleId.length > 64) return null;
  const [row] = await db
    .select({ id: articles.id })
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.tenantId, viewer.tenantId), isNull(articles.deletedAt)))
    .limit(1);
  return row?.id ?? null;
}

export async function saveArticle(
  viewer: Viewer,
  articleId: string,
  input: {
    title?: string;
    angle?: string | null;
    summary?: string | null;
    body?: string;
    language?: string | null;
    tags?: string[];
  },
): Promise<{ wordCount: number } | null> {
  const article = await assertUnlocked(viewer, articleId);
  if (!article) return null;

  const body = input.body ?? article.body;
  const patch = {
    title: input.title?.trim().slice(0, 300) || article.title,
    angle: input.angle === undefined ? article.angle : input.angle,
    summary: input.summary === undefined ? article.summary : (input.summary?.slice(0, 1000) ?? null),
    body: body.slice(0, 200_000),
    language: input.language === undefined ? article.language : input.language,
    tags: input.tags ? input.tags.slice(0, 20) : article.tags,
    wordCount: wordCount(body),
    updatedAt: new Date(),
  };

  await db.update(articles).set(patch).where(eq(articles.id, articleId));
  return { wordCount: patch.wordCount };
}

/**
 * Snapshots the body as a numbered version.
 *
 * Immutable from here. The next number is taken inside the transaction rather
 * than read first, so two people saving at once are serialised instead of
 * colliding on the unique index.
 */
export async function cutVersion(
  viewer: Viewer,
  articleId: string,
  opts: { note?: string | null; model?: string | null } = {},
): Promise<{ id: string; versionNo: number; checksum: string } | null> {
  const article = await assertUnlocked(viewer, articleId);
  if (!article) return null;
  if (!article.body.trim()) return null;

  return db.transaction(async (tx) => {
    const { rows } = await tx.execute<{ next: number }>(
      sql`select coalesce(max(version_no), 0) + 1 as next from article_versions where article_id = ${articleId}`,
    );
    const versionNo = Number(rows[0]?.next ?? 1);
    const checksum = checksumOf(article.title, article.summary, article.body);

    const id = newId("arv");
    await tx.insert(articleVersions).values({
      id,
      articleId,
      versionNo,
      title: article.title,
      summary: article.summary,
      body: article.body,
      checksum,
      wordCount: article.wordCount,
      note: opts.note ?? null,
      authorId: viewer.id,
      model: opts.model ?? null,
    });
    await tx.update(articles).set({ version: versionNo, updatedAt: new Date() }).where(eq(articles.id, articleId));
    return { id, versionNo, checksum };
  });
}

/** Puts an earlier version back in the editor. Nothing is destroyed: the next
 * cut is simply the next number. */
export async function restoreVersion(viewer: Viewer, articleId: string, versionNo: number) {
  const article = await assertUnlocked(viewer, articleId);
  if (!article) return null;

  const [version] = await db
    .select()
    .from(articleVersions)
    .where(and(eq(articleVersions.articleId, articleId), eq(articleVersions.versionNo, versionNo)))
    .limit(1);
  if (!version) return null;

  return saveArticle(viewer, articleId, {
    title: version.title,
    summary: version.summary,
    body: version.body,
  });
}

export async function removeArticle(viewer: Viewer, articleId: string) {
  await db
    .update(articles)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(articles.id, articleId), eq(articles.tenantId, viewer.tenantId)));
}

/* ------------------------------------------------------------ approving */

/**
 * Asks a named person to approve what is written now.
 *
 * Cuts a version first, so the approval names words that exist rather than a
 * draft that can still move. An earlier open request is withdrawn rather than
 * left behind: an approver with two versions of one article waiting is an
 * approver who will approve the wrong one.
 */
export async function requestApproval(viewer: Viewer, articleId: string, approverId: string, note?: string) {
  const article = await assertUnlocked(viewer, articleId);
  if (!article) return null;

  const cut = await cutVersion(viewer, articleId, { note: note ?? null });
  const [latest] = await db
    .select({ versionNo: articleVersions.versionNo, checksum: articleVersions.checksum })
    .from(articleVersions)
    .where(eq(articleVersions.articleId, articleId))
    .orderBy(desc(articleVersions.versionNo))
    .limit(1);
  if (!latest) return null;

  await db
    .update(approvals)
    .set({ state: "withdrawn", decidedAt: new Date(), decidedBy: viewer.id })
    .where(and(eq(approvals.objectType, "article"), eq(approvals.objectId, articleId), eq(approvals.state, "requested")));

  const id = newId("apr");
  await db.insert(approvals).values({
    id,
    tenantId: viewer.tenantId,
    objectType: "article",
    objectId: articleId,
    checksum: latest.checksum,
    versionNo: latest.versionNo,
    requestedBy: viewer.id,
    approverId,
    note: note ?? null,
  });

  await db.update(articles).set({ status: "in_review", updatedAt: new Date() }).where(eq(articles.id, articleId));
  return { approvalId: id, versionNo: cut?.versionNo ?? latest.versionNo };
}

/**
 * Approve, or send it back.
 *
 * The two rules the Script module already keeps, kept here for the same
 * reasons: the approver is not the author, and the words have not changed
 * since the approval was asked for. Approving does *not* publish — it makes
 * publishing possible, and a person still has to say where it went.
 */
export async function decideApproval(
  viewer: Viewer,
  approvalId: string,
  decision: "approved" | "rejected",
  note?: string,
): Promise<{ error: string } | { ok: true; articleId: string; versionNo: number | null }> {
  const [row] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, approvalId), eq(approvals.tenantId, viewer.tenantId), eq(approvals.state, "requested")))
    .limit(1);
  if (!row || row.objectType !== "article") return { error: "That approval is not waiting." };
  if (row.requestedBy === viewer.id) return { error: "An article cannot be approved by the person who wrote it." };
  if (row.approverId && row.approverId !== viewer.id) return { error: "Somebody else was asked to approve this." };

  const [version] = await db
    .select({ checksum: articleVersions.checksum })
    .from(articleVersions)
    .where(and(eq(articleVersions.articleId, row.objectId), eq(articleVersions.versionNo, row.versionNo ?? -1)))
    .limit(1);
  if (!version) return { error: "The version this names no longer exists." };
  if (version.checksum !== row.checksum) return { error: "The article has changed since it was sent. Ask for it again." };

  await db
    .update(approvals)
    .set({ state: decision, decidedBy: viewer.id, decidedAt: new Date(), note: note ?? row.note })
    .where(eq(approvals.id, approvalId));

  // Rejected goes back to the writer; approved waits to be published, because
  // where it went is something only a person knows.
  await db
    .update(articles)
    .set({ status: decision === "rejected" ? "draft" : "in_review", updatedAt: new Date() })
    .where(eq(articles.id, row.objectId));

  return { ok: true, articleId: row.objectId, versionNo: row.versionNo };
}

/** The approval that covers the words as they stand now, if there is one. */
export async function approvedNow(
  viewer: Viewer,
  articleId: string,
): Promise<{ approvalId: string; versionNo: number; checksum: string } | null> {
  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.tenantId, viewer.tenantId)))
    .limit(1);
  if (!article) return null;

  const live = checksumOf(article.title, article.summary, article.body);
  const [row] = await db
    .select({ id: approvals.id, versionNo: approvals.versionNo, checksum: approvals.checksum })
    .from(approvals)
    .where(
      and(
        eq(approvals.objectType, "article"),
        eq(approvals.objectId, articleId),
        eq(approvals.state, "approved"),
        eq(approvals.checksum, live),
      ),
    )
    .orderBy(desc(approvals.requestedAt))
    .limit(1);

  return row?.versionNo ? { approvalId: row.id, versionNo: row.versionNo, checksum: live } : null;
}

/* ----------------------------------------------------------- publishing */

/**
 * Records that this article went out somewhere.
 *
 * Nothing is sent from here — there is no API for a 公众号 or the studio's own
 * site, and a button that pretended otherwise would be a lie in the log. What
 * this does is make the record: which words, which place, which person, when.
 *
 * The one gate is the module's promise: the words as they stand must be
 * covered by an approval that names them. The first publication locks the
 * article, so what is in the log and what is in the editor cannot drift.
 */
export async function publishArticle(
  viewer: Viewer,
  articleId: string,
  input: { kind: string; destination: string; url?: string | null; note?: string | null; publishedAt?: Date | null },
): Promise<{ error: string } | { ok: true; id: string }> {
  const [article] = await db
    .select()
    .from(articles)
    .where(and(eq(articles.id, articleId), eq(articles.tenantId, viewer.tenantId), isNull(articles.deletedAt)))
    .limit(1);
  if (!article) return { error: "No such article." };
  if (!input.destination.trim()) return { error: "Say where it was published." };

  const approved = await approvedNow(viewer, articleId);
  if (!approved) {
    return {
      error:
        "Nothing is published without an approval naming a person. Send it for approval, and have somebody other than the writer approve these exact words.",
    };
  }

  const id = newId("apb");
  const at = input.publishedAt ?? new Date();
  await db.insert(articlePublications).values({
    id,
    tenantId: viewer.tenantId,
    articleId,
    versionNo: approved.versionNo,
    checksum: approved.checksum,
    kind: input.kind.slice(0, 40) || "other",
    destination: input.destination.trim().slice(0, 200),
    url: input.url?.trim().slice(0, 2000) || null,
    note: input.note?.slice(0, 1000) || null,
    publishedAt: at,
    publishedBy: viewer.id,
  });

  await db
    .update(articles)
    .set({
      status: "published",
      publishedAt: article.publishedAt ?? at,
      lockedVersion: approved.versionNo,
      updatedAt: new Date(),
    })
    .where(eq(articles.id, articleId));

  return { ok: true, id };
}

/**
 * Taken down.
 *
 * The row stays and grows a timestamp — a log that forgets a retraction
 * cannot answer the only question anybody asks after one. When the last live
 * publication goes, the article unlocks and goes back to review, because it is
 * a draft again in every sense that matters.
 */
export async function retractPublication(
  viewer: Viewer,
  publicationId: string,
  reason?: string,
): Promise<{ error: string } | { ok: true; articleId: string }> {
  const [row] = await db
    .select()
    .from(articlePublications)
    .where(and(eq(articlePublications.id, publicationId), eq(articlePublications.tenantId, viewer.tenantId)))
    .limit(1);
  if (!row) return { error: "No such publication." };
  if (row.retractedAt) return { error: "That one is already marked as taken down." };

  await db
    .update(articlePublications)
    .set({ retractedAt: new Date(), retractedBy: viewer.id, retractedReason: reason?.slice(0, 500) ?? null })
    .where(eq(articlePublications.id, publicationId));

  const { rows } = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from article_publications
     where article_id = ${row.articleId} and retracted_at is null
  `);
  if (Number(rows[0]?.n ?? 0) === 0) {
    await db
      .update(articles)
      .set({ status: "in_review", lockedVersion: null, publishedAt: null, updatedAt: new Date() })
      .where(eq(articles.id, row.articleId));
  }

  return { ok: true, articleId: row.articleId };
}

/* --------------------------------------------------------------- pickers */

/** Scripts an article could be written from, newest first. Locked ones first
 * in the label, because an approved script is the one worth reusing. */
export async function scriptsToDrawOn(viewer: Viewer, limit = 30) {
  return db
    .select({
      id: scripts.id,
      title: scripts.title,
      status: scripts.status,
      updatedAt: scripts.updatedAt,
    })
    .from(scripts)
    .where(and(eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
    .orderBy(desc(scripts.updatedAt))
    .limit(limit);
}

/** Approvals on articles waiting on this person. */
export async function pendingApprovals(viewer: Viewer) {
  return db
    .select({ id: approvals.id, objectId: approvals.objectId, requestedAt: approvals.requestedAt })
    .from(approvals)
    .where(
      and(
        eq(approvals.tenantId, viewer.tenantId),
        eq(approvals.objectType, "article"),
        eq(approvals.state, "requested"),
        eq(approvals.approverId, viewer.id),
      ),
    )
    .orderBy(asc(approvals.requestedAt));
}
