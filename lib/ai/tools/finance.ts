import "server-only";
import type { ToolDef } from "@/lib/ai/openrouter";
import { agentKeyFromEmail } from "@/lib/agents/catalog";
import { budgetVsActual, listCentres, listSpend, raiseSpend, thresholds } from "@/lib/finance/service";
import { generateReport, listReports } from "@/lib/finance/reports";
import { withheldFrom } from "./audience";
import { num, str, type ToolContext, type ToolPack, type ToolResult } from "./types";

/**
 * Finance, by conversation.
 *
 * "这个月制作部花超了吗" and "帮我提一个买两支麦克风的用款申请，2400" are the
 * two things people ask the Finance screen, and this is the same service in a
 * sentence. Every figure comes from the ledger through the service, never from
 * the model: the tool hands over the numbers and the prompt forbids any other.
 *
 * Asking is as far as it goes. `raise_spend_request` raises a request, which
 * the studio's thresholds route to its approvers; there is no tool here that
 * approves, rejects or marks one paid, and a request 财务 raises needs at least
 * one person's approval even below the auto-approve line — the line is the
 * studio trusting a person's own small purchase, not a model's.
 *
 * Gated on the Finance module, like every action on the Finance screen
 * (`finance()` in app/(app)/finance/actions.ts), and on who will read the
 * answer (`withheldFrom`).
 */
const defs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "budget_vs_actual",
      description:
        "Budget against actual spending for one period, by cost centre (department or project), with what is left or over, spending filed under no centre, and the AI model spend for the month. Amounts are in the studio's currency, in whole units.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", description: "YYYY-MM. Optional; defaults to this month." },
          centre: { type: "string", description: "One cost centre, by name or id. Optional; all of them by default." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_spend_requests",
      description:
        "Spend requests, the ones waiting for a decision first, then approved and waiting to be paid, then the rest newest first: title, id, amount, cost centre, state, approvals given against approvals needed, who asked and by when it is needed.",
      parameters: {
        type: "object",
        properties: {
          state: { type: "string", description: "awaiting_approval, approved, rejected or paid. Optional." },
          limit: { type: "number", description: "Default 15." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "raise_spend_request",
      description:
        "Raise a spend request for approval. This only asks: the studio's thresholds decide how many people must approve it, a request raised by an AI employee always needs at least one, and nothing is paid. Give a title, the amount in whole units, what it is for, and optionally the cost centre (name or id) and the date it is needed by.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "What is being bought, in a few words." },
          amount: { type: "number", description: "In whole units, e.g. 2400." },
          description: { type: "string", description: "What it is for and why now." },
          centre: { type: "string", description: "Cost centre, by name or id. Optional." },
          needed_by: { type: "string", description: "YYYY-MM-DD. Optional." },
        },
        required: ["title", "amount", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finance_report",
      description:
        "The monthly management report for a period. Reads the latest one written for that period; with write set, writes a new draft from the period's own figures (one model call, about half a minute). A draft is for a person to edit and share; nothing is circulated.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", description: "YYYY-MM (or YYYY-Q1…Q4). Optional; defaults to this month." },
          write: { type: "boolean", description: "Write a new draft instead of reading the latest. Default false." },
        },
        required: [],
      },
    },
  },
];

/** Stored in millionths (`lib/finance/service.ts`), said in whole units with
 * the `$` the monthly report uses. */
const money = (micros: number) =>
  `$${(micros / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const thisMonth = () => new Date().toISOString().slice(0, 7);

/** The same period rules as the Finance actions: a month for the ledger, a
 * month or a quarter for a report. */
const monthOf = (v: unknown) => {
  const s = str(v, 10);
  return /^\d{4}-\d{2}$/.test(s) ? s : null;
};
const reportPeriodOf = (v: unknown) => {
  const s = str(v, 10);
  return /^\d{4}-(?:\d{2}|Q[1-4])$/.test(s) ? s : null;
};

/** What a state is called where a person reads it. */
const STATE: Record<string, string> = {
  awaiting_approval: "waiting for approval",
  approved: "approved, not yet paid",
  rejected: "rejected",
  paid: "paid",
};
const ORDER: Record<string, number> = { awaiting_approval: 0, approved: 1 };

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const withheld = await withheldFrom(ctx, "finance");
  if (withheld) return { text: withheld };

  if (name === "budget_vs_actual") {
    const period = args.period === undefined || args.period === "" ? thisMonth() : monthOf(args.period);
    if (!period) return { text: "A period is a month, written YYYY-MM." };
    const b = await budgetVsActual(ctx.viewer, period);

    const wanted = str(args.centre, 120).toLowerCase();
    const cells = wanted
      ? b.cells.filter((c) => c.centreId.toLowerCase() === wanted || c.centreName.toLowerCase().includes(wanted))
      : b.cells;
    if (wanted && !cells.length) {
      return { text: `No cost centre matches "${str(args.centre, 120)}". The centres are: ${b.cells.map((c) => c.centreName).join(", ") || "none yet"}.` };
    }
    if (!cells.length) return { text: `No cost centres are set up, so there is nothing budgeted for ${period}. They are added on the Finance screen.` };

    const lines = cells.map((c) => {
      const left = c.budgetMicros - c.actualMicros;
      return (
        `- ${c.centreName} (${c.kind}, id: ${c.centreId}): budget ${money(c.budgetMicros)}, spent ${money(c.actualMicros)}` +
        (c.budgetMicros > 0
          ? ` (${Math.round((c.actualMicros / c.budgetMicros) * 100)}% of plan) · ${left >= 0 ? `${money(left)} left` : `${money(-left)} over`}`
          : " · no budget set")
      );
    });
    const budget = cells.reduce((s, c) => s + c.budgetMicros, 0);
    const spent = cells.reduce((s, c) => s + c.actualMicros, 0);
    return {
      text: [
        `Budget against actual, ${period}:`,
        ...lines,
        "",
        `Total${wanted ? " for these" : ""}: budget ${money(budget)}, spent ${money(spent)}.`,
        ...(wanted ? [] : [`Spent under no cost centre: ${money(b.unfiledMicros)}. AI model spend this month: ${money(b.modelSpendMicros)}.`]),
      ].join("\n"),
    };
  }

  if (name === "list_spend_requests") {
    const state = str(args.state, 30);
    const rows = (await listSpend(ctx.viewer))
      .filter((r) => !state || r.state === state)
      .sort((a, b) => (ORDER[a.state] ?? 2) - (ORDER[b.state] ?? 2) || b.createdAt.getTime() - a.createdAt.getTime());
    if (!rows.length) return { text: state ? `No spend request is ${STATE[state] ?? state}.` : "There are no spend requests." };
    return {
      text: rows
        .slice(0, Math.min(50, Math.max(1, num(args.limit, 15))))
        .map((r) => {
          const approvals = r.decisions.filter((d) => d.decision === "approve").length;
          return (
            `- ${r.title} (id: ${r.id}) — ${money(r.amountMicros)} · ${STATE[r.state] ?? r.state}` +
            (r.state === "awaiting_approval" ? ` · ${approvals} of ${r.approvalsNeeded} approval(s)` : "") +
            (r.centreName ? ` · ${r.centreName}` : "") +
            ` · asked by ${r.requestedByName ?? "somebody"}` +
            (r.neededBy ? ` · needed by ${r.neededBy.toISOString().slice(0, 10)}` : "")
          );
        })
        .join("\n"),
    };
  }

  if (name === "raise_spend_request") {
    const title = str(args.title, 200);
    if (!title) return { text: "A request needs a title: what is being bought." };
    /* The same bounds `raiseSpendAction` puts on the screen's form. */
    const amount = num(args.amount, NaN);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) return { text: "An amount is a positive number, in whole units." };

    let neededBy: Date | null = null;
    const due = str(args.needed_by, 20);
    if (due) {
      const parsed = new Date(due);
      if (Number.isNaN(parsed.getTime())) return { text: "The needed-by date is not a date. Write it YYYY-MM-DD." };
      neededBy = parsed;
    }

    let centreId: string | null = null;
    const wanted = str(args.centre, 120).toLowerCase();
    if (wanted) {
      const centres = await listCentres(ctx.viewer);
      const centre = centres.find((c) => c.id.toLowerCase() === wanted) ?? centres.find((c) => c.name.toLowerCase().includes(wanted));
      if (!centre) return { text: `No cost centre matches "${str(args.centre, 120)}". The centres are: ${centres.map((c) => c.name).join(", ") || "none yet"}.` };
      centreId = centre.id;
    }

    /* Raised by an employee, the request is in the employee's name, so the
       approvers are told whom it is really for. */
    const employee = Boolean(agentKeyFromEmail(ctx.viewer.email));
    const forWhom = employee && ctx.asker ? `应 ${ctx.asker.nameLocal || ctx.asker.name} 的要求提交。\n` : "";
    const requestId = await raiseSpend(ctx.viewer, {
      title,
      description: `${forWhom}${str(args.description, 3800)}`,
      amountMicros: Math.round(amount * 1_000_000),
      centreId,
      neededBy,
      minApprovals: employee ? 1 : 0,
    });

    const [row] = (await listSpend(ctx.viewer)).filter((r) => r.id === requestId);
    const t = await thresholds(ctx.viewer);
    const needed = row?.approvalsNeeded ?? 1;
    return {
      artifacts: [{ kind: "spend_request", id: requestId, title, action: "created" }],
      text: [
        `Raised: "${title}" for ${money(Math.round(amount * 1_000_000))} (id: ${requestId}).`,
        row?.state === "approved"
          ? `It is under the studio's ${t.autoBelow} threshold, so the studio's rule approved it as it was raised. It is not paid; paying it is a person's job on the Finance screen.`
          : `It needs ${needed} approval(s) from people other than whoever raised it, and nobody has approved it yet. Nothing is paid.`,
      ].join("\n"),
      changed: true,
    };
  }

  if (name === "finance_report") {
    const period = args.period === undefined || args.period === "" ? thisMonth() : reportPeriodOf(args.period);
    if (!period) return { text: "A period is YYYY-MM, or a quarter written YYYY-Q1 to YYYY-Q4." };

    if (args.write === true) {
      /* One tool that reads and writes, so the write is refused here rather
         than the tool being withheld from a turn that only looks things up. */
      if (ctx.readOnly) return { text: "Writing a report changes things, and this turn only looks things up. Read the latest one instead, or say who should write it." };
      const report = await generateReport(ctx.viewer, period);
      return {
        artifacts: [{ kind: "finance_report", id: report.id, title: report.title, action: "created" }],
        text: `Written as a draft: "${report.title}" (id: ${report.id}). Somebody edits and shares it on the Finance screen.\n\n${report.body.slice(0, 6000)}`,
        changed: true,
      };
    }

    const report = (await listReports(ctx.viewer)).find((r) => r.period === period);
    if (!report) return { text: `No management report has been written for ${period}. finance_report with write set writes a draft from the period's figures.` };
    return {
      text: `# ${report.title} (${report.state}${report.sharedAt ? `, shared ${report.sharedAt.toISOString().slice(0, 10)}` : ""}, id: ${report.id})\n\n${report.body.slice(0, 8000)}`,
    };
  }

  return { text: `Unknown tool ${name}.` };
}

export const financePack: ToolPack = { module: "finance", defs, run };
