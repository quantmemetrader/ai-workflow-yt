import "server-only";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  aiUsage,
  auditLog,
  budgets,
  channels,
  entitlements,
  knowledge,
  knowledgeVersions,
  MODULES,
  teamMembers,
  teams,
  users,
  type Module,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { workRoleOf } from "@/lib/auth/types";
import { AGENT_KEYS, type AgentKey } from "@/lib/agents/catalog";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { env } from "@/lib/env";

/**
 * Admin (spec §4.8 and §8).
 *
 * Almost all of this is screens over tables that already existed and had
 * nothing looking at them: entitlements were edited with a shell script,
 * `budgets` was enforced by the ledger and shown nowhere, `audit_log` recorded
 * every admin file access and nobody could read it, and the assembled prompt
 * was built on every agent turn and never displayed once.
 *
 * Two rules run through the whole module:
 *
 *   — **Keys are referenced, never displayed** (§8). The credentials screen
 *     says which variable is set and what it unlocks. No value, no prefix, no
 *     last four characters. `keyInventory` below returns booleans.
 *   — **An admin's own actions are audited too.** Every write here writes an
 *     audit row, including the ones an admin does to themselves.
 */
function assertAdmin(viewer: Viewer) {
  if (viewer.role !== "owner" && viewer.role !== "admin") {
    throw new Error("Only an owner or an administrator can do that");
  }
}

export function isAdmin(viewer: Viewer): boolean {
  return viewer.role === "owner" || viewer.role === "admin";
}

/* ---------------------------------------------------------------- people */

export type PersonRow = {
  id: string;
  name: string;
  nameLocal: string | null;
  email: string;
  title: string | null;
  /** Their job in the studio (岗位), which picks their Home. Null: not set. */
  workRole: AgentKey | null;
  role: "owner" | "admin" | "member" | "guest";
  status: "active" | "invited" | "suspended";
  avatarUrl: string | null;
  lastActiveAt: Date | null;
  modules: Module[];
  spendMicros: number;
  /** The teams this person is on. The design's People screen has a Team
   * column, and a person can be on more than one. */
  teams: string[];
};

export async function listPeople(viewer: Viewer): Promise<PersonRow[]> {
  assertAdmin(viewer);

  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);

  const [rows, grants, spend, memberships] = await Promise.all([
    db
      .select()
      .from(users)
      .where(and(eq(users.tenantId, viewer.tenantId), isNull(users.deletedAt), eq(users.isAgent, false)))
      .orderBy(users.name),
    db
      .select({ userId: entitlements.userId, module: entitlements.module })
      .from(entitlements)
      .innerJoin(users, eq(users.id, entitlements.userId))
      .where(eq(users.tenantId, viewer.tenantId)),
    // Spend this calendar month, per person. One group-by rather than a query
    // per row: this list is the whole studio.
    db
      .select({ userId: aiUsage.userId, total: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::bigint` })
      .from(aiUsage)
      .where(and(eq(aiUsage.tenantId, viewer.tenantId), gte(aiUsage.createdAt, since)))
      .groupBy(aiUsage.userId),
    db
      .select({ userId: teamMembers.userId, name: teams.name })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teams.tenantId, viewer.tenantId)),
  ]);

  const teamsBy = new Map<string, string[]>();
  for (const m of memberships) {
    const list = teamsBy.get(m.userId) ?? [];
    list.push(m.name);
    teamsBy.set(m.userId, list);
  }

  const byUser = new Map<string, Module[]>();
  for (const g of grants) {
    const list = byUser.get(g.userId) ?? [];
    list.push(g.module);
    byUser.set(g.userId, list);
  }
  const spendBy = new Map(spend.map((s) => [s.userId, Number(s.total)]));

  return rows.map((u) => ({
    id: u.id,
    name: u.name,
    nameLocal: u.nameLocal,
    email: u.email,
    title: u.title,
    workRole: workRoleOf(u.workRole),
    role: u.role,
    status: u.status,
    avatarUrl: u.avatarUrl,
    lastActiveAt: u.lastActiveAt,
    modules: byUser.get(u.id) ?? [],
    spendMicros: spendBy.get(u.id) ?? 0,
    teams: teamsBy.get(u.id) ?? [],
  }));
}

/**
 * Grant or revoke one module for one person.
 *
 * One cell of the matrix at a time, because that is how somebody uses it and
 * because a whole-row save would silently undo a change somebody else made
 * while the screen was open.
 */
export async function setEntitlement(
  viewer: Viewer,
  userId: string,
  module: Module,
  granted: boolean,
) {
  assertAdmin(viewer);
  if (!(MODULES as readonly string[]).includes(module)) throw new Error("No such module");

  const [target] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, viewer.tenantId), isNull(users.deletedAt)))
    .limit(1);
  if (!target) throw new Error("Nobody here has that id");

  if (granted) {
    await db
      .insert(entitlements)
      .values({ userId, module, grantedBy: viewer.id })
      .onConflictDoNothing();
  } else {
    // The owner keeps admin. Locking the only administrator out of the studio
    // is a support call nobody can make, because the screen that fixes it is
    // the one they lost.
    if (module === "admin" && target.role === "owner") {
      throw new Error("The owner keeps the Admin module");
    }
    await db
      .delete(entitlements)
      .where(and(eq(entitlements.userId, userId), eq(entitlements.module, module)));
  }

  await audit(viewer, granted ? "admin.entitlement.grant" : "admin.entitlement.revoke", {
    objectType: "user",
    objectId: userId,
    module: "admin",
    meta: { module },
  });
}

export async function setUserRole(
  viewer: Viewer,
  userId: string,
  role: "admin" | "member" | "guest",
) {
  assertAdmin(viewer);
  if (userId === viewer.id) throw new Error("Change somebody else's role, not your own");

  const [target] = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, viewer.tenantId)))
    .limit(1);
  if (!target) throw new Error("Nobody here has that id");
  if (target.role === "owner") throw new Error("The owner's role is not changed from here");

  await db.update(users).set({ role }).where(eq(users.id, userId));
  await audit(viewer, "admin.user.role", {
    objectType: "user",
    objectId: userId,
    module: "admin",
    meta: { role },
  });
}

/**
 * A person's job in the studio (岗位): research, planning, script, video or
 * article, or null for none. It decides which Home they land on
 * (`lib/home/roles.ts`) and nothing else — what they may open is still
 * their modules, and what they may administer is still `role`.
 *
 * Except one thing: Home and every project live behind the chat module, so a
 * job given to somebody without chat would be a Home they cannot open. Chat
 * is granted with it, and that grant is audited like any other.
 *
 * The owner's row follows the rule the rest of this screen does: the owner's
 * own details are the owner's to change.
 */
export async function setWorkRole(viewer: Viewer, userId: string, role: AgentKey | null) {
  assertAdmin(viewer);
  if (role !== null && !(AGENT_KEYS as readonly string[]).includes(role)) throw new Error("No such job");

  const [target] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, viewer.tenantId), isNull(users.deletedAt), eq(users.isAgent, false)))
    .limit(1);
  if (!target) throw new Error("Nobody here has that id");
  if (target.role === "owner" && viewer.role !== "owner") throw new Error("The owner's job is set by the owner");

  const grantedChat = await db.transaction(async (trx) => {
    await trx.update(users).set({ workRole: role }).where(and(eq(users.id, userId), eq(users.tenantId, viewer.tenantId)));
    if (!role) return false;
    const added = await trx
      .insert(entitlements)
      .values({ userId, module: "chat", grantedBy: viewer.id })
      .onConflictDoNothing()
      .returning({ userId: entitlements.userId });
    return added.length > 0;
  });

  await audit(viewer, "admin.user.workRole", {
    objectType: "user",
    objectId: userId,
    module: "admin",
    meta: { workRole: role, grantedChat },
  });
  if (grantedChat) {
    await audit(viewer, "admin.entitlement.grant", {
      objectType: "user",
      objectId: userId,
      module: "admin",
      meta: { module: "chat", via: "workRole" },
    });
  }
}

export async function setUserStatus(viewer: Viewer, userId: string, status: "active" | "suspended") {
  assertAdmin(viewer);
  if (userId === viewer.id) throw new Error("Suspend somebody else, not yourself");

  const [target] = await db
    .select({ role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.tenantId, viewer.tenantId)))
    .limit(1);
  if (!target) throw new Error("Nobody here has that id");
  if (target.role === "owner") throw new Error("The owner cannot be suspended");

  await db.update(users).set({ status }).where(eq(users.id, userId));
  await audit(viewer, status === "suspended" ? "admin.user.suspend" : "admin.user.restore", {
    objectType: "user",
    objectId: userId,
    module: "admin",
  });
}

/* ---------------------------------------------------------------- tokens */

export type UsageSlice = { key: string; label: string; costMicros: number; tokens: number; calls: number };

export async function usage(viewer: Viewer, days = 30) {
  assertAdmin(viewer);
  const since = new Date(Date.now() - days * 86_400_000);
  const where = and(eq(aiUsage.tenantId, viewer.tenantId), gte(aiUsage.createdAt, since));

  const [byModule, byModel, byPerson, daily] = await Promise.all([
    db
      .select({
        key: sql<string>`coalesce(${aiUsage.module}::text, 'unassigned')`,
        cost: sql<number>`sum(${aiUsage.costMicros})::bigint`,
        tokens: sql<number>`sum(${aiUsage.promptTokens} + ${aiUsage.completionTokens})::bigint`,
        calls: sql<number>`count(*)::int`,
      })
      .from(aiUsage)
      .where(where)
      .groupBy(sql`coalesce(${aiUsage.module}::text, 'unassigned')`),

    db
      .select({
        key: aiUsage.model,
        cost: sql<number>`sum(${aiUsage.costMicros})::bigint`,
        tokens: sql<number>`sum(${aiUsage.promptTokens} + ${aiUsage.completionTokens})::bigint`,
        calls: sql<number>`count(*)::int`,
      })
      .from(aiUsage)
      .where(where)
      .groupBy(aiUsage.model),

    db
      .select({
        key: aiUsage.userId,
        label: users.name,
        cost: sql<number>`sum(${aiUsage.costMicros})::bigint`,
        tokens: sql<number>`sum(${aiUsage.promptTokens} + ${aiUsage.completionTokens})::bigint`,
        calls: sql<number>`count(*)::int`,
      })
      .from(aiUsage)
      .leftJoin(users, eq(users.id, aiUsage.userId))
      .where(where)
      .groupBy(aiUsage.userId, users.name),

    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${aiUsage.createdAt}), 'YYYY-MM-DD')`,
        cost: sql<number>`sum(${aiUsage.costMicros})::bigint`,
      })
      .from(aiUsage)
      .where(where)
      .groupBy(sql`date_trunc('day', ${aiUsage.createdAt})`)
      .orderBy(sql`date_trunc('day', ${aiUsage.createdAt})`),
  ]);

  const slice = (rows: { key: string; label?: string | null; cost: number; tokens: number; calls: number }[]) =>
    rows
      .map((r) => ({
        key: r.key,
        label: r.label ?? r.key,
        costMicros: Number(r.cost),
        tokens: Number(r.tokens),
        calls: r.calls,
      }))
      .sort((a, b) => b.costMicros - a.costMicros);

  return {
    days,
    byModule: slice(byModule),
    byModel: slice(byModel),
    byPerson: slice(byPerson),
    daily: daily.map((d) => ({ day: d.day, costMicros: Number(d.cost) })),
  };
}

/* --------------------------------------------------------------- budgets */

export type BudgetRow = {
  id: string;
  scope: "tenant" | "user" | "team";
  scopeId: string;
  label: string;
  capMicros: number;
  period: string | null;
  usedMicros: number;
};

export async function listBudgets(viewer: Viewer): Promise<BudgetRow[]> {
  assertAdmin(viewer);

  const rows = await db.select().from(budgets).where(eq(budgets.tenantId, viewer.tenantId));
  if (!rows.length) return [];

  const people = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.tenantId, viewer.tenantId));
  const nameById = new Map(people.map((p) => [p.id, p.name]));

  // Spend against each cap, in one pass over the month rather than a query per
  // budget row.
  const month = new Date();
  month.setUTCDate(1);
  month.setUTCHours(0, 0, 0, 0);

  const spend = await db
    .select({
      userId: aiUsage.userId,
      cost: sql<number>`sum(${aiUsage.costMicros})::bigint`,
    })
    .from(aiUsage)
    .where(and(eq(aiUsage.tenantId, viewer.tenantId), gte(aiUsage.createdAt, month)))
    .groupBy(aiUsage.userId);

  let total = 0;
  const byUser = new Map<string, number>();
  for (const s of spend) {
    const cost = Number(s.cost);
    total += cost;
    byUser.set(s.userId, (byUser.get(s.userId) ?? 0) + cost);
  }

  return rows.map((b) => ({
    id: b.id,
    scope: b.scope,
    scopeId: b.scopeId,
    label:
      b.scope === "tenant"
        ? "The whole studio"
        : b.scope === "user"
          ? (nameById.get(b.scopeId) ?? b.scopeId)
          : b.scopeId,
    capMicros: b.capMicros,
    period: b.period,
    /* A team cap has no spend column to read: `ai_usage` records a person and
     * a module, not a team, so a team's spend is the sum of its members' and
     * that join does not exist yet. It shows the cap and says nothing it
     * cannot support. */
    usedMicros:
      b.scope === "tenant" ? total : b.scope === "user" ? (byUser.get(b.scopeId) ?? 0) : 0,
  }));
}

export async function setBudget(
  viewer: Viewer,
  input: { scope: "tenant" | "user" | "team"; scopeId: string; capMicros: number; period: string | null },
) {
  assertAdmin(viewer);
  if (!Number.isFinite(input.capMicros) || input.capMicros < 0) throw new Error("A cap is a positive number");

  await db
    .insert(budgets)
    .values({
      id: newId("bdg"),
      tenantId: viewer.tenantId,
      scope: input.scope,
      scopeId: input.scopeId,
      capMicros: Math.round(input.capMicros),
      period: input.period,
      updatedBy: viewer.id,
    })
    .onConflictDoUpdate({
      target: [budgets.scope, budgets.scopeId, budgets.period],
      set: { capMicros: Math.round(input.capMicros), updatedBy: viewer.id, updatedAt: new Date() },
    });

  await audit(viewer, "admin.budget.set", {
    module: "admin",
    meta: { scope: input.scope, scopeId: input.scopeId, capMicros: input.capMicros },
  });
}

export async function removeBudget(viewer: Viewer, budgetId: string) {
  assertAdmin(viewer);
  await db.delete(budgets).where(and(eq(budgets.id, budgetId), eq(budgets.tenantId, viewer.tenantId)));
  await audit(viewer, "admin.budget.remove", { module: "admin", objectType: "budget", objectId: budgetId });
}

/* ----------------------------------------------------------- credentials */

export type KeyRow = { name: string; set: boolean; unlocks: string };

/**
 * What this deployment holds, without holding it up to the light.
 *
 * Spec §8: keys are referenced, never displayed. Not the value, not a prefix,
 * not the last four characters — a key with four characters shown is a key
 * with four characters fewer to guess. Booleans only.
 */
export function keyInventory(): KeyRow[] {
  return [
    { name: "DATABASE_URL", set: Boolean(env.databaseUrl), unlocks: "Everything. The studio's own data." },
    { name: "R2_ACCESS_KEY_ID", set: Boolean(env.r2.accessKeyId), unlocks: "File storage, uploads and exports." },
    { name: "OPENROUTER_API_KEY", set: Boolean(env.openrouter.apiKey), unlocks: "The agent, and every model call." },
    { name: "ZERNIO_API_KEY", set: env.zernio.configured, unlocks: "Publishing, the comment inbox, channel analytics." },
    { name: "TIKHUB_TOKEN", set: env.tikhub.configured, unlocks: "Reading channels the studio does not own." },
    { name: "CRON_SECRET", set: Boolean(process.env.CRON_SECRET), unlocks: "The nightly housekeeping endpoint." },
  ];
}

export async function listConnections(viewer: Viewer) {
  assertAdmin(viewer);
  const rows = await db
    .select()
    .from(channels)
    .where(eq(channels.tenantId, viewer.tenantId))
    .orderBy(channels.platform);
  return rows.map((c) => ({
    id: c.id,
    platform: c.platform,
    name: c.displayName ?? c.username ?? c.platform,
    status: c.status,
    scopes: c.scopes,
    canPost: c.canPost,
    needsReconnect: c.needsReconnect,
    tokenExpiresAt: c.tokenExpiresAt,
    issues: c.issues,
  }));
}

/* ------------------------------------------------------------- audit log */

export type AuditRow = {
  id: string;
  at: Date;
  actorName: string | null;
  action: string;
  objectType: string | null;
  objectId: string | null;
  module: string | null;
  meta: Record<string, unknown>;
  ip: string | null;
};

export async function listAudit(
  viewer: Viewer,
  options: { action?: string; actorId?: string; limit?: number } = {},
): Promise<AuditRow[]> {
  assertAdmin(viewer);

  const rows = await db
    .select({ log: auditLog, actorName: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(
      and(
        eq(auditLog.tenantId, viewer.tenantId),
        options.action ? eq(auditLog.action, options.action) : undefined,
        options.actorId ? eq(auditLog.actorId, options.actorId) : undefined,
      ),
    )
    .orderBy(desc(auditLog.at))
    .limit(Math.min(options.limit ?? 120, 500));

  return rows.map((r) => ({
    id: r.log.id,
    at: r.log.at,
    actorName: r.actorName,
    action: r.log.action,
    objectType: r.log.objectType,
    objectId: r.log.objectId,
    module: r.log.module,
    meta: r.log.meta,
    ip: r.log.ip,
  }));
}

/** The distinct actions in the log, for the filter. Cheap: the log is indexed
 * on `at` and this is bounded to what a filter can usefully show. */
export async function auditActions(viewer: Viewer): Promise<string[]> {
  assertAdmin(viewer);
  const rows = await db
    .selectDistinct({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.tenantId, viewer.tenantId))
    .orderBy(auditLog.action)
    .limit(120);
  return rows.map((r) => r.action);
}

/* ------------------------------------------------------------- knowledge */

export type KnowledgeRow = {
  id: string;
  kind: "instructions" | "style" | "skill" | "example";
  scope: "tenant" | "module" | "role";
  scopeValue: string | null;
  title: string;
  body: string;
  version: number;
  active: boolean;
  updatedAt: Date;
  updatedByName: string | null;
};

export async function listKnowledge(viewer: Viewer): Promise<KnowledgeRow[]> {
  assertAdmin(viewer);
  const rows = await db
    .select({ k: knowledge, updatedByName: users.name })
    .from(knowledge)
    .leftJoin(users, eq(users.id, knowledge.updatedBy))
    .where(eq(knowledge.tenantId, viewer.tenantId))
    .orderBy(knowledge.kind, knowledge.title);

  return rows.map((r) => ({
    id: r.k.id,
    kind: r.k.kind,
    scope: r.k.scope,
    scopeValue: r.k.scopeValue,
    title: r.k.title,
    body: r.k.body,
    version: r.k.version,
    active: r.k.active,
    updatedAt: r.k.updatedAt,
    updatedByName: r.updatedByName,
  }));
}

export async function saveKnowledge(
  viewer: Viewer,
  input: {
    id?: string | null;
    kind: KnowledgeRow["kind"];
    scope: KnowledgeRow["scope"];
    scopeValue: string | null;
    title: string;
    body: string;
    note?: string | null;
  },
) {
  assertAdmin(viewer);
  const title = input.title.trim();
  if (!title) throw new Error("It needs a title");
  if (!input.body.trim()) throw new Error("It needs a body");

  if (input.id) {
    const [current] = await db
      .select()
      .from(knowledge)
      .where(and(eq(knowledge.id, input.id), eq(knowledge.tenantId, viewer.tenantId)))
      .limit(1);
    if (!current) throw new Error("That does not exist");

    // The previous body becomes a version before the new one lands, so the
    // rollback on screen has something to roll back to.
    await db
      .insert(knowledgeVersions)
      .values({
        id: newId("kn"),
        knowledgeId: current.id,
        version: current.version,
        body: current.body,
        note: input.note ?? null,
        authorId: viewer.id,
      })
      .onConflictDoNothing();

    await db
      .update(knowledge)
      .set({
        kind: input.kind,
        scope: input.scope,
        scopeValue: input.scopeValue,
        title,
        body: input.body,
        version: current.version + 1,
        updatedBy: viewer.id,
        updatedAt: new Date(),
      })
      .where(eq(knowledge.id, current.id));

    await audit(viewer, "admin.knowledge.update", {
      objectType: "knowledge",
      objectId: current.id,
      module: "admin",
      meta: { version: current.version + 1 },
    });
    return current.id;
  }

  const id = newId("kn");
  await db.insert(knowledge).values({
    id,
    tenantId: viewer.tenantId,
    kind: input.kind,
    scope: input.scope,
    scopeValue: input.scopeValue,
    title,
    body: input.body,
    updatedBy: viewer.id,
  });
  await audit(viewer, "admin.knowledge.create", {
    objectType: "knowledge",
    objectId: id,
    module: "admin",
  });
  return id;
}

export async function setKnowledgeActive(viewer: Viewer, id: string, active: boolean) {
  assertAdmin(viewer);
  await db
    .update(knowledge)
    .set({ active, updatedBy: viewer.id, updatedAt: new Date() })
    .where(and(eq(knowledge.id, id), eq(knowledge.tenantId, viewer.tenantId)));
  await audit(viewer, active ? "admin.knowledge.activate" : "admin.knowledge.deactivate", {
    objectType: "knowledge",
    objectId: id,
    module: "admin",
  });
}

export async function knowledgeHistory(viewer: Viewer, id: string) {
  assertAdmin(viewer);
  const [own] = await db
    .select({ id: knowledge.id })
    .from(knowledge)
    .where(and(eq(knowledge.id, id), eq(knowledge.tenantId, viewer.tenantId)))
    .limit(1);
  if (!own) return [];

  const rows = await db
    .select({ v: knowledgeVersions, authorName: users.name })
    .from(knowledgeVersions)
    .leftJoin(users, eq(users.id, knowledgeVersions.authorId))
    .where(eq(knowledgeVersions.knowledgeId, id))
    .orderBy(desc(knowledgeVersions.version))
    .limit(40);

  return rows.map((r) => ({
    version: r.v.version,
    body: r.v.body,
    note: r.v.note,
    authorName: r.authorName,
    createdAt: r.v.createdAt,
  }));
}

export async function rollbackKnowledge(viewer: Viewer, id: string, version: number) {
  assertAdmin(viewer);
  const [current] = await db
    .select()
    .from(knowledge)
    .where(and(eq(knowledge.id, id), eq(knowledge.tenantId, viewer.tenantId)))
    .limit(1);
  if (!current) throw new Error("That does not exist");

  const [old] = await db
    .select()
    .from(knowledgeVersions)
    .where(and(eq(knowledgeVersions.knowledgeId, id), eq(knowledgeVersions.version, version)))
    .limit(1);
  if (!old) throw new Error("There is no such version");

  // A rollback is a new version, not an erasure: the thing being rolled back
  // from stays in the history.
  return saveKnowledge(viewer, {
    id,
    kind: current.kind,
    scope: current.scope,
    scopeValue: current.scopeValue,
    title: current.title,
    body: old.body,
    note: `rolled back to v${version}`,
  });
}
