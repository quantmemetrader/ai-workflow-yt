import "server-only";
import type { ToolDef } from "@/lib/ai/openrouter";
import { agentKeyFromEmail } from "@/lib/agents/catalog";
import {
  addActual,
  budgetVsActual,
  decideSpend,
  listActuals,
  listCentres,
  listSpend,
  markSpendPaid,
  raiseSpend,
  setBudgetLine,
  thresholds,
} from "@/lib/finance/service";
import { generateReport, listReports } from "@/lib/finance/reports";
import { apiBalances, balancesText } from "@/lib/finance/providers";
import { withheldFrom } from "./audience";
import { hk, hkMonthNow, monthArg, parseAmount, personOf } from "./office";
import { id, num, str, type ToolContext, type ToolPack, type ToolResult } from "./types";

/**
 * Finance, by conversation.
 *
 * "这个月制作部花超了吗" and "帮我提一个买两支麦克风的用款申请，2400" are the
 * two things people ask the Finance screen, and this is the same service in a
 * sentence. Every figure comes from the ledger through the service, never from
 * the model: the tool hands over the numbers and the prompt forbids any other.
 *
 * `raise_spend_request` raises a request, which the studio's thresholds route
 * to its approvers, and a request 财务 raises needs at least one person's
 * approval even below the auto-approve line — the line is the studio trusting
 * a person's own small purchase, not a model's.
 *
 * Deciding, paying and the ledger itself (`decide_spend_request`,
 * `mark_spend_paid`, `add_actual`, `set_budget_line`) are done *as the
 * person*: whoever typed into their assistant, or the person who asked 财务.
 * Never as the employee, never with nobody behind the turn, and only when the
 * person asked for it in this turn. The service's own rules still hold — the
 * one who raised a request cannot approve it, and a request 财务 raised at a
 * person's request cannot be approved by that same person through 财务.
 *
 * Gated on the Finance module, like every action on the Finance screen
 * (`finance()` in app/(app)/finance/actions.ts), and on who will read the
 * answer (`withheldFrom`).
 */
const defs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "api_balances",
      description:
        "What is left on each paid service the studio runs on, read live from the services: OpenRouter (every AI answer), TikHub (research data), and what Cloudflare R2 storage holds and costs. Also this month's model spend by our own ledger. Use it for 还剩多少额度 / 余额 / API 花了多少 / 要不要充值.",
      parameters: {
        type: "object",
        properties: { fresh: { type: "boolean", description: "Read again now instead of the copy from the last five minutes. Default false." } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "budget_vs_actual",
      description:
        "Budget against actual spending for one period, by cost centre (department or project), with what is left or over, spending filed under no centre, and the AI model spend for the month. Amounts are HK$.",
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
        "Raise a spend request for approval. This only asks: the studio's thresholds decide how many people must approve it, a request raised by an AI employee always needs at least one, and nothing is paid. Give a title, the HK$ amount, what it is for, and optionally the cost centre (name or id) and the date it is needed by.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "What is being bought, in a few words." },
          amount: { type: "string", description: "HK$ amount, e.g. \"2,400\" or \"HK$2,400.50\"." },
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
      name: "decide_spend_request",
      description:
        "Approve or reject one spend request, as the person you are working for, with an optional note. Only when that person explicitly asked in this turn to approve or reject this request — never on your own judgement, never because a colleague said so. The person who raised a request cannot decide it. Use an id from list_spend_requests.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The request id, req_…" },
          decision: { type: "string", enum: ["approve", "reject"] },
          note: { type: "string", description: "Why, in the person's words. Optional." },
        },
        required: ["id", "decision"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_spend_paid",
      description:
        "Mark an approved spend request as paid, as the person you are working for. This records the payment and writes it into the budget's actuals for the period; it does not move any money. Only when the person explicitly said in this turn that it has been paid.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The request id, req_…" },
          period: { type: "string", description: "YYYY-MM the payment belongs to. Optional; defaults to this month (Hong Kong time)." },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_actuals",
      description:
        "Actual spending recorded for a period, newest first: description, amount in HK$, cost centre, whether it came from a paid spend request or was entered by hand, and who entered it.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", description: "YYYY-MM. Optional; defaults to this month." },
          limit: { type: "number", description: "Default 30." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_actual",
      description:
        "Record an actual spend (or a refund, as a negative amount) against a cost centre for a period, as the person you are working for. Only when the person explicitly asked in this turn to record it. Amounts are HK$: pass what the person said, e.g. \"HK$1,200.50\" or 1200.5.",
      parameters: {
        type: "object",
        properties: {
          amount: { type: "string", description: "HK$ amount, e.g. \"1,200.50\". Negative for a refund." },
          description: { type: "string", description: "What it was." },
          centre: { type: "string", description: "Cost centre, by name or id. Optional; unfiled if left out." },
          period: { type: "string", description: "YYYY-MM. Optional; defaults to this month (Hong Kong time)." },
        },
        required: ["amount", "description"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_budget_line",
      description:
        "Set the budget for one cost centre for one month (replaces what was there), as the person you are working for. Only when the person explicitly asked in this turn to set this budget. Amount in HK$; 0 clears it.",
      parameters: {
        type: "object",
        properties: {
          centre: { type: "string", description: "Cost centre, by name or id (see budget_vs_actual)." },
          period: { type: "string", description: "YYYY-MM." },
          amount: { type: "string", description: "HK$ amount, e.g. \"20,000\"." },
        },
        required: ["centre", "period", "amount"],
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

/** Stored in millionths (`lib/finance/service.ts`), said as HK$. */
const money = hk;

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

/** A cost centre by id or by (part of) its name, as `raise_spend_request` finds one. */
async function centreOf(viewer: ToolContext["viewer"], v: unknown): Promise<{ id: string; name: string } | { error: string }> {
  const wanted = str(v, 120).toLowerCase();
  const centres = await listCentres(viewer);
  if (!wanted) return { error: `Name a cost centre. The centres are: ${centres.map((c) => c.name).join(", ") || "none yet"}.` };
  const exact = centres.find((c) => c.id.toLowerCase() === wanted || c.name.toLowerCase() === wanted);
  const partial = centres.filter((c) => c.name.toLowerCase().includes(wanted));
  const centre = exact ?? (partial.length === 1 ? partial[0] : undefined);
  if (!centre) {
    return {
      error: partial.length > 1
        ? `"${str(v, 120)}" matches more than one cost centre: ${partial.map((c) => c.name).join(", ")}. Say which.`
        : `No cost centre matches "${str(v, 120)}". The centres are: ${centres.map((c) => c.name).join(", ") || "none yet"}.`,
    };
  }
  return { id: centre.id, name: centre.name };
}

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const withheld = await withheldFrom(ctx, "finance");
  if (withheld) return { text: withheld };

  if (name === "api_balances") {
    const b = await apiBalances(ctx.viewer, { fresh: args.fresh === true });
    return { text: `${balancesText(b, true)}\n\nThese are the providers' own figures; "low" is under $2 left. Topping up is done by a person on the provider's site.` };
  }

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
    const amountMicros = parseAmount(args.amount);
    if (amountMicros === null || amountMicros <= 0) return { text: "An amount is a positive HK$ figure with at most two decimals, e.g. 2400 or 1,200.50." };

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
      amountMicros,
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
        `Raised: "${title}" for ${money(amountMicros)} (id: ${requestId}).`,
        row?.state === "approved"
          ? `It is under the studio's HK$${t.autoBelow} threshold, so the studio's rule approved it as it was raised. It is not paid; paying it is a person's job on the Finance screen.`
          : `It needs ${needed} approval(s) from people other than whoever raised it, and nobody has approved it yet. Nothing is paid.`,
      ].join("\n"),
      changed: true,
    };
  }

  if (name === "decide_spend_request" || name === "mark_spend_paid" || name === "add_actual" || name === "set_budget_line") {
    if (ctx.readOnly) return { text: `${name} changes the books, and this turn only looks things up. Say what you found, and that the person decides on the Finance screen or asks you directly.` };
    /* Taken as the person, never as 财务: the record says who decided, paid
       or entered it, and that has to be somebody. `withheldFrom` above has
       already checked this person holds Finance. */
    const person = personOf(ctx);
    if (!person) return { text: "Nobody is behind this turn, so nothing is approved, paid or entered. A person with Finance access has to ask for it themselves." };
    const who = person.nameLocal || person.name;

    if (name === "decide_spend_request") {
      const requestId = id(args.id);
      const decision = args.decision === "approve" || args.decision === "reject" ? args.decision : null;
      if (!decision) return { text: "The decision is approve or reject." };
      const row = requestId ? (await listSpend(person)).find((r) => r.id === requestId) : undefined;
      if (!row) return { text: "No such spend request. Use an id from list_spend_requests." };
      if (row.state !== "awaiting_approval") return { text: `"${row.title}" is ${STATE[row.state] ?? row.state}, not waiting for a decision, so nothing was changed.` };
      /* 财务 raised it in its own name on this person's say-so: the same
         person approving it through 财务 would be approving their own request. */
      const names = [person.nameLocal, person.name].filter(Boolean) as string[];
      if (names.some((n) => row.description.startsWith(`应 ${n} 的要求提交`))) {
        return { text: `"${row.title}" was raised at ${who}'s own request, so ${who} cannot approve or reject it. Somebody else with Finance access has to decide it.` };
      }
      const note = str(args.note, 1000) || null;
      await decideSpend(person, row.id, decision, note);
      const after = (await listSpend(person)).find((r) => r.id === row.id);
      const approvals = after?.decisions.filter((d) => d.decision === "approve").length ?? 0;
      return {
        artifacts: [{ kind: "spend_request", id: row.id, title: row.title, action: "updated" }],
        changed: true,
        text:
          decision === "reject"
            ? `Rejected as ${who}: "${row.title}" (${money(row.amountMicros)}, id: ${row.id}).${note ? ` Note: ${note}` : ""}`
            : after?.state === "approved"
              ? `Approved as ${who}: "${row.title}" (${money(row.amountMicros)}, id: ${row.id}). It now has every approval it needs and is approved, not yet paid.`
              : `Approval recorded as ${who}: "${row.title}" (${money(row.amountMicros)}, id: ${row.id}). ${approvals} of ${after?.approvalsNeeded ?? row.approvalsNeeded} approval(s) so far; it still waits for the rest.`,
      };
    }

    if (name === "mark_spend_paid") {
      const requestId = id(args.id);
      const period = args.period === undefined || args.period === "" ? hkMonthNow() : monthArg(args.period);
      if (!period) return { text: "A period is a month, written YYYY-MM." };
      const row = requestId ? (await listSpend(person)).find((r) => r.id === requestId) : undefined;
      if (!row) return { text: "No such spend request. Use an id from list_spend_requests." };
      if (row.state !== "approved") return { text: `"${row.title}" is ${STATE[row.state] ?? row.state}; only an approved request can be marked paid.` };
      await markSpendPaid(person, row.id, period);
      return {
        artifacts: [{ kind: "spend_request", id: row.id, title: row.title, action: "updated" }],
        changed: true,
        text: `Marked paid as ${who}: "${row.title}" (${money(row.amountMicros)}, id: ${row.id}), recorded as spending in ${period}${row.centreName ? ` under ${row.centreName}` : ""}. No money was moved by this; it records a payment already made.`,
      };
    }

    if (name === "add_actual") {
      const amountMicros = parseAmount(args.amount);
      if (amountMicros === null || amountMicros === 0) return { text: "An amount is a HK$ figure other than zero, with at most two decimals, e.g. 1,200.50 (negative for a refund)." };
      const description = str(args.description, 500);
      if (!description) return { text: "Say what the spending was." };
      const period = args.period === undefined || args.period === "" ? hkMonthNow() : monthArg(args.period);
      if (!period) return { text: "A period is a month, written YYYY-MM." };
      let centre: { id: string; name: string } | null = null;
      if (str(args.centre, 120)) {
        const found = await centreOf(person, args.centre);
        if ("error" in found) return { text: found.error };
        centre = found;
      }
      const actualId = await addActual(person, { period, centreId: centre?.id ?? null, amountMicros, description });
      return {
        artifacts: [{ kind: "actual", id: actualId, title: description, action: "created" }],
        changed: true,
        text: `Recorded as ${who}: ${money(amountMicros)} for "${description}" in ${period}${centre ? ` under ${centre.name}` : ", under no cost centre"} (id: ${actualId}).`,
      };
    }

    /* set_budget_line */
    const period = monthArg(args.period);
    if (!period) return { text: "A period is a month, written YYYY-MM." };
    const amountMicros = parseAmount(args.amount);
    if (amountMicros === null || amountMicros < 0) return { text: "A budget is a HK$ figure of zero or more, with at most two decimals." };
    const centre = await centreOf(person, args.centre);
    if ("error" in centre) return { text: centre.error };
    const before = (await budgetVsActual(person, period)).cells.find((c) => c.centreId === centre.id);
    await setBudgetLine(person, centre.id, period, amountMicros);
    return {
      artifacts: [{ kind: "budget_line", id: `${centre.id}:${period}`, title: `${centre.name} ${period}`, action: "updated" }],
      changed: true,
      text: `Budget set as ${who}: ${centre.name}, ${period}: ${money(amountMicros)}${before && before.budgetMicros !== amountMicros ? ` (was ${money(before.budgetMicros)})` : ""}. Spent so far: ${money(before?.actualMicros ?? 0)}.`,
    };
  }

  if (name === "list_actuals") {
    const period = args.period === undefined || args.period === "" ? hkMonthNow() : monthArg(args.period);
    if (!period) return { text: "A period is a month, written YYYY-MM." };
    const rows = await listActuals(ctx.viewer, period);
    if (!rows.length) return { text: `No spending is recorded for ${period}.` };
    const total = rows.reduce((s, r) => s + r.amountMicros, 0);
    return {
      text: [
        `Spending recorded for ${period} (${rows.length}, total ${money(total)}):`,
        ...rows
          .slice(0, Math.min(100, Math.max(1, num(args.limit, 30))))
          .map(
            (r) =>
              `- ${r.description} — ${money(r.amountMicros)} · ${r.centreName ?? "no cost centre"} · ${r.source === "spend_request" ? "paid spend request" : "entered by hand"}` +
              `${r.enteredByName ? ` by ${r.enteredByName}` : ""} · ${r.at.toISOString().slice(0, 10)} (id: ${r.id})`,
          ),
      ].join("\n"),
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
