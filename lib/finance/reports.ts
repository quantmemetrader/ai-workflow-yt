import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { financeReports } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { complete } from "@/lib/ai/openrouter";
import { modelFor } from "@/lib/ai/models";
import { recordUsage } from "@/lib/ai/ledger";
import { budgetVsActual, cashSeries, listActuals, listSpend } from "./service";

/**
 * The monthly management report, written for somebody to edit.
 *
 * The design's fifth Finance screen, and the one that is not a table: a page
 * of prose about the month, generated from the studio's own figures, that a
 * person then edits and shares.
 *
 * Two decisions worth stating:
 *
 *   — **Every number comes from the ledger, and is stored with the report.**
 *     The model is given the figures and told to use them; it is never asked
 *     to recall or estimate one. `figures` keeps what it was given, so a
 *     reader three months later can check the report against the numbers that
 *     were true when it was written rather than against today's.
 *   — **A shared report is frozen.** Editing one makes a new draft rather than
 *     changing what somebody has already read. A management report that can be
 *     quietly rewritten after circulation is not a record.
 */
const PROMPT = `You write the monthly management report for a small Hong Kong video studio.

You are given the studio's own figures. Use them and nothing else — never
estimate, never recall a number from anywhere, and never write a figure that is
not in what you were given. If something is missing, say it is missing.

Write in Markdown, about 300-450 words, in this shape:

## The month in one line
One sentence. What actually happened to the money.

## Against budget
Where spending landed against plan, by cost centre. Name the two or three that
moved; ignore the ones that did not.

## Cash
Where the balance is going, and when that becomes a decision rather than an
observation.

## What needs a decision
Bullets. Only things that genuinely need one, with the number attached. If
there is nothing, say so and stop.

Tone: a competent finance person writing to two colleagues who already know the
business. No preamble, no "in this report", no restating the headings as
sentences. Plain figures, no adjectives about them.`;

export type ReportRow = {
  id: string;
  period: string;
  title: string;
  body: string;
  state: string;
  sharedAt: Date | null;
  updatedAt: Date;
};

export async function listReports(viewer: Viewer): Promise<ReportRow[]> {
  const rows = await db
    .select()
    .from(financeReports)
    .where(eq(financeReports.tenantId, viewer.tenantId))
    .orderBy(desc(financeReports.period), desc(financeReports.updatedAt));

  return rows.map((r) => ({
    id: r.id,
    period: r.period,
    title: r.title,
    body: r.body,
    state: r.state,
    sharedAt: r.sharedAt,
    updatedAt: r.updatedAt,
  }));
}

/**
 * Write one, from the period's own figures.
 *
 * Returns the report whether or not the model answered: a draft containing the
 * figures and a line saying the model could not be reached is more use than an
 * error, because the numbers are the hard part and they are already gathered.
 */
export async function generateReport(viewer: Viewer, period: string): Promise<ReportRow> {
  const [budget, actuals, spend, cash] = await Promise.all([
    budgetVsActual(viewer, period),
    listActuals(viewer, period),
    listSpend(viewer),
    cashSeries(viewer),
  ]);

  const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
  const figures: Record<string, number> = {};

  const lines: string[] = [`Period: ${period}`, "", "Budget against actual, by cost centre:"];
  for (const cell of budget.cells) {
    figures[`budget:${cell.centreName}`] = cell.budgetMicros;
    figures[`actual:${cell.centreName}`] = cell.actualMicros;
    lines.push(
      `- ${cell.centreName}: budget ${usd(cell.budgetMicros)}, spent ${usd(cell.actualMicros)}` +
        (cell.budgetMicros > 0
          ? ` (${Math.round((cell.actualMicros / cell.budgetMicros) * 100)}% of plan)`
          : " (no budget set)"),
    );
  }
  if (budget.cells.length === 0) lines.push("- nothing budgeted for this period");

  const spentTotal = budget.cells.reduce((sum, c) => sum + c.actualMicros, 0);
  const plannedTotal = budget.cells.reduce((sum, c) => sum + c.budgetMicros, 0);
  figures.totalSpent = spentTotal;
  figures.totalBudget = plannedTotal;
  lines.push("", `Total: budget ${usd(plannedTotal)}, spent ${usd(spentTotal)}.`);

  /* `cashSeries` is net movement per period, not a running balance — so the
     report says movement, which is what the data is. Calling it a balance
     would be a number the ledger never claimed. */
  if (cash.length) {
    lines.push("", "Net movement by period:");
    for (const c of cash.slice(-6)) {
      figures[`net:${c.period}`] = c.netMicros;
      lines.push(`- ${c.period}: ${usd(c.netMicros)}`);
    }
  } else {
    lines.push("", "No entries have been recorded, so there is no movement to report.");
  }

  const waiting = spend.filter((s) => s.state === "requested");
  figures.spendRequestsWaiting = waiting.length;
  if (waiting.length) {
    lines.push("", "Spend requests waiting on a decision:");
    for (const s of waiting.slice(0, 10)) {
      lines.push(`- ${s.title} — ${usd(s.amountMicros)}, asked by ${s.requestedByName ?? "somebody"}`);
    }
  }

  lines.push("", `Individual entries this period: ${actuals.length}.`);

  let body: string;
  let model = modelFor.assistant();
  try {
    const out = await complete({
      model,
      temperature: 0.3,
      maxTokens: 2400,
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: lines.join("\n") },
      ],
    });
    model = out.model;
    await recordUsage({
      viewer,
      module: "finance",
      provider: out.provider ?? "openrouter",
      model: out.model,
      promptTokens: out.promptTokens,
      completionTokens: out.completionTokens,
      costMicros: out.costMicros,
      requestId: out.requestId,
    });
    // Reasoning models put their working first; the report is the last thing
    // that looks like a report.
    const cleaned = out.text.replace(/<\/?think(?:ing)?>/gi, "\n").trim();
    const start = cleaned.indexOf("## ");
    body = start > 0 ? cleaned.slice(start) : cleaned;
    if (!body.trim()) throw new Error("the model returned nothing");
  } catch (err) {
    /* The figures are the hard part and they are already here. A draft that
       says the prose is missing beats an error that throws the lot away. */
    body = [
      `## The month in one line`,
      ``,
      `_The model could not be reached (${
        err instanceof Error ? err.message.slice(0, 120) : "unknown"
      }), so this draft is the figures only. Press Regenerate to try again._`,
      ``,
      `## The figures`,
      ``,
      ...lines.map((l) => (l.startsWith("- ") ? l : l ? `${l}` : "")),
    ].join("\n");
  }

  const id = newId("rep");
  await db.insert(financeReports).values({
    id,
    tenantId: viewer.tenantId,
    period,
    title: `${period} management report`,
    body,
    state: "draft",
    figures,
    generatedBy: viewer.id,
  });

  await audit(viewer, "finance.report.generate", {
    objectType: "finance_report",
    objectId: id,
    module: "finance",
    meta: { period, model },
  });

  const [row] = await db.select().from(financeReports).where(eq(financeReports.id, id)).limit(1);
  return {
    id: row.id,
    period: row.period,
    title: row.title,
    body: row.body,
    state: row.state,
    sharedAt: row.sharedAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Edit a draft.
 *
 * A shared report is not edited in place — it is copied to a new draft, and
 * the shared one stays exactly as whoever read it read it.
 */
export async function saveReport(viewer: Viewer, reportId: string, body: string): Promise<string> {
  const [row] = await db
    .select()
    .from(financeReports)
    .where(and(eq(financeReports.id, reportId), eq(financeReports.tenantId, viewer.tenantId)))
    .limit(1);
  if (!row) throw new Error("That report does not exist");

  const text = String(body ?? "").slice(0, 60_000);

  if (row.state === "shared") {
    const id = newId("rep");
    await db.insert(financeReports).values({
      id,
      tenantId: viewer.tenantId,
      period: row.period,
      title: row.title,
      body: text,
      state: "draft",
      figures: row.figures,
      generatedBy: viewer.id,
    });
    await audit(viewer, "finance.report.fork", {
      objectType: "finance_report",
      objectId: id,
      module: "finance",
      meta: { from: row.id },
    });
    return id;
  }

  await db
    .update(financeReports)
    .set({ body: text, updatedAt: new Date() })
    .where(eq(financeReports.id, reportId));
  return reportId;
}

export async function shareReport(viewer: Viewer, reportId: string) {
  const [row] = await db
    .select()
    .from(financeReports)
    .where(and(eq(financeReports.id, reportId), eq(financeReports.tenantId, viewer.tenantId)))
    .limit(1);
  if (!row) throw new Error("That report does not exist");
  if (row.state === "shared") return;

  await db
    .update(financeReports)
    .set({ state: "shared", sharedAt: new Date(), updatedAt: new Date() })
    .where(eq(financeReports.id, reportId));

  await audit(viewer, "finance.report.share", {
    objectType: "finance_report",
    objectId: reportId,
    module: "finance",
    meta: { period: row.period },
  });
}
