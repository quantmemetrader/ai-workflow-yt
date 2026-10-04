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

/* (QA, 2 Oct: the studio reads in Chinese and the drafts came out in English.)
   Same rules, Chinese headings, written for zh readers. */
const PROMPT_ZH = `你为一家香港小型视频工作室撰写月度管理报告。

你会拿到工作室自己的数据。只用这些数据：不要估算，不要凭记忆写数字，
没给你的数字一个都不要写。缺什么就直说缺什么。

用 Markdown、简体中文写，300 到 450 字，结构如下：

## 本月一句话
一句话说清钱这个月发生了什么。

## 预算执行
各部门或项目的花费和计划相比落在哪里。只点名变化最大的两三个，没变化的不提。

## 现金
钱往哪里走，到什么时候需要做决定。

## 待决定事项
用列表。只列真正需要决定的事，每条附上数字。没有就写"暂无"，然后结束。

语气：像一位能干的财务写给两位熟悉业务的同事。不要开场白，不要"本报告"，
不要把标题再复述一遍。数字直接写，不加形容词。不要用破折号。`;

/** "2026-09" → "2026 年 9 月管理报告" (zh) or "2026-09 management report". */
export function reportTitle(period: string, zh: boolean): string {
  if (!zh) return `${period} management report`;
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) return `${m[1]} 年 ${Number(m[2])} 月管理报告`;
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  return q ? `${q[1]} 年第 ${q[2]} 季度管理报告` : `${period} 管理报告`;
}

export type ReportRow = {
  id: string;
  bodyHtml?: string | null;
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

  /* (QA, 2 Oct: the list showed two identical 2026-09 drafts.) One draft per
     period is what the screen means by "the draft"; the newest wins. Shared
     reports are records and are all kept. */
  const draftSeen = new Set<string>();
  const kept = rows.filter((r) => {
    if (r.state !== "draft") return true;
    if (draftSeen.has(r.period)) return false;
    draftSeen.add(r.period);
    return true;
  });

  return kept.map((r) => ({
    id: r.id,
    period: r.period,
    title: r.title,
    body: r.body,
    bodyHtml: r.bodyHtml,
    state: r.state,
    sharedAt: r.sharedAt,
    updatedAt: r.updatedAt,
  }));
}

/** One report, for its document page and its download. */
export async function getReport(viewer: Viewer, reportId: string): Promise<ReportRow | null> {
  const [r] = await db
    .select()
    .from(financeReports)
    .where(and(eq(financeReports.id, reportId), eq(financeReports.tenantId, viewer.tenantId)))
    .limit(1);
  if (!r) return null;
  return { id: r.id, period: r.period, title: r.title, body: r.body, bodyHtml: r.bodyHtml, state: r.state, sharedAt: r.sharedAt, updatedAt: r.updatedAt };
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

  const usd = (micros: number) => `US$ ${(Math.round(micros / 10_000) / 100).toFixed(2)}`;
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
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
  /* AI spend comes straight from the ledger and is not in the entries above. */
  figures.aiSpend = budget.modelSpendMicros;
  lines.push(`AI model spend this period (recorded automatically, not in the entries above): ${usd(budget.modelSpendMicros)}.`);

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

  /* `awaiting_approval` is what `raiseSpend` writes; this read "requested",
     a state no request is ever in, so the report always said none waited. */
  const waiting = spend.filter((s) => s.state === "awaiting_approval");
  figures.spendRequestsWaiting = waiting.length;
  if (waiting.length) {
    lines.push("", "Spend requests waiting on a decision:");
    for (const s of waiting.slice(0, 10)) {
      lines.push(`- ${s.title}: ${usd(s.amountMicros)}, asked by ${s.requestedByName ?? "somebody"}`);
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
        { role: "system", content: zh ? PROMPT_ZH : PROMPT },
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
    const why = err instanceof Error ? err.message.slice(0, 120) : "unknown";
    body = [
      zh ? `## 本月一句话` : `## The month in one line`,
      ``,
      zh
        ? `_这次没能连上 AI（${why}），草稿里只有数据。点「重新生成」再试一次。_`
        : `_The model could not be reached (${why}), so this draft is the figures only. Press Regenerate to try again._`,
      ``,
      zh ? `## 数据` : `## The figures`,
      ``,
      ...lines.map((l) => (l.startsWith("- ") ? l : l ? `${l}` : "")),
    ].join("\n");
  }

  /* (QA, 2 Oct: pressing 撰写 or 重新生成 twice left two identical drafts for
     the same month.) A period has one draft: writing again rewrites it. A
     shared report is never touched, so the record stays what people read. */
  const title = reportTitle(period, zh);
  const [existing] = await db
    .select({ id: financeReports.id })
    .from(financeReports)
    .where(and(eq(financeReports.tenantId, viewer.tenantId), eq(financeReports.period, period), eq(financeReports.state, "draft")))
    .orderBy(desc(financeReports.updatedAt))
    .limit(1);
  const id = existing?.id ?? newId("rep");
  if (existing) {
    await db
      .update(financeReports)
      .set({ title, body, bodyHtml: null, figures, generatedBy: viewer.id, updatedAt: new Date() })
      .where(eq(financeReports.id, id));
  } else {
    await db.insert(financeReports).values({
      id,
      tenantId: viewer.tenantId,
      period,
      title,
      body,
      state: "draft",
      figures,
      generatedBy: viewer.id,
    });
  }

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
export async function saveReport(viewer: Viewer, reportId: string, body: string, html: string | null = null): Promise<string> {
  const [row] = await db
    .select()
    .from(financeReports)
    .where(and(eq(financeReports.id, reportId), eq(financeReports.tenantId, viewer.tenantId)))
    .limit(1);
  if (!row) throw new Error("这份报告不存在");

  const text = String(body ?? "").slice(0, 60_000);

  if (row.state === "shared") {
    const id = newId("rep");
    await db.insert(financeReports).values({
      id,
      tenantId: viewer.tenantId,
      period: row.period,
      title: row.title,
      body: text,
      bodyHtml: html,
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
    .set({ body: text, bodyHtml: html, updatedAt: new Date() })
    .where(eq(financeReports.id, reportId));
  return reportId;
}

export async function shareReport(viewer: Viewer, reportId: string) {
  const [row] = await db
    .select()
    .from(financeReports)
    .where(and(eq(financeReports.id, reportId), eq(financeReports.tenantId, viewer.tenantId)))
    .limit(1);
  if (!row) throw new Error("这份报告不存在");
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
