import { bigint, index, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./core";

/**
 * Accounting (spec §4.7).
 *
 * Manual, at the client's own direction: no extraction provider, no
 * integration with an accounting system, no chart of accounts handed over
 * first. Somebody enters the document, somebody writes the entry, and the
 * export is a CSV.
 *
 * The spec's rule survives the simplification and is the reason for the shape:
 * **nothing posts without a confirmation.** An entry is a draft until a named
 * person posts it, and a posted entry is immutable — a correction is another
 * entry, which is what double entry is for.
 */
export const entryStateEnum = pgEnum("journal_state", ["draft", "posted", "void"]);

/** The chart of accounts, typed by hand. */
export const accounts = pgTable(
  "accounts",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    code: text().notNull(),
    name: text().notNull(),
    /** asset, liability, equity, income, expense. Text rather than an enum:
     * a studio that wants a sixth kind should not need a migration. */
    kind: text().notNull().default("expense"),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("accounts_code_idx").on(t.tenantId, t.code)],
);

/**
 * A receipt or an invoice waiting to be entered.
 *
 * `fileId` points into the file store, so a document is a real file with real
 * permissions rather than a second copy of one.
 */
export const documents = pgTable(
  "documents",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    fileId: text(),
    title: text().notNull(),
    supplier: text(),
    documentDate: text(),
    amountMicros: bigint({ mode: "number" }),
    currency: text().notNull().default("HKD"),
    note: text(),
    /** Set once an entry has been written against it, so the inbox can stop
     * showing it without deleting anything. */
    enteredAt: timestamp({ withTimezone: true }),
    addedBy: text().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("documents_idx").on(t.tenantId, t.enteredAt)],
);

export const journalEntries = pgTable(
  "journal_entries",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    documentId: text().references(() => documents.id, { onDelete: "set null" }),
    /** 'YYYY-MM'. The period a posting belongs to, which is not always the
     * month somebody typed it in. */
    period: text().notNull(),
    entryDate: text().notNull(),
    memo: text().notNull().default(""),
    state: entryStateEnum().notNull().default("draft"),
    /** Who confirmed it. Null while it is a draft, and that is the whole of
     * the "nothing posts without a confirmation" rule. */
    postedBy: text().references(() => users.id),
    postedAt: timestamp({ withTimezone: true }),
    createdBy: text().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("journal_entries_idx").on(t.tenantId, t.period, t.state)],
);

/** Debits and credits. An entry does not post until they balance. */
export const journalLines = pgTable(
  "journal_lines",
  {
    id: text().primaryKey(),
    entryId: text()
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: text()
      .notNull()
      .references(() => accounts.id),
    /** Millionths, as everywhere else. Positive is a debit, negative a credit,
     * so "does it balance" is `sum = 0` rather than two columns that can
     * disagree. */
    amountMicros: bigint({ mode: "number" }).notNull(),
    description: text(),
  },
  (t) => [index("journal_lines_idx").on(t.entryId)],
);
