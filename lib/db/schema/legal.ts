import { index, jsonb, pgEnum, pgTable, text, timestamp, boolean } from "drizzle-orm/pg-core";
import { users } from "./core";

/**
 * Legal (spec §4.10).
 *
 * Manual and template-driven, at the client's own direction: the studio writes
 * its own templates on the drafting screen rather than handing a pack over
 * first, and the module ships with the two a video channel of this kind
 * actually signs — a contributor and likeness release, and a freelance
 * production services agreement.
 *
 * One rule shapes the review side: **clause review marks departures and never
 * renders a verdict.** A finding has a clause, what the template said, what
 * this contract says, and why they differ. There is no "risk score" column and
 * there will not be one; the non-advice notice (contract 8.4) stands on every
 * screen.
 */
export const contractStateEnum = pgEnum("contract_state", [
  "draft",
  "in_review",
  "sent",
  "signed",
  "expired",
  "terminated",
]);

export const templates = pgTable(
  "templates",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    name: text().notNull(),
    kind: text().notNull().default("agreement"),
    body: text().notNull().default(""),
    /** `{{ field }}` names the drafting screen asks for, in order. */
    fields: jsonb().$type<{ key: string; label: string; hint?: string }[]>().notNull().default([]),
    active: boolean().notNull().default(true),
    updatedBy: text().references(() => users.id),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("templates_idx").on(t.tenantId, t.active)],
);

export const contracts = pgTable(
  "contracts",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    templateId: text().references(() => templates.id, { onDelete: "set null" }),
    title: text().notNull(),
    counterparty: text(),
    body: text().notNull().default(""),
    values: jsonb().$type<Record<string, string>>().notNull().default({}),
    state: contractStateEnum().notNull().default("draft"),
    /** Dates the repository screen sorts and warns on. */
    signedOn: text(),
    expiresOn: text(),
    /** The signed PDF in the file store, when there is one. */
    fileId: text(),
    ownerId: text().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contracts_idx").on(t.tenantId, t.state, t.expiresOn)],
);

/**
 * Where a contract departs from the template it came from.
 *
 * No verdict, by design: `severity` is how far it departs, not how bad it is,
 * and `explanation` says what changed rather than what to do about it.
 */
export const clauseFindings = pgTable(
  "clause_findings",
  {
    id: text().primaryKey(),
    contractId: text()
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    clause: text().notNull(),
    templateText: text(),
    contractText: text(),
    explanation: text().notNull().default(""),
    /** 'same' | 'reworded' | 'changed' | 'missing' | 'added'. */
    departure: text().notNull().default("changed"),
    /** Somebody has looked at it and is content. Not a verdict on the clause,
     * a record that a person read it. */
    acknowledgedBy: text().references(() => users.id),
    acknowledgedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("clause_findings_idx").on(t.contractId)],
);

export const checklists = pgTable(
  "compliance_checklists",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    name: text().notNull(),
    items: jsonb().$type<{ key: string; text: string }[]>().notNull().default([]),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("checklists_idx").on(t.tenantId)],
);

export const checklistRuns = pgTable(
  "checklist_runs",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    checklistId: text()
      .notNull()
      .references(() => checklists.id, { onDelete: "cascade" }),
    subject: text(),
    /** key → 'yes' | 'no' | 'na', plus a note per key where somebody wrote one. */
    answers: jsonb().$type<Record<string, { value: string; note?: string }>>().notNull().default({}),
    ranBy: text().references(() => users.id),
    completedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("checklist_runs_idx").on(t.tenantId, t.createdAt)],
);
