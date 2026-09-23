import "server-only";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  actuals,
  aiUsage,
  budgetLines,
  costCentres,
  settings,
  spendDecisions,
  spendRequests,
  users,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";

/**
 * Finance (spec §4.9).
 *
 * Built on defaults rather than on a wait: departments, projects and periods
 * are rows the studio creates here, and the thresholds that decide who signs a
 * spend request start at the client's own numbers and live in `settings`.
 *
 * Money is millionths throughout, the same unit `ai_usage` records model spend
 * in, so the cost dashboard and the ledger add up without a conversion
 * somewhere in the middle that somebody will eventually get wrong.
 */
/* `settings` is keyed by key alone, with no tenant column, so the tenant goes
 * in the key. One deployment is one studio today; this is what keeps that from
 * being an assumption baked into a row. */
const thresholdKey = (tenantId: string) => `finance.thresholds:${tenantId}`;

export type Thresholds = {
  /** Below this, a request needs nobody. */
  autoBelow: number;
  /** Below this, one approver. At or above it, two. */
  oneApproverBelow: number;
};

/** The client's own numbers, 19 Sep: under 500 goes through, 500 to 1,000
 * needs one approver, above that needs two. Editable on the screen. */
export const DEFAULT_THRESHOLDS: Thresholds = { autoBelow: 500, oneApproverBelow: 1000 };

export async function thresholds(viewer: Viewer): Promise<Thresholds> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, thresholdKey(viewer.tenantId)))
    .limit(1);

  const v = row?.value as Partial<Thresholds> | undefined;
  return {
    autoBelow: Number.isFinite(v?.autoBelow) ? Number(v?.autoBelow) : DEFAULT_THRESHOLDS.autoBelow,
    oneApproverBelow: Number.isFinite(v?.oneApproverBelow)
      ? Number(v?.oneApproverBelow)
      : DEFAULT_THRESHOLDS.oneApproverBelow,
  };
}

export async function setThresholds(viewer: Viewer, next: Thresholds) {
  if (viewer.role !== "owner" && viewer.role !== "admin") {
    throw new Error("Only an owner or an administrator changes the signing thresholds");
  }
  if (!(next.autoBelow >= 0) || !(next.oneApproverBelow >= next.autoBelow)) {
    throw new Error("The second threshold has to be at least the first");
  }

  await db
    .insert(settings)
    .values({ key: thresholdKey(viewer.tenantId), value: next, updatedBy: viewer.id })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: next, updatedBy: viewer.id, updatedAt: new Date() },
    });

  await audit(viewer, "finance.thresholds.set", { module: "finance", meta: { ...next } });
}

/** How many people have to sign off on an amount, in whole units. */
export function approvalsFor(amount: number, t: Thresholds): number {
  if (amount < t.autoBelow) return 0;
  if (amount < t.oneApproverBelow) return 1;
  return 2;
}

/* --------------------------------------------------------------- centres */

export type CentreRow = { id: string; kind: string; name: string; code: string | null };

export async function listCentres(viewer: Viewer): Promise<CentreRow[]> {
  const rows = await db
    .select()
    .from(costCentres)
    .where(and(eq(costCentres.tenantId, viewer.tenantId), isNull(costCentres.archivedAt)))
    .orderBy(costCentres.kind, costCentres.name);
  return rows.map((c) => ({ id: c.id, kind: c.kind, name: c.name, code: c.code }));
}

export async function createCentre(viewer: Viewer, input: { kind: string; name: string; code?: string }) {
  const name = input.name.trim();
  if (!name) throw new Error("It needs a name");
  const id = newId("cf");
  await db
    .insert(costCentres)
    .values({
      id,
      tenantId: viewer.tenantId,
      kind: input.kind === "project" ? "project" : "department",
      name,
      code: input.code?.trim() || null,
    })
    .onConflictDoNothing();
  await audit(viewer, "finance.centre.create", { module: "finance", meta: { name } });
  return id;
}

export async function archiveCentre(viewer: Viewer, centreId: string) {
  await db
    .update(costCentres)
    .set({ archivedAt: new Date() })
    .where(and(eq(costCentres.id, centreId), eq(costCentres.tenantId, viewer.tenantId)));
  await audit(viewer, "finance.centre.archive", { module: "finance", objectId: centreId });
}

/* ------------------------------------------------------- budget and cash */

export type BudgetCell = {
  centreId: string;
  centreName: string;
  kind: string;
  budgetMicros: number;
  actualMicros: number;
};

/**
 * Budget against actuals for one period, plus the model spend for the same
 * window, which is the one figure the studio already had and never saw here.
 */
export async function budgetVsActual(viewer: Viewer, period: string) {
  const [centres, lines, spent, models] = await Promise.all([
    listCentres(viewer),
    db
      .select()
      .from(budgetLines)
      .where(and(eq(budgetLines.tenantId, viewer.tenantId), eq(budgetLines.period, period))),
    db
      .select({
        centreId: actuals.centreId,
        total: sql<number>`coalesce(sum(${actuals.amountMicros}), 0)::bigint`,
      })
      .from(actuals)
      .where(and(eq(actuals.tenantId, viewer.tenantId), eq(actuals.period, period)))
      .groupBy(actuals.centreId),
    // Model spend for the month, straight from the ledger.
    db
      .select({ total: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)::bigint` })
      .from(aiUsage)
      .where(
        and(
          eq(aiUsage.tenantId, viewer.tenantId),
          sql`to_char(${aiUsage.createdAt}, 'YYYY-MM') = ${period}`,
        ),
      ),
  ]);

  const budgetBy = new Map(lines.map((l) => [l.centreId, l.amountMicros]));
  const actualBy = new Map(spent.map((s) => [s.centreId ?? "", Number(s.total)]));

  const cells: BudgetCell[] = centres.map((c) => ({
    centreId: c.id,
    centreName: c.name,
    kind: c.kind,
    budgetMicros: budgetBy.get(c.id) ?? 0,
    actualMicros: actualBy.get(c.id) ?? 0,
  }));

  return {
    period,
    cells,
    /** Actuals nobody filed under a centre. Shown rather than dropped. */
    unfiledMicros: actualBy.get("") ?? 0,
    modelSpendMicros: Number(models[0]?.total ?? 0),
  };
}

export async function setBudgetLine(viewer: Viewer, centreId: string, period: string, amountMicros: number) {
  await db
    .insert(budgetLines)
    .values({
      id: newId("bl"),
      tenantId: viewer.tenantId,
      centreId,
      period,
      amountMicros: Math.round(amountMicros),
      updatedBy: viewer.id,
    })
    .onConflictDoUpdate({
      target: [budgetLines.centreId, budgetLines.period],
      set: { amountMicros: Math.round(amountMicros), updatedBy: viewer.id, updatedAt: new Date() },
    });
  await audit(viewer, "finance.budget.set", { module: "finance", meta: { centreId, period } });
}

export type ActualRow = {
  id: string;
  period: string;
  centreId: string | null;
  centreName: string | null;
  amountMicros: number;
  description: string;
  source: string;
  at: Date;
  enteredByName: string | null;
};

export async function listActuals(viewer: Viewer, period?: string): Promise<ActualRow[]> {
  const rows = await db
    .select({ a: actuals, centreName: costCentres.name, byName: users.name })
    .from(actuals)
    .leftJoin(costCentres, eq(costCentres.id, actuals.centreId))
    .leftJoin(users, eq(users.id, actuals.enteredBy))
    .where(and(eq(actuals.tenantId, viewer.tenantId), period ? eq(actuals.period, period) : undefined))
    .orderBy(desc(actuals.at))
    .limit(200);

  return rows.map((r) => ({
    id: r.a.id,
    period: r.a.period,
    centreId: r.a.centreId,
    centreName: r.centreName,
    amountMicros: r.a.amountMicros,
    description: r.a.description,
    source: r.a.source,
    at: r.a.at,
    enteredByName: r.byName,
  }));
}

export async function addActual(
  viewer: Viewer,
  input: { period: string; centreId: string | null; amountMicros: number; description: string },
) {
  const id = newId("cf");
  await db.insert(actuals).values({
    id,
    tenantId: viewer.tenantId,
    period: input.period,
    centreId: input.centreId,
    amountMicros: Math.round(input.amountMicros),
    description: input.description.slice(0, 500),
    source: "manual",
    enteredBy: viewer.id,
  });
  await audit(viewer, "finance.actual.add", { module: "finance", objectId: id });
  return id;
}

export async function removeActual(viewer: Viewer, id: string) {
  await db.delete(actuals).where(and(eq(actuals.id, id), eq(actuals.tenantId, viewer.tenantId)));
  await audit(viewer, "finance.actual.remove", { module: "finance", objectId: id });
}

/* -------------------------------------------------------- spend requests */

export type SpendRow = {
  id: string;
  title: string;
  description: string;
  amountMicros: number;
  centreName: string | null;
  state: string;
  approvalsNeeded: number;
  requestedById: string;
  requestedByName: string | null;
  neededBy: Date | null;
  createdAt: Date;
  decisions: { deciderName: string | null; decision: string; note: string | null; at: Date }[];
};

export async function listSpend(viewer: Viewer): Promise<SpendRow[]> {
  const rows = await db
    .select({ r: spendRequests, centreName: costCentres.name, byName: users.name })
    .from(spendRequests)
    .leftJoin(costCentres, eq(costCentres.id, spendRequests.centreId))
    .leftJoin(users, eq(users.id, spendRequests.requestedBy))
    .where(eq(spendRequests.tenantId, viewer.tenantId))
    .orderBy(desc(spendRequests.createdAt))
    .limit(120);

  if (!rows.length) return [];

  const decisions = await db
    .select({ d: spendDecisions, name: users.name })
    .from(spendDecisions)
    .leftJoin(users, eq(users.id, spendDecisions.deciderId))
    .where(inArray(spendDecisions.requestId, rows.map((r) => r.r.id)));

  const byRequest = new Map<string, SpendRow["decisions"]>();
  for (const d of decisions) {
    const list = byRequest.get(d.d.requestId) ?? [];
    list.push({ deciderName: d.name, decision: d.d.decision, note: d.d.note, at: d.d.at });
    byRequest.set(d.d.requestId, list);
  }

  return rows.map((r) => ({
    id: r.r.id,
    title: r.r.title,
    description: r.r.description,
    amountMicros: r.r.amountMicros,
    centreName: r.centreName,
    state: r.r.state,
    approvalsNeeded: r.r.approvalsNeeded,
    requestedById: r.r.requestedBy,
    requestedByName: r.byName,
    neededBy: r.r.neededBy,
    createdAt: r.r.createdAt,
    decisions: byRequest.get(r.r.id) ?? [],
  }));
}

export async function raiseSpend(
  viewer: Viewer,
  input: { title: string; description: string; amountMicros: number; centreId: string | null; neededBy: Date | null },
) {
  const title = input.title.trim();
  if (!title) throw new Error("It needs a title");
  if (!(input.amountMicros > 0)) throw new Error("An amount is a positive number");

  const t = await thresholds(viewer);
  const needed = approvalsFor(input.amountMicros / 1_000_000, t);

  const id = newId("req");
  await db.insert(spendRequests).values({
    id,
    tenantId: viewer.tenantId,
    title,
    description: input.description.slice(0, 4000),
    amountMicros: Math.round(input.amountMicros),
    centreId: input.centreId,
    // Under the first threshold it needs nobody, so it is approved as it is
    // raised, and the record says so rather than pretending somebody signed.
    state: needed === 0 ? "approved" : "awaiting_approval",
    approvalsNeeded: needed,
    requestedBy: viewer.id,
    neededBy: input.neededBy,
  });

  await audit(viewer, "finance.spend.raise", {
    module: "finance",
    objectType: "spend_request",
    objectId: id,
    meta: { amountMicros: input.amountMicros, approvalsNeeded: needed },
  });
  return id;
}

/**
 * One person's decision.
 *
 * The person who raised it cannot be one of the approvers, and each approver
 * counts once: the unique index on (request, decider) is what makes "two
 * approvals" mean two people rather than one person twice.
 */
export async function decideSpend(
  viewer: Viewer,
  requestId: string,
  decision: "approve" | "reject",
  note: string | null,
) {
  const [req] = await db
    .select()
    .from(spendRequests)
    .where(and(eq(spendRequests.id, requestId), eq(spendRequests.tenantId, viewer.tenantId)))
    .limit(1);
  if (!req) throw new Error("That request does not exist");
  if (req.state !== "awaiting_approval") throw new Error("That request is not waiting for a decision");
  if (req.requestedBy === viewer.id) throw new Error("Somebody other than the person who asked has to decide");

  await db
    .insert(spendDecisions)
    .values({ id: newId("req"), requestId, deciderId: viewer.id, decision, note })
    .onConflictDoUpdate({
      target: [spendDecisions.requestId, spendDecisions.deciderId],
      set: { decision, note, at: new Date() },
    });

  if (decision === "reject") {
    await db
      .update(spendRequests)
      .set({ state: "rejected", updatedAt: new Date() })
      .where(eq(spendRequests.id, requestId));
  } else {
    const [count] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(spendDecisions)
      .where(and(eq(spendDecisions.requestId, requestId), eq(spendDecisions.decision, "approve")));
    if ((count?.n ?? 0) >= req.approvalsNeeded) {
      await db
        .update(spendRequests)
        .set({ state: "approved", updatedAt: new Date() })
        .where(eq(spendRequests.id, requestId));
    }
  }

  await audit(viewer, `finance.spend.${decision}`, {
    module: "finance",
    objectType: "spend_request",
    objectId: requestId,
  });
}

/** Marking it paid writes the actual, so the budget screen reflects it
 * without anybody typing the same number twice. */
export async function markSpendPaid(viewer: Viewer, requestId: string, period: string) {
  const [req] = await db
    .select()
    .from(spendRequests)
    .where(and(eq(spendRequests.id, requestId), eq(spendRequests.tenantId, viewer.tenantId)))
    .limit(1);
  if (!req) throw new Error("That request does not exist");
  if (req.state !== "approved") throw new Error("Only an approved request is paid");

  await db
    .update(spendRequests)
    .set({ state: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(eq(spendRequests.id, requestId));

  await db.insert(actuals).values({
    id: newId("cf"),
    tenantId: viewer.tenantId,
    centreId: req.centreId,
    period,
    amountMicros: req.amountMicros,
    description: req.title,
    source: "spend_request",
    sourceId: req.id,
    enteredBy: viewer.id,
  });

  await audit(viewer, "finance.spend.paid", {
    module: "finance",
    objectType: "spend_request",
    objectId: requestId,
  });
}

/* ------------------------------------------------------------- reporting */

/** Twelve months of net movement, for the cash line. */
export async function cashSeries(viewer: Viewer, months = 12) {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - months);

  const rows = await db
    .select({
      period: actuals.period,
      total: sql<number>`coalesce(sum(${actuals.amountMicros}), 0)::bigint`,
    })
    .from(actuals)
    .where(and(eq(actuals.tenantId, viewer.tenantId), gte(actuals.at, since)))
    .groupBy(actuals.period)
    .orderBy(actuals.period);

  return rows.map((r) => ({ period: r.period, netMicros: Number(r.total) }));
}
