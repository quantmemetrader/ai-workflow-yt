import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./core";

/**
 * Script (spec §4.4).
 *
 * The module's whole job is to end with one authorised version that Video can
 * trust, so the shapes here are chosen to make that unambiguous:
 *
 *   — **Beats are a table while a script is being written, and JSON once a
 *     version exists.** The editor edits rows; `approve and lock` snapshots
 *     them into `script_versions.beats` and takes a checksum. A version is
 *     therefore immutable by construction rather than by convention, and the
 *     thing Video receives cannot drift after it was approved.
 *   — **`approvals` is generic**, not a column on the script. Publish needs
 *     exactly the same record (spec §4.6: nothing leaves without an approval
 *     naming a person), and an approval that lives in two shapes is an
 *     approval that means two things.
 *   — **Suggestions are rows, not a blob.** The brief asks for per-suggestion
 *     accept and reject, so each one needs its own state and its own author.
 */

export const scriptStatusEnum = pgEnum("script_status", [
  "brief",
  "drafting",
  "awaiting_approval",
  "locked",
  "archived",
]);

/** Folders in the Script library. Separate from the Files module's folders:
 * these organise scripts, and a script is not a file. */
export const scriptFolders = pgTable(
  "script_folders",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    name: text().notNull(),
    nameLocal: text(),
    ownerId: text().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("script_folders_tenant_idx").on(t.tenantId, t.name)],
);

export const scripts = pgTable(
  "scripts",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    folderId: text().references(() => scriptFolders.id, { onDelete: "set null" }),
    /** The backlog topic this came from, when it came from one. The Topic
     * backlog's hand-off writes this, which is the wire the board's "hand to
     * Script" button has been missing. */
    topicId: text(),

    title: text().notNull(),
    titleLocal: text(),
    status: scriptStatusEnum().notNull().default("brief"),

    // ---- the brief (spec §4.4, brief intake) ----
    angle: text(),
    /** "YouTube · 16:9". Kept as two columns because Publish needs the channel
     * on its own and Video needs the aspect on its own. */
    targetChannel: text(),
    aspect: text(),
    /** Target and tolerance in seconds. The editor shows "3:48 / 3:45 target"
     * and whether that is inside the tolerance. */
    targetSeconds: integer(),
    tolerancePercent: real().notNull().default(5),
    language: text(),
    subtitleLanguage: text(),
    /** Things the script must cover, ticked off as the draft grows. */
    mandatoryPoints: jsonb().$type<string[]>().notNull().default([]),
    /** Files in the media database that this script is written from, so the
     * agent's retrieval is bounded by what the producer actually chose. */
    sourceFileIds: text().array().notNull().default([]),
    briefUpdatedBy: text().references(() => users.id),
    briefUpdatedAt: timestamp({ withTimezone: true }),

    /** The highest version number written so far. The draft in `script_beats`
     * is always "the next one". */
    version: integer().notNull().default(0),
    /** Set only by approve-and-lock, and only ever to a version that exists. */
    lockedVersion: integer(),

    ownerId: text().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index("scripts_tenant_idx").on(t.tenantId, t.status, t.updatedAt),
    index("scripts_folder_idx").on(t.folderId),
  ],
);

/**
 * The working draft, one row per beat.
 *
 * The artboard's three columns are the three text fields: what is on screen,
 * what is said, and the subtitle. They are separate rather than one blob
 * because the conformance checks, the duration estimate and Video's shot cards
 * each need a different one of them.
 */
export const scriptBeats = pgTable(
  "script_beats",
  {
    id: text().primaryKey(),
    scriptId: text()
      .notNull()
      .references(() => scripts.id, { onDelete: "cascade" }),
    ord: integer().notNull(),
    /** Where this beat starts, in seconds from the top. Derived from the
     * running duration estimate, stored so the editor does not recompute the
     * whole script to render one row. */
    startSeconds: integer(),
    /** Camera, framing, archive credits: what Video turns into a shot card. */
    visual: text().notNull().default(""),
    /** What is spoken, in the script's own language. */
    voiceover: text().notNull().default(""),
    /** The subtitle line, usually the other language. */
    subtitle: text().notNull().default(""),
    /** True when the beat is natural sound with no narration, which changes
     * how its duration is estimated and what Video is asked to produce. */
    naturalSound: boolean().notNull().default(false),
    spokenSeconds: real(),
    updatedBy: text().references(() => users.id),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("script_beats_ord_idx").on(t.scriptId, t.ord)],
);

/**
 * A written version. Immutable once created.
 *
 * `beats` is the snapshot; `checksum` is a sha-256 over it, and it is what the
 * approval record names. Video is handed a version id and a checksum, so
 * "the locked script" is a thing that can be proved rather than asserted.
 */
export const scriptVersions = pgTable(
  "script_versions",
  {
    id: text().primaryKey(),
    scriptId: text()
      .notNull()
      .references(() => scripts.id, { onDelete: "cascade" }),
    versionNo: integer().notNull(),
    beats: jsonb()
      .$type<
        {
          ord: number;
          startSeconds: number | null;
          visual: string;
          voiceover: string;
          subtitle: string;
          naturalSound: boolean;
        }[]
      >()
      .notNull()
      .default([]),
    checksum: text().notNull(),

    // ---- the conformance panel, frozen with the version ----
    wordCount: integer().notNull().default(0),
    spokenSeconds: real(),
    /** 0..100 against the active house-style guide. */
    conformance: real(),
    /** Which guide it was scored against, so "was 76 at v3" is comparable. */
    guideVersion: text(),
    readingLevel: text(),
    flaggedTerms: jsonb().$type<{ term: string; why: string; beatOrd: number }[]>().notNull().default([]),
    mandatoryCovered: integer().notNull().default(0),

    note: text(),
    authorId: text().references(() => users.id),
    /** Set when this version was written by the agent rather than typed. */
    model: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("script_versions_no_idx").on(t.scriptId, t.versionNo)],
);

export const suggestionKindEnum = pgEnum("suggestion_kind", [
  "house_style",
  "length",
  "register",
  "clarity",
  "sound_direction",
  "fact_check",
]);

export const suggestionStateEnum = pgEnum("suggestion_state", ["open", "accepted", "rejected", "moved"]);

/**
 * One house-style suggestion against one beat.
 *
 * `rationale` carries the rule and its evidence, because the artboard makes a
 * promise the module has to keep: "Guide v7 §3.2: name the hour; 9 of 41
 * approved scripts do." A suggestion a writer cannot argue with is a
 * suggestion they will stop reading.
 *
 * `moved` exists for the sound-direction case: the right answer is often not
 * accept or reject but "this belongs in the shot list", which hands it to
 * Video instead of changing the words.
 */
export const scriptSuggestions = pgTable(
  "script_suggestions",
  {
    id: text().primaryKey(),
    scriptId: text()
      .notNull()
      .references(() => scripts.id, { onDelete: "cascade" }),
    beatOrd: integer(),
    kind: suggestionKindEnum().notNull(),
    /** Short label, e.g. "time of day". */
    label: text().notNull(),
    /** The text as written, and what is proposed instead. Either may be null:
     * a length suggestion proposes a cut, not a replacement. */
    before: text(),
    after: text(),
    rationale: text(),
    state: suggestionStateEnum().notNull().default("open"),
    actedBy: text().references(() => users.id),
    actedAt: timestamp({ withTimezone: true }),
    model: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("script_suggestions_idx").on(t.scriptId, t.state, t.beatOrd)],
);

export const approvalStateEnum = pgEnum("approval_state", ["requested", "approved", "rejected", "withdrawn"]);

/**
 * An approval, for anything that needs one.
 *
 * Deliberately generic — `objectType` is "script" here and "publish_item" in
 * the Publish module (spec §4.6). Both modules make the same promise: nothing
 * is final until a named person says so, and the record of who said it is
 * permanent.
 *
 * `checksum` is what was approved, not just which row: approving v4 of a
 * script has to mean approving *those words*, so a later edit cannot inherit
 * the approval.
 */
export const approvals = pgTable(
  "approvals",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    objectType: text().notNull(),
    objectId: text().notNull(),
    /** The exact content approved. Null only for objects with no snapshot. */
    checksum: text(),
    versionNo: integer(),

    requestedBy: text()
      .notNull()
      .references(() => users.id),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** Who was asked. The artboard shows "you're the designated approver". */
    approverId: text().references(() => users.id),

    state: approvalStateEnum().notNull().default("requested"),
    /** Who actually decided, which is not always who was asked. */
    decidedBy: text().references(() => users.id),
    decidedAt: timestamp({ withTimezone: true }),
    note: text(),
  },
  (t) => [
    index("approvals_object_idx").on(t.objectType, t.objectId, t.requestedAt),
    index("approvals_pending_idx").on(t.tenantId, t.state, t.approverId),
  ],
);

/**
 * A comment on a beat, from a person or the agent.
 *
 * The editor's third tab. Separate from `chat_messages` because these are
 * anchored to a place in a document, and a thread that loses its anchor is a
 * thread nobody can act on.
 */
export const scriptComments = pgTable(
  "script_comments",
  {
    id: text().primaryKey(),
    scriptId: text()
      .notNull()
      .references(() => scripts.id, { onDelete: "cascade" }),
    beatOrd: integer(),
    /** The version this was written against, so a comment on v3 does not read
     * as a comment on v4. */
    versionNo: integer(),
    authorId: text().references(() => users.id),
    body: text().notNull(),
    resolvedBy: text().references(() => users.id),
    resolvedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("script_comments_idx").on(t.scriptId, t.createdAt)],
);
