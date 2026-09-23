import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./core";

/**
 * Article — the written sibling of Script.
 *
 * The studio's work funnelled into video and nothing else: the same research,
 * the same angle and the same house voice had no way to come out as a piece of
 * writing. This is that way out, and it is deliberately the Script module's
 * shapes rather than a second architecture beside it:
 *
 *   — **The draft is a column and a version is a snapshot.** `articles.body`
 *     is what the editor edits; cutting a version copies the words into
 *     `article_versions` and takes a checksum, so a version is immutable by
 *     construction and an approval can name *those words* rather than a row
 *     that has since moved on. Exactly how `script_versions` works, minus the
 *     beats: an article is prose, so one Markdown field is the whole document.
 *   — **Approval is the generic `approvals` table** from `script.ts`, with
 *     `objectType = "article"`. A script, a post and an article make the same
 *     promise — nothing is final until a named person says so — and an
 *     approval that lives in three shapes means three things.
 *   — **Publishing is a log, not a flag.** The client asked for "publishing
 *     logs and stuff": what went out, when, where and by whom. That is a row
 *     per destination, kept forever, and it is why an article can go to the
 *     website on Monday and WeChat on Thursday without either erasing the
 *     other. Retracting sets a timestamp; it never deletes the record.
 *
 * Nothing here calls a platform. There is no API for a WeChat 公众号 draft or
 * the studio's own site, so a publication is something a person records — the
 * value is the record, and pretending otherwise would be a button that lies.
 */

export const articleStatusEnum = pgEnum("article_status", ["draft", "in_review", "published", "archived"]);

export const articles = pgTable(
  "articles",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),

    /** The script this was written from, when it came from one. Kept as a
     * plain column rather than a reference so deleting a script never takes
     * the article that outlived it. */
    scriptId: text(),
    /** The backlog topic behind it, when there is one. Same reasoning. */
    topicId: text(),

    title: text().notNull(),
    titleLocal: text(),
    status: articleStatusEnum().notNull().default("draft"),

    /** The way in — the same field the script brief carries, because the
     * angle is what makes two articles on one subject different pieces. */
    angle: text(),
    /** The standfirst: one or two sentences under the headline. Also what the
     * library list shows, and what a publishing destination usually wants. */
    summary: text(),
    /** The article itself, in Markdown. */
    body: text().notNull().default(""),
    language: text(),
    tags: text().array().notNull().default([]),
    /** Files in the media database this was written from, so the agent's
     * retrieval is bounded by what the writer actually chose. */
    sourceFileIds: text().array().notNull().default([]),

    /** Characters for CJK, words otherwise — `wordCount` in
     * `lib/script/service.ts`, which is the figure the editor already shows
     * for a script. Stored so the library list does not recount every body. */
    wordCount: integer().notNull().default(0),

    /** The highest version written so far. The body is always "the next one". */
    version: integer().notNull().default(0),
    /** Set when a published version froze the article, and cleared when every
     * publication of it has been retracted. A published article is read-only
     * for the same reason a locked script is: the words somebody approved and
     * the words that went out have to stay the same words. */
    lockedVersion: integer(),

    /** The first time it went out anywhere. Later destinations are rows in
     * `article_publications`, not edits to this. */
    publishedAt: timestamp({ withTimezone: true }),

    ownerId: text().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("articles_tenant_idx").on(t.tenantId, t.status, t.updatedAt),
    index("articles_script_idx").on(t.scriptId),
  ],
);

/**
 * A written version. Immutable once created.
 *
 * `checksum` is a sha-256 over the title, standfirst and body together, and it
 * is what the approval record names — so an edit made after an approval cannot
 * inherit it, and "the approved article" can be proved rather than asserted.
 */
export const articleVersions = pgTable(
  "article_versions",
  {
    id: text().primaryKey(),
    articleId: text()
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    versionNo: integer().notNull(),

    title: text().notNull(),
    summary: text(),
    body: text().notNull().default(""),
    checksum: text().notNull(),
    wordCount: integer().notNull().default(0),

    note: text(),
    authorId: text().references(() => users.id),
    /** Set when this version was written by the agent rather than typed. */
    model: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("article_versions_no_idx").on(t.articleId, t.versionNo)],
);

/**
 * One publication: what went out, when, where, by whom.
 *
 * Append-only, like `publish_log`. A destination is free text with a `kind`
 * beside it, because the studio publishes to places that have no API and no
 * account in this product — a 公众号, a newsletter, a client's own site — and a
 * fixed list of platforms would make the honest cases unrecordable.
 *
 * `versionNo` and `checksum` pin *which words* went out, so an article that
 * was edited after publication still says exactly what the reader got.
 */
export const articlePublications = pgTable(
  "article_publications",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    articleId: text()
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    versionNo: integer(),
    checksum: text(),

    /** `wechat`, `website`, `newsletter`, `linkedin`, `youtube`, `other` —
     * `DESTINATIONS` in `lib/article/destinations.ts` is the list the screen
     * offers. Text, not an enum, so adding one is not a migration. */
    kind: text().notNull().default("other"),
    /** What the studio calls that place: "腾亚创变 公众号". */
    destination: text().notNull(),
    url: text(),
    note: text(),
    /** Anything the destination wanted that this product does not model. */
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),

    publishedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    publishedBy: text().references(() => users.id),

    /** Taken down. The row stays: a publishing log that forgets what was
     * retracted is a log that cannot answer the only question anybody asks
     * after a takedown. */
    retractedAt: timestamp({ withTimezone: true }),
    retractedBy: text().references(() => users.id),
    retractedReason: text(),

    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("article_publications_tenant_idx").on(t.tenantId, t.publishedAt),
    index("article_publications_article_idx").on(t.articleId, t.publishedAt),
  ],
);
