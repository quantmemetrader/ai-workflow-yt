import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { aiUsage, budgets, notifications, users, type Module } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { newId } from "@/lib/ids";

/**
 * The token ledger and the budget stop (spec §5, §4.11).
 *
 * Two product rules shape this file:
 *   — every AI call is attributable to a person and a module, and the person
 *     can see their own number, not just an admin;
 *   — a cap is a *stop*, not a warning: at the cap, consumption ends and both
 *     the employee and the admin are told.
 */

export const USD = 1_000_000; // micros per dollar

export function currentPeriod(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function periodStart(d = new Date()): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export type BudgetState = {
  usedMicros: number;
  capMicros: number | null;
  /** Which cap bites first — a person can be under their own cap but inside a
   * team that has run out. */
  scope: "user" | "team" | "tenant" | null;
  remainingMicros: number | null;
  /** True when consumption must stop. */
  stopped: boolean;
  /** 0–1, for the meter in the shell. */
  fraction: number;
};

/** What the shell shows and what every AI entry point checks first. */
/**
 * What this account has spent this period, and against which cap.
 *
 * Takes only the three fields it reads rather than a whole `Viewer`. Scheduled
 * work is charged to the service principal, which is an id and a tenant and
 * not a person, and the cap has to stop that too (REVIEW.md #10) — widening
 * the parameter is what lets the job ask the same question a page asks.
 */
export type BudgetSubject = Pick<Viewer, "id" | "tenantId"> & { teamIds?: readonly string[] };

export async function budgetState(viewer: BudgetSubject): Promise<BudgetState> {
  const since = periodStart();
  const period = currentPeriod();

  const [usedRow] = await db
    .select({ total: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::bigint` })
    .from(aiUsage)
    .where(and(eq(aiUsage.userId, viewer.id), gte(aiUsage.createdAt, since)));

  const scopeIds = [viewer.id, ...(viewer.teamIds ?? []), viewer.tenantId];
  const caps = await db
    .select()
    .from(budgets)
    .where(and(inArray(budgets.scopeId, scopeIds), eq(budgets.tenantId, viewer.tenantId)));

  const used = Number(usedRow?.total ?? 0);

  // The user's own cap is the one that can be attributed exactly; team and
  // tenant caps are checked against their own totals below.
  const userCap = caps.find((c) => c.scope === "user" && c.scopeId === viewer.id && (!c.period || c.period === period));

  let capMicros: number | null = userCap ? Number(userCap.capMicros) : null;
  let scope: BudgetState["scope"] = userCap ? "user" : null;
  let usedForScope = used;

  const teamIds = viewer.teamIds ?? [];
  const teamCap = caps.find((c) => c.scope === "team" && teamIds.includes(c.scopeId) && (!c.period || c.period === period));
  if (teamCap) {
    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::bigint` })
      .from(aiUsage)
      .innerJoin(users, eq(users.id, aiUsage.userId))
      .where(and(eq(users.teamId, teamCap.scopeId), gte(aiUsage.createdAt, since)));
    const teamUsed = Number(row?.total ?? 0);
    const teamRemaining = Number(teamCap.capMicros) - teamUsed;
    const userRemaining = capMicros === null ? Infinity : capMicros - usedForScope;
    if (teamRemaining < userRemaining) {
      capMicros = Number(teamCap.capMicros);
      usedForScope = teamUsed;
      scope = "team";
    }
  }

  // A tenant cap was read above and then never consulted, so a studio-wide
  // limit was a number on a screen and not a stop at all. Same rule as the
  // others: whichever cap runs out first is the one that bites.
  const tenantCap = caps.find(
    (c) => c.scope === "tenant" && c.scopeId === viewer.tenantId && (!c.period || c.period === period),
  );
  if (tenantCap) {
    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::bigint` })
      .from(aiUsage)
      .where(and(eq(aiUsage.tenantId, viewer.tenantId), gte(aiUsage.createdAt, since)));
    const tenantUsed = Number(row?.total ?? 0);
    const tenantRemaining = Number(tenantCap.capMicros) - tenantUsed;
    const currentRemaining = capMicros === null ? Infinity : capMicros - usedForScope;
    if (tenantRemaining < currentRemaining) {
      capMicros = Number(tenantCap.capMicros);
      usedForScope = tenantUsed;
      scope = "tenant";
    }
  }

  const remaining = capMicros === null ? null : Math.max(0, capMicros - usedForScope);

  return {
    usedMicros: used,
    capMicros,
    scope,
    remainingMicros: remaining,
    stopped: capMicros !== null && usedForScope >= capMicros,
    fraction: capMicros ? Math.min(1, usedForScope / capMicros) : 0,
  };
}

export class BudgetStop extends Error {
  constructor(readonly state: BudgetState) {
    super("Budget cap reached");
    this.name = "BudgetStop";
  }
}

/** Call before any model request. Throws `BudgetStop` at the cap. */
export async function assertBudget(viewer: BudgetSubject): Promise<BudgetState> {
  const state = await budgetState(viewer);
  if (state.stopped) throw new BudgetStop(state);
  return state;
}

export type UsageRecord = {
  viewer: Pick<Viewer, "id" | "tenantId">;
  module: Module | null;
  model: string;
  provider?: string;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  latencyMs?: number;
  conversationId?: string;
  messageId?: string;
  requestId?: string;
};

/** Writes one ledger row, and notifies when this call is the one that hits the
 * cap. Never throws into the caller's stream: metering must not break an
 * answer that already reached the user. */
export async function recordUsage(rec: UsageRecord): Promise<void> {
  try {
    await db.insert(aiUsage).values({
      id: newId("use"),
      tenantId: rec.viewer.tenantId,
      userId: rec.viewer.id,
      module: rec.module ?? undefined,
      provider: rec.provider ?? "openrouter",
      model: rec.model,
      promptTokens: rec.promptTokens,
      completionTokens: rec.completionTokens,
      costMicros: rec.costMicros,
      latencyMs: rec.latencyMs,
      conversationId: rec.conversationId,
      messageId: rec.messageId,
      requestId: rec.requestId,
    });
  } catch (err) {
    console.error("[ledger] failed to record usage", err);
  }
}

/**
 * Both the employee and an admin are told when consumption stops (§4.11).
 *
 * Once stopped, every further attempt lands here, so the ids are derived from
 * the person and the period rather than generated: `onConflictDoNothing` on a
 * fresh random id conflicts with nothing, and an employee who kept typing
 * would have buried themselves and every admin in the same notice.
 */
export async function notifyBudgetStop(viewer: Viewer, state: BudgetState) {
  const admins = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, viewer.tenantId), inArray(users.role, ["owner", "admin"])));

  const period = currentPeriod();
  const dollars = ((state.capMicros ?? 0) / USD).toFixed(2);
  const once = (userId: string) => `ntf_budget_${period}_${viewer.id}_${userId}`;
  const rows = [
    {
      id: once(viewer.id),
      userId: viewer.id,
      kind: "budget" as const,
      title: "AI budget reached",
      body: `Your assistant has stopped: this period's cap of US$${dollars} is used up.`,
      href: "/admin/tokens",
    },
    ...admins
      .filter((a) => a.id !== viewer.id)
      .map((a) => ({
        id: once(a.id),
        userId: a.id,
        kind: "budget" as const,
        title: `${viewer.name} has hit their AI cap`,
        body: `Consumption stopped at US$${dollars} for this period.`,
        href: "/admin/budgets",
      })),
  ];

  await db.insert(notifications).values(rows).onConflictDoNothing();
}

export function formatUsd(micros: number): string {
  const usd = micros / USD;
  if (usd === 0) return "US$0.00";
  if (usd < 0.01) return `US$${usd.toFixed(4)}`;
  return `US$${usd.toFixed(2)}`;
}
