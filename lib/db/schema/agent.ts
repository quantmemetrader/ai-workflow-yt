import {
  bigint,
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
import { moduleEnum, users } from "./core";

/** One agent per employee (spec §5). A conversation is that agent's thread;
 * it runs with exactly the permissions of the person who owns it. */
export const conversations = pgTable(
  "conversations",
  {
    id: text().primaryKey(),
    userId: text().notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text().notNull().default("New chat"),
    module: moduleEnum(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index("conversations_user_idx").on(t.userId, t.updatedAt)],
);

export const agentRoleEnum = pgEnum("agent_role", ["user", "assistant", "system", "tool"]);
export const agentStatusEnum = pgEnum("agent_status", ["streaming", "complete", "failed", "stopped"]);

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: text().primaryKey(),
    conversationId: text().notNull().references(() => conversations.id, { onDelete: "cascade" }),
    role: agentRoleEnum().notNull(),
    content: text().notNull().default(""),
    status: agentStatusEnum().notNull().default("complete"),
    /** The provider's own error text, kept intact — the brief requires the
     * user be told plainly when it is the provider's account, not a bug. */
    error: text(),
    model: text(),
    module: moduleEnum(),
    promptTokens: integer().notNull().default(0),
    completionTokens: integer().notNull().default(0),
    costMicros: bigint({ mode: "number" }).notNull().default(0),
    latencyMs: integer(),
    /** True when the retrieval step dropped matches the viewer may not read.
     * The UI says the answer is partial without naming what was withheld. */
    withheld: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_messages_conv_idx").on(t.conversationId, t.createdAt)],
);

export const citations = pgTable(
  "citations",
  {
    id: text().primaryKey(),
    messageId: text().notNull().references(() => agentMessages.id, { onDelete: "cascade" }),
    fileId: text().notNull(),
    chunkOrd: integer(),
    snippet: text(),
    score: real(),
  },
  (t) => [index("citations_message_idx").on(t.messageId)],
);

export const toolCallStatusEnum = pgEnum("tool_call_status", ["running", "ok", "error"]);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: text().primaryKey(),
    messageId: text().notNull().references(() => agentMessages.id, { onDelete: "cascade" }),
    name: text().notNull(),
    module: moduleEnum(),
    args: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb().$type<unknown>(),
    status: toolCallStatusEnum().notNull().default("running"),
    error: text(),
    durationMs: integer(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tool_calls_message_idx").on(t.messageId)],
);

/** The token ledger (spec §5, Admin §4.11). Every call, attributable, with
 * cost in micro-dollars so the arithmetic stays exact. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    userId: text().notNull().references(() => users.id),
    module: moduleEnum(),
    provider: text().notNull().default("openrouter"),
    model: text().notNull(),
    promptTokens: integer().notNull().default(0),
    completionTokens: integer().notNull().default(0),
    costMicros: bigint({ mode: "number" }).notNull().default(0),
    latencyMs: integer(),
    conversationId: text(),
    messageId: text(),
    requestId: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("ai_usage_user_idx").on(t.userId, t.createdAt),
    index("ai_usage_module_idx").on(t.module, t.createdAt),
    index("ai_usage_created_idx").on(t.createdAt),
  ],
);

export const budgetScopeEnum = pgEnum("budget_scope", ["user", "team", "tenant"]);

/** A cap is a stop, not a warning (brief, Admin → Budgets). */
export const budgets = pgTable(
  "budgets",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    scope: budgetScopeEnum().notNull(),
    scopeId: text().notNull(),
    capMicros: bigint({ mode: "number" }).notNull(),
    /** 'YYYY-MM' for a monthly cap, null for an all-time cap. */
    period: text(),
    updatedBy: text().references(() => users.id),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("budgets_scope_idx").on(t.scope, t.scopeId, t.period)],
);

export const knowledgeKindEnum = pgEnum("knowledge_kind", [
  "instructions",
  "style",
  "skill",
  "example",
]);
export const knowledgeScopeEnum = pgEnum("knowledge_scope", ["tenant", "module", "role"]);

/** The client's own tuning surface — a contract deliverable (Schedule A2(a)).
 * Plain upload, plain toggle, plain rollback. */
export const knowledge = pgTable(
  "knowledge",
  {
    id: text().primaryKey(),
    tenantId: text().notNull(),
    kind: knowledgeKindEnum().notNull(),
    scope: knowledgeScopeEnum().notNull().default("tenant"),
    scopeValue: text(),
    title: text().notNull(),
    body: text().notNull(),
    version: integer().notNull().default(1),
    active: boolean().notNull().default(true),
    updatedBy: text().references(() => users.id),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("knowledge_scope_idx").on(t.scope, t.scopeValue, t.active)],
);

export const knowledgeVersions = pgTable(
  "knowledge_versions",
  {
    id: text().primaryKey(),
    knowledgeId: text().notNull().references(() => knowledge.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    body: text().notNull(),
    note: text(),
    authorId: text().references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("knowledge_versions_idx").on(t.knowledgeId, t.version)],
);
