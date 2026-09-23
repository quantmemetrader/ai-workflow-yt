import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import { users } from "./core";

/** owner > editor > commenter > viewer (spec §2, brief "Database / files").
 * Order matters: sharing is bounded by what the sharer already holds. */
export const RELATIONS = ["owner", "editor", "commenter", "viewer"] as const;
export type Relation = (typeof RELATIONS)[number];
export const relationEnum = pgEnum("relation", RELATIONS);

export const fileKindEnum = pgEnum("file_kind", [
  "doc",
  "sheet",
  "pdf",
  "image",
  "video",
  "audio",
  "archive",
  "other",
]);

export const folders = pgTable(
  "folders",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    parentId: text(),
    name: text().notNull(),
    /** Ancestor ids, root first, including this folder. A permission check is
     * then one indexed array-overlap instead of a recursive walk. Rewritten
     * for the subtree on move. */
    path: text().array().notNull().default([]),
    ownerId: text().notNull().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("folders_parent_idx").on(t.parentId),
    index("folders_path_idx").using("gin", t.path),
  ],
);

export const files = pgTable(
  "files",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    folderId: text().references(() => folders.id),
    /** Denormalised copy of the containing folder's `path`, rewritten on move.
     * Lets a permission filter run against the files table alone — one indexed
     * array test per row, no recursive join in the hot path. */
    folderPath: text().array().notNull().default([]),
    name: text().notNull(),
    kind: fileKindEnum().notNull().default("other"),
    mime: text(),
    sizeBytes: bigint({ mode: "number" }).notNull().default(0),
    /** Object key in R2. Never a public URL: reads go through a signed,
     * permission-checked redirect. */
    storageKey: text(),
    checksum: text(),
    /** Media facts the Video and Files screens both need. */
    durationMs: integer(),
    width: integer(),
    height: integer(),
    posterKey: text(),
    /**
     * The small copy the editor plays, when one has been made.
     *
     * A file of its own — same tenant, same folder, same readers — holding a
     * 480p H.264 rendition of this one (`lib/video/proxy.ts`). Pressing play
     * on a 114 MB master from Hong Kong is the slowest thing in the product;
     * playing ~3 MB of it is not.
     *
     * Nullable, and no foreign key, exactly like `video_exports.proxy_file_id`:
     * every clip uploaded before this existed has none, the player falls back
     * to the master when it is missing, and the nightly purge hard-deletes
     * rows — a constraint here would either block that or have to be taught
     * about it. `purgeDeleted` clears the pointer instead.
     */
    proxyFileId: text(),
    /** Plain text used for search and agent retrieval; extracted on upload. */
    text: text(),
    tags: text().array().notNull().default([]),
    version: integer().notNull().default(1),
    ownerId: text().notNull().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedBy: text().references(() => users.id),
    /** Soft delete with a 30-day recovery window (brief). */
    deletedAt: timestamp({ withTimezone: true }),
    deletedBy: text().references(() => users.id),
  },
  (t) => [
    index("files_folder_idx").on(t.folderId, t.deletedAt),
    index("files_owner_idx").on(t.ownerId),
    index("files_updated_idx").on(t.updatedAt),
    /** Trash, and the nightly purge that walks it. Both ask the one question
     * the live-file indexes deliberately exclude. */
    index("files_deleted_idx").on(t.deletedAt).where(sql`deleted_at is not null`),
  ],
);

export const fileVersions = pgTable(
  "file_versions",
  {
    id: text().primaryKey(),
    fileId: text().notNull().references(() => files.id, { onDelete: "cascade" }),
    versionNo: integer().notNull(),
    storageKey: text(),
    sizeBytes: bigint({ mode: "number" }).notNull().default(0),
    checksum: text(),
    note: text(),
    authorId: text().notNull().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("file_versions_no_idx").on(t.fileId, t.versionNo)],
);

/** Retrieval units for the agent. `embedding` is nullable on purpose: lexical
 * retrieval works from day one, and vectors get backfilled when an embedding
 * provider is connected. Either way the permission filter runs at query time,
 * never at index time (spec §2.2.1). */
export const fileChunks = pgTable(
  "file_chunks",
  {
    id: text().primaryKey(),
    fileId: text().notNull().references(() => files.id, { onDelete: "cascade" }),
    versionNo: integer().notNull().default(1),
    ord: integer().notNull(),
    content: text().notNull(),
    tokens: integer().notNull().default(0),
    embedding: vector({ dimensions: 1536 }),
  },
  (t) => [index("file_chunks_file_idx").on(t.fileId)],
);

/**
 * ReBAC tuples — the one place that decides who may see what.
 *
 * object:  ('file', fil_…) | ('folder', fld_…)
 * subject: ('user', usr_…) | ('team', team_…) | ('tenant', tnt_…)
 *
 * Shaped like an OpenFGA tuple so the checker can be swapped for OpenFGA
 * itself (its datastore is already provisioned) without touching callers.
 */
export const relationTuples = pgTable(
  "relation_tuples",
  {
    id: text().primaryKey(),
    objectType: text().notNull(),
    objectId: text().notNull(),
    relation: relationEnum().notNull(),
    subjectType: text().notNull(),
    subjectId: text().notNull(),
    grantedBy: text().references(() => users.id),
    /** Time-boxed access for guests (brief: "a guest with time-boxed access
     * to named folders only"). */
    expiresAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tuples_unique_idx").on(
      t.objectType,
      t.objectId,
      t.relation,
      t.subjectType,
      t.subjectId,
    ),
    index("tuples_subject_idx").on(t.subjectType, t.subjectId),
    index("tuples_object_idx").on(t.objectType, t.objectId),
  ],
);

/** Direct, unshared uploads still need a home; `meta` carries whatever the
 * extractor found (EXIF, page count, transcript language). */
export const fileMeta = pgTable("file_meta", {
  fileId: text().primaryKey().references(() => files.id, { onDelete: "cascade" }),
  meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
});
