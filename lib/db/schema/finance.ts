import { bigint, index, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./core";

/**
 * Finance (spec §4.9).
 *
 * Built without waiting for a chart of accounts or a signing policy, at the
 * client's own direction: departments, projects and periods are rows the
 * studio creates on the screen, and the approval thresholds start at
 * "under 500 goes through, 500 to 1,000 needs one approver, above that needs
 * two" and live in `settings`, not in the code.
 *
 * Money is `bigint` millionths of a unit, the same shape `ai_usage` and
 * `budgets` already use for model spend. Two reasons: the model ledger and the
 * finance ledger have to be addable without a conversion nobody remembers, and
 * a float is not a thing to keep books in.
 */
export const spendStateEnum = pgEnum("spend_state", [
  "draft",
  "awaiting_approval",
  "approved",
  "rejected",
  "paid",
  "cancelled",
]);

/** A department or a project: the two things a line can be filed under. */
export const costCentres = pgTable(
  "cost_centres",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    kind: text().notNull().default("department"),
    name: text().notNull(),
    code: text(),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("cost_centres_idx").on(t.tenantId, t.kind, t.name)],
);

/** What was budgeted, per centre per period. `period` is 'YYYY-MM'. */
export const budgetLines = pgTable(
  "budget_lines",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    centreId: text()
      .notNull()
      .references(() => costCentres.id, { onDelete: "cascade" }),
    period: text().notNull(),
    amountMicros: bigint({ mode: "number" }).notNull().default(0),
    note: text(),
    updatedBy: text().references(() => users.id),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("budget_lines_idx").on(t.centreId, t.period)],
);

/**
 * What actually happened.
 *
 * Entered by hand, or written by the module that caused it: model spend rolls
 * up from `ai_usage`, and a paid spend request writes one of these. `source`
 * says which, so a hand-entered figure and a derived one are never confused.
 */
export const actuals = pgTable(
  "actuals",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    centreId: text().references(() => costCentres.id, { onDelete: "set null" }),
    period: text().notNull(),
    /** Positive is money out, negative is money in. One column, because a
     * month's net is the thing everybody actually asks for. */
    amountMicros: bigint({ mode: "number" }).notNull().default(0),
    description: text().notNull().default(""),
    source: text().notNull().default("manual"),
    sourceId: text(),
    enteredBy: text().references(() => users.id),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("actuals_period_idx").on(t.tenantId, t.period)],
);

/**
 * Somebody asking to spend money.
 *
 * `approvalsNeeded` is written when the request is raised, from the thresholds
 * in `settings` at that moment. Storing it rather than recomputing it means a
 * threshold changed next month cannot retroactively make a request that was
 * properly approved look unapproved.
 */
export const spendRequests = pgTable(
  "spend_requests",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    title: text().notNull(),
    description: text().notNull().default(""),
    amountMicros: bigint({ mode: "number" }).notNull(),
    centreId: text().references(() => costCentres.id, { onDelete: "set null" }),
    state: spendStateEnum().notNull().default("draft"),
    approvalsNeeded: bigint({ mode: "number" }).notNull().default(1),
    requestedBy: text()
      .notNull()
      .references(() => users.id),
    neededBy: timestamp({ withTimezone: true }),
    paidAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("spend_requests_idx").on(t.tenantId, t.state, t.createdAt)],
);

/** One person's decision on one request. Several per request when the amount
 * crosses a threshold that asks for more than one. */
export const spendDecisions = pgTable(
  "spend_decisions",
  {
    id: text().primaryKey(),
    requestId: text()
      .notNull()
      .references(() => spendRequests.id, { onDelete: "cascade" }),
    deciderId: text()
      .notNull()
      .references(() => users.id),
    decision: text().notNull(),
    note: text(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("spend_decisions_idx").on(t.requestId, t.deciderId)],
);

/**
 * The monthly management report, written for somebody to edit.
 *
 * The design's fifth Finance screen. A report is a document — it has drafts,
 * it gets shared, and last month's is worth reading next to this month's — so
 * it is a row with a body and a state rather than a page that recomputes from
 * the ledger each time it is opened. The numbers it quotes are the numbers
 * that were true when it was written, which is the point of a report.
 */
export const financeReports = pgTable(
  "finance_reports",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    /** "2026-08", or "2026-Q2" for a quarterly. */
    period: text().notNull(),
    title: text().notNull(),
    /** Markdown, written by the agent and edited by a person. */
    body: text().notNull().default(""),
    /** draft · shared. Nothing is ever deleted; a report is a record. */
    state: text().notNull().default("draft"),
    /** The figures it was written from, kept so a reader can check it. */
    figures: jsonb().$type<Record<string, number>>().notNull().default({}),
    generatedBy: text(),
    sharedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("finance_reports_idx").on(t.tenantId, t.period)],
);
