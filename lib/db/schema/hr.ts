import { boolean, index, integer, pgEnum, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./core";

/**
 * Human Resources (spec §4.11).
 *
 * Manual, at the client's own direction: leave starts at Hong Kong statutory
 * entitlement with a single approver, both edited on the screen, and
 * candidates are entered by hand.
 *
 * Two rules are structural rather than cosmetic:
 *
 *   — **No external sourcing, ever** (Schedule A3(8)). There is no field for a
 *     profile URL scraped from anywhere, and no job-board integration to add
 *     one later. A candidate exists because somebody typed them in or they
 *     applied.
 *   — **Consent and retention are columns, not policy documents.** A candidate
 *     record carries when they consented and when the record is to be
 *     destroyed, because a retention date nobody can query is a retention date
 *     nobody keeps.
 */
export const leaveStateEnum = pgEnum("leave_state", ["requested", "approved", "rejected", "cancelled"]);
export const applicationStageEnum = pgEnum("application_stage", [
  "applied",
  "screening",
  "interview",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
]);

/** The employment side of a person who already has an account. */
export const employeeRecords = pgTable(
  "employee_records",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    employeeNo: text(),
    jobTitle: text(),
    department: text(),
    managerId: text().references(() => users.id),
    startedOn: text(),
    endedOn: text(),
    employmentType: text().notNull().default("full_time"),
    notes: text(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("employee_records_idx").on(t.tenantId, t.userId)],
);

/**
 * How much leave of each kind somebody has, per year.
 *
 * `entitlementDays` is seeded from Hong Kong statutory leave and then edited,
 * which is why it is a column rather than a constant: a studio that gives
 * eighteen days should not need a deployment.
 */
export const leaveBalances = pgTable(
  "leave_balances",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    year: integer().notNull(),
    kind: text().notNull().default("annual"),
    entitlementDays: real().notNull().default(0),
    carriedDays: real().notNull().default(0),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("leave_balances_idx").on(t.tenantId, t.userId, t.year, t.kind)],
);

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text().notNull().default("annual"),
    startOn: text().notNull(),
    endOn: text().notNull(),
    days: real().notNull().default(1),
    reason: text(),
    state: leaveStateEnum().notNull().default("requested"),
    decidedBy: text().references(() => users.id),
    decidedAt: timestamp({ withTimezone: true }),
    decisionNote: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("leave_requests_idx").on(t.tenantId, t.state, t.startOn)],
);

export const requisitions = pgTable(
  "requisitions",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    title: text().notNull(),
    department: text(),
    headcount: integer().notNull().default(1),
    description: text().notNull().default(""),
    /** open | on_hold | filled | closed. */
    state: text().notNull().default("open"),
    openedBy: text().references(() => users.id),
    openedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("requisitions_idx").on(t.tenantId, t.state)],
);

/**
 * Somebody who applied, or whom somebody entered.
 *
 * `consentAt` and `retainUntil` are not optional in spirit: a record with
 * neither is a record nobody can justify keeping, and the screen says so.
 */
export const candidates = pgTable(
  "candidates",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    name: text().notNull(),
    email: text(),
    phone: text(),
    /** Where they came from, in the studio's own words. Never a scrape. */
    source: text().notNull().default("direct"),
    notes: text(),
    /** The CV in the file store, when one was sent. */
    fileId: text(),
    consentAt: timestamp({ withTimezone: true }),
    retainUntil: text(),
    addedBy: text().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("candidates_idx").on(t.tenantId, t.createdAt)],
);

export const applications = pgTable(
  "applications",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    candidateId: text()
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    requisitionId: text()
      .notNull()
      .references(() => requisitions.id, { onDelete: "cascade" }),
    stage: applicationStageEnum().notNull().default("applied"),
    note: text(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("applications_idx").on(t.candidateId, t.requisitionId)],
);

export const onboardingTasks = pgTable(
  "onboarding_tasks",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text().notNull(),
    done: boolean().notNull().default(false),
    dueOn: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("onboarding_tasks_idx").on(t.tenantId, t.userId, t.done)],
);
