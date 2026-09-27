import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import type { ToolDef } from "@/lib/ai/openrouter";
import {
  draftContract,
  listChecklists,
  listContracts,
  listFindings,
  listRuns,
  listTemplates,
  reviewContract,
} from "@/lib/legal/service";
import { withheldFrom } from "./audience";
import { id, num, str, type ToolContext, type ToolPack, type ToolResult } from "./types";

/**
 * Legal, by conversation.
 *
 * "给摄影师小林起草一份自由职业合同，费用 8000，下周一开工" is the whole
 * drafting screen in a sentence: pick the template, fill its fields, name the
 * counterparty. The contract lands in the Legal module's library, where its
 * state, its review and its signing dates already live.
 *
 * The module's one rule holds here too: a departure is marked and explained,
 * a verdict is never rendered. The review is the service's mechanical
 * clause-by-clause comparison, returned as it is,.
 *
 * Gated on the Legal module, like every action on the Legal screen
 * (`lawyer()` in app/(app)/legal/actions.ts), and on who will read the answer
 * (`withheldFrom`).
 */
const defs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_contracts",
      description:
        "The studio's contracts, most recently changed first: title, id, state (draft, in_review, sent, signed, expired, terminated), counterparty, the template it came from, signing and expiry dates, and how many review findings are still unread.",
      parameters: {
        type: "object",
        properties: {
          state: { type: "string", description: "Only contracts in this state. Optional." },
          query: { type: "string", description: "Words from the title or the counterparty. Optional." },
          limit: { type: "number", description: "Default 20." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_contract",
      description:
        "One contract in full, with the findings of its last review against its template. Use an id from list_contracts.",
      parameters: { type: "object", properties: { id: { type: "string", description: "The contract id, con_…" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_templates",
      description:
        "The contract templates the studio drafts from, with each one's id, kind and the fields it asks for (key and label). Read this before draft_contract: the values you pass are keyed by these field keys.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_contract",
      description:
        "Draft a contract from a template into the Legal library, as a draft. Give the template id (from list_templates), a title, the counterparty and the values for the template's fields, keyed by field key. A field left out stays visible as its placeholder in the draft. Nothing is sent or signed.",
      parameters: {
        type: "object",
        properties: {
          template_id: { type: "string", description: "tpl_… from list_templates." },
          title: { type: "string", description: "Optional; defaults to the template's name." },
          counterparty: { type: "string", description: "Who the contract is with. Optional." },
          values: {
            type: "object",
            description: "The template's fields, e.g. { \"contractor\": \"林一\", \"fee\": \"HK$8,000\" }.",
            additionalProperties: { type: "string" },
          },
        },
        required: ["template_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "review_contract",
      description:
        "Compare a contract with the template it came from, clause by clause, and return where it departs: a clause missing, added, changed or only reworded, with both texts. Replaces the contract's previous findings and moves it to in_review. It states differences, never whether a difference is acceptable.",
      parameters: { type: "object", properties: { id: { type: "string", description: "The contract id, con_…" } }, required: ["id"] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_checklists",
      description:
        "The compliance checklists (e.g. before a video goes out), their items, and the most recent runs of them with what was answered.",
      parameters: { type: "object", properties: { limit: { type: "number", description: "How many recent runs. Default 10." } }, required: [] },
    },
  },
];

const day = (d: Date | string | null) => (d ? (typeof d === "string" ? d : d.toISOString().slice(0, 10)) : null);

/** The notice as the last lines of a result: both languages, because the
 * model answers in the asker's and must not have to translate it. */

const DEPARTURE: Record<string, string> = {
  missing: "missing from the contract",
  added: "added in the contract",
  changed: "worded differently",
  reworded: "same words, punctuated or spaced differently",
};

function findingLines(findings: Awaited<ReturnType<typeof listFindings>>): string[] {
  return findings.map((f) => {
    const clip = (s: string | null) => (s ? s.replace(/\s+/g, " ").slice(0, 400) : "(none)");
    return [
      `- Clause ${f.clause}: ${DEPARTURE[f.departure] ?? f.departure}${f.acknowledgedAt ? ` · read by ${f.acknowledgedByName ?? "somebody"}` : ""}`,
      `  Template: ${clip(f.templateText)}`,
      `  Contract: ${clip(f.contractText)}`,
    ].join("\n");
  });
}

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const withheld = await withheldFrom(ctx, "legal");
  if (withheld) return { text: withheld };

  if (name === "list_contracts") {
    const state = str(args.state, 20);
    const query = str(args.query, 100).toLowerCase();
    const rows = (await listContracts(ctx.viewer)).filter(
      (c) =>
        (!state || c.state === state) &&
        (!query || c.title.toLowerCase().includes(query) || (c.counterparty ?? "").toLowerCase().includes(query)),
    );
    if (!rows.length) return { text: state || query ? "No contract matches." : "The contract library is empty." };
    return {
      text: rows
        .slice(0, Math.min(50, Math.max(1, num(args.limit, 20))))
        .map(
          (c) =>
            `- ${c.title} (id: ${c.id}) — ${c.state.replace("_", " ")}` +
            (c.counterparty ? ` · with ${c.counterparty}` : "") +
            (c.templateName ? ` · from "${c.templateName}"` : " · no template") +
            (c.signedOn ? ` · signed ${c.signedOn}` : "") +
            (c.expiresOn ? ` · expires ${c.expiresOn}` : "") +
            (c.findingCount ? ` · ${c.findingCount} finding(s), ${c.unacknowledged} unread` : "") +
            ` · updated ${day(c.updatedAt)}`,
        )
        .join("\n"),
    };
  }

  if (name === "read_contract") {
    const contractId = id(args.id);
    const contract = contractId ? (await listContracts(ctx.viewer)).find((c) => c.id === contractId) : undefined;
    if (!contract) return { text: "No such contract. Use an id from list_contracts." };
    const findings = await listFindings(ctx.viewer, contract.id);
    const body = contract.body.length > 12_000 ? `${contract.body.slice(0, 12_000)}\n\n[truncated]` : contract.body;
    return {
      text:
        [
          `# ${contract.title} (${contract.state.replace("_", " ")})`,
          ...(contract.counterparty ? [`With: ${contract.counterparty}`] : []),
          contract.templateName ? `Template: ${contract.templateName}` : "Not drafted from a template.",
          "",
          body,
          "",
          findings.length
            ? `Last review against the template:\n${findingLines(findings).join("\n")}`
            : "Not reviewed, or no departures from the template at the last review.",
        ].join("\n"),
    };
  }

  if (name === "list_templates") {
    const rows = (await listTemplates(ctx.viewer)).filter((t) => t.active);
    /* Seeding is on request from the Legal screen and never silent, so an
       empty list is said, not filled. */
    if (!rows.length) return { text: "There are no contract templates yet. Somebody with Legal access adds them (or the two starters) on the Legal screen." };
    return {
      text: rows
        .map(
          (t) =>
            `- ${t.name} (id: ${t.id}, ${t.kind})\n  Fields: ${t.fields.length ? t.fields.map((f) => `${f.key} (${f.label}${f.hint ? `; ${f.hint}` : ""})`).join(", ") : "none"}`,
        )
        .join("\n"),
    };
  }

  if (name === "draft_contract") {
    const templateId = id(args.template_id);
    if (!templateId) return { text: "Choose a template: pass an id from list_templates." };

    /* The same shaping `draftContractAction` gives the screen's form. */
    const values: Record<string, string> = {};
    if (args.values && typeof args.values === "object" && !Array.isArray(args.values)) {
      for (const [k, v] of Object.entries(args.values as Record<string, unknown>)) {
        if (typeof v === "string" || typeof v === "number") values[k.slice(0, 40)] = String(v).slice(0, 2000);
      }
    }
    const [studio] = await db.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, ctx.viewer.tenantId)).limit(1);
    const contractId = await draftContract(ctx.viewer, {
      templateId,
      title: str(args.title, 300),
      counterparty: str(args.counterparty, 200) || null,
      values,
      studio: studio?.name ?? "the Studio",
    });

    const contract = (await listContracts(ctx.viewer)).find((c) => c.id === contractId);
    const title = contract?.title ?? (str(args.title, 300) || "Contract");
    const unfilled = [...new Set([...(contract?.body ?? "").matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]))];
    return {
      artifacts: [{ kind: "contract", id: contractId, title, action: "created" }],
      text:
        [
          `Drafted: "${title}" (id: ${contractId}) in the Legal library, as a draft.`,
          unfilled.length ? `Still blank, shown as placeholders: ${unfilled.join(", ")}.` : "Every field was filled.",
          "Nothing has been sent or signed. Open it at /legal to edit, review or send.",
        ].join("\n"),
      changed: true,
    };
  }

  if (name === "review_contract") {
    const contractId = id(args.id);
    if (!contractId) return { text: "No such contract. Use an id from list_contracts." };
    const found = await reviewContract(ctx.viewer, contractId);
    const [contract, findings] = await Promise.all([
      listContracts(ctx.viewer).then((rows) => rows.find((c) => c.id === contractId)),
      listFindings(ctx.viewer, contractId),
    ]);
    const title = contract?.title ?? contractId;
    return {
      artifacts: [{ kind: "contract", id: contractId, title, action: "updated" }],
      text:
        (found
          ? `Compared "${title}" (id: ${contractId}) with its template: ${found} departure(s).\n${findingLines(findings).join("\n")}`
          : `Compared "${title}" (id: ${contractId}) with its template: no departures, clause for clause.`) +
        "\nThe contract is now in review. These are differences, not a judgement of them.",
      changed: true,
    };
  }

  if (name === "list_checklists") {
    const [lists, runs] = await Promise.all([listChecklists(ctx.viewer), listRuns(ctx.viewer, Math.min(40, Math.max(1, num(args.limit, 10))))]);
    if (!lists.length) return { text: "There are no compliance checklists yet. Somebody with Legal access adds the starter on the Legal screen." };
    const lines = lists.map(
      (l) =>
        `- ${l.name} (id: ${l.id}) — run ${l.runCount} time(s)${l.lastRunAt ? `, last ${day(new Date(l.lastRunAt))}` : ""}\n` +
        l.items.map((i) => `  · ${i.text}`).join("\n"),
    );
    const recent = runs.map((r) => {
      const answers = Object.values(r.answers);
      const no = Object.entries(r.answers).filter(([, a]) => a.value === "no").map(([k]) => k);
      return (
        `- ${r.checklistName}${r.subject ? ` for "${r.subject}"` : ""} — ${r.completedAt ? `completed ${day(r.completedAt)}` : "not finished"}` +
        ` · ${answers.filter((a) => a.value === "yes").length} yes, ${no.length} no, ${answers.filter((a) => a.value === "na").length} n/a` +
        (no.length ? ` (no: ${no.join(", ")})` : "") +
        (r.ranByName ? ` · by ${r.ranByName}` : "")
      );
    });
    return { text: `${lines.join("\n")}${recent.length ? `\n\nRecent runs:\n${recent.join("\n")}` : "\n\nNo runs yet."}` };
  }

  return { text: `Unknown tool ${name}.` };
}

export const legalPack: ToolPack = { module: "legal", defs, run };
