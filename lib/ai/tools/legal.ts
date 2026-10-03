import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema";
import type { ToolDef } from "@/lib/ai/openrouter";
import {
  acknowledgeFinding,
  draftContract,
  getContract,
  isContractState,
  isReadOnlyState,
  listChecklists,
  listContracts,
  listFindings,
  listRuns,
  listTemplates,
  reviewContract,
  saveRun,
  updateContract,
  type ContractState,
} from "@/lib/legal/service";
import { withheldFrom } from "./audience";
import { dayOf, personOf } from "./office";
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
 * Changing where a contract stands (sent, signed, expired, terminated, its
 * dates), marking a finding read and answering a checklist are recorded as
 * the person behind the turn, never as 法务, and only on their say-so.
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
  },  {
    type: "function",
    function: {
      name: "update_contract",
      description:
        "Change a contract: its title, its text (the whole new body, or one passage found and replaced), the counterparty, its state (draft, in_review, sent, signed, expired, terminated) or its signing and expiry dates. A signed, expired or terminated contract's title and text cannot change; its state and dates can. Moving a contract to sent, signed, expired or terminated, or setting its dates, is done as the person you are working for and only when they explicitly asked for it in this turn. Never mark a contract signed because a draft looks finished.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The contract id, con_…" },
          title: { type: "string", description: "New title. Optional." },
          body: { type: "string", description: "The complete new text, replacing all of it. Optional; use find/replace_with for a small change." },
          find: { type: "string", description: "A passage of the current text to replace, exactly as it appears (read_contract first). Optional." },
          replace_with: { type: "string", description: "What replaces the passage given in find." },
          counterparty: { type: "string", description: "Who the contract is with. An empty string clears it. Optional." },
          state: { type: "string", enum: ["draft", "in_review", "sent", "signed", "expired", "terminated"], description: "Optional." },
          signed_on: { type: "string", description: "YYYY-MM-DD, or an empty string to clear. Optional." },
          expires_on: { type: "string", description: "YYYY-MM-DD, or an empty string to clear. Optional." },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "acknowledge_finding",
      description:
        "Record that the person you are working for has read one review finding on a contract (or every unread one on it), so it stops counting as unread. This is a record that a person looked at the departure, not a judgement that it is acceptable. Only when the person explicitly said in this turn that they have read it and want it marked. Finding ids are in read_contract.",
      parameters: {
        type: "object",
        properties: {
          contract_id: { type: "string", description: "The contract id, con_…" },
          finding_id: { type: "string", description: "The finding id, rev_…. Leave out with all set to mark every unread finding on the contract." },
          all: { type: "boolean", description: "Mark every unread finding on the contract. Default false." },
        },
        required: ["contract_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_checklist_run",
      description:
        "Fill in a compliance checklist for something (e.g. one video before it goes out), as the person you are working for: each item answered yes, no or na with an optional note, keyed by the item's key from list_checklists. Pass run_id to add to a run already started; answers you leave out keep what they had. Set complete only when the person explicitly said in this turn that the check is done. The answers are the person's, not yours: never answer an item they did not answer.",
      parameters: {
        type: "object",
        properties: {
          checklist_id: { type: "string", description: "comp_… from list_checklists." },
          run_id: { type: "string", description: "An existing run to update, from list_checklists. Optional." },
          subject: { type: "string", description: "What was checked, e.g. the video's title." },
          answers: {
            type: "object",
            description: "Item key to answer, e.g. { \"music\": \"yes\", \"releases\": { \"value\": \"no\", \"note\": \"林一 not signed yet\" } }.",
            additionalProperties: {},
          },
          complete: { type: "boolean", description: "The check is finished. Default false." },
        },
        required: ["checklist_id", "answers"],
      },
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
      `- Clause ${f.clause}: ${DEPARTURE[f.departure] ?? f.departure}${f.acknowledgedAt ? ` · read by ${f.acknowledgedByName ?? "somebody"}` : " · unread"} (finding id: ${f.id})`,
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
        l.items.map((i) => `  · [${i.key}] ${i.text}`).join("\n"),
    );
    const recent = runs.map((r) => {
      const answers = Object.values(r.answers);
      const no = Object.entries(r.answers).filter(([, a]) => a.value === "no").map(([k]) => k);
      return (
        `- ${r.checklistName}${r.subject ? ` for "${r.subject}"` : ""} — ${r.completedAt ? `completed ${day(r.completedAt)}` : "not finished"}` +
        ` · ${answers.filter((a) => a.value === "yes").length} yes, ${no.length} no, ${answers.filter((a) => a.value === "na").length} n/a` +
        (no.length ? ` (no: ${no.join(", ")})` : "") +
        (r.ranByName ? ` · by ${r.ranByName}` : "") +
        ` (run id: ${r.id})`
      );
    });
    return { text: `${lines.join("\n")}${recent.length ? `\n\nRecent runs:\n${recent.join("\n")}` : "\n\nNo runs yet."}` };
  }

  if (name === "update_contract" || name === "acknowledge_finding" || name === "save_checklist_run") {
    if (ctx.readOnly) return { text: `${name} changes the Legal records, and this turn only looks things up. Say what you found, and who should make the change.` };
  }

  if (name === "update_contract") {
    const contractId = id(args.id);
    const current = contractId ? await getContract(ctx.viewer, contractId) : null;
    if (!current) return { text: "No such contract. Use an id from list_contracts." };
    const c = current.c;

    const input: {
      title?: string;
      body?: string;
      counterparty?: string | null;
      state?: ContractState;
      signedOn?: string | null;
      expiresOn?: string | null;
    } = {};

    if (typeof args.title === "string") {
      const title = str(args.title, 300);
      if (!title) return { text: "A contract's title cannot be empty." };
      input.title = title;
    }
    if (typeof args.body === "string" && args.body.trim()) {
      if (typeof args.find === "string" && args.find) return { text: "Give either the whole new body or a find/replace_with pair, not both." };
      input.body = args.body.slice(0, 200_000);
    } else if (typeof args.find === "string" && args.find) {
      const find = args.find;
      const count = c.body.split(find).length - 1;
      if (count === 0) return { text: "That passage is not in the contract's current text. Read it with read_contract and quote the passage exactly." };
      if (count > 1) return { text: `That passage appears ${count} times. Quote a longer passage so only one place matches.` };
      input.body = c.body.replace(find, () => (typeof args.replace_with === "string" ? args.replace_with : ""));
    }
    if (typeof args.counterparty === "string") input.counterparty = str(args.counterparty, 200) || null;
    if (args.state !== undefined && args.state !== "") {
      if (!isContractState(args.state)) return { text: "A state is one of draft, in_review, sent, signed, expired, terminated." };
      input.state = args.state;
    }
    for (const [key, field] of [["signed_on", "signedOn"], ["expires_on", "expiresOn"]] as const) {
      if (typeof args[key] !== "string") continue;
      const raw = str(args[key], 20);
      if (!raw) {
        input[field] = null;
        continue;
      }
      const d = dayOf(raw);
      if (!d) return { text: `${key} is not a date. Write it YYYY-MM-DD.` };
      input[field] = d;
    }
    if (!Object.keys(input).length) return { text: "Nothing to change was given." };

    /* The same rule the service holds, said before trying (it also holds it
       in the write, in case the contract is signed in between). */
    if ((input.title !== undefined || input.body !== undefined) && isReadOnlyState(c.state)) {
      return { text: `"${c.title}" is ${c.state}, so its title and text are a record and cannot change. Its state and dates still can.` };
    }

    /* Sending, signing, expiring or ending a contract, and its dates, are a
       person's decision and are recorded as theirs. Editing a draft's words
       is the work 法务 is here for, and runs as whoever is working on it. */
    const decides =
      (input.state !== undefined && input.state !== c.state && !["draft", "in_review"].includes(input.state)) ||
      input.signedOn !== undefined ||
      input.expiresOn !== undefined;
    const person = personOf(ctx);
    if (decides && !person) {
      return { text: "Moving a contract to sent, signed, expired or terminated, or setting its dates, is a person's decision, and nobody is behind this turn. Nothing was changed." };
    }
    const actor = decides && person ? person : ctx.viewer;
    await updateContract(actor, c.id, input);

    const after = await getContract(ctx.viewer, c.id);
    const changedFields = [
      input.title !== undefined && "title",
      input.body !== undefined && "text",
      input.counterparty !== undefined && "counterparty",
      input.state !== undefined && `state (${c.state} → ${input.state})`,
      input.signedOn !== undefined && `signed on (${input.signedOn ?? "cleared"})`,
      input.expiresOn !== undefined && `expires on (${input.expiresOn ?? "cleared"})`,
    ].filter(Boolean);
    const title = after?.c.title ?? c.title;
    return {
      artifacts: [{ kind: "contract", id: c.id, title, action: "updated" }],
      changed: true,
      text:
        `Updated "${title}" (id: ${c.id}): ${changedFields.join(", ")}` +
        (decides && person ? `, recorded as ${person.nameLocal || person.name}.` : ".") +
        (input.body !== undefined && c.templateId ? " The text changed, so an earlier review against the template may be out of date; review_contract compares it again." : ""),
    };
  }

  if (name === "acknowledge_finding") {
    const person = personOf(ctx);
    if (!person) return { text: "Marking a finding read records that a person read it, and nobody is behind this turn. Nothing was marked." };
    const contractId = id(args.contract_id);
    const contract = contractId ? (await listContracts(ctx.viewer)).find((c) => c.id === contractId) : undefined;
    if (!contract) return { text: "No such contract. Use an id from list_contracts." };
    const findings = await listFindings(ctx.viewer, contract.id);
    const findingId = id(args.finding_id);
    const targets = findingId
      ? findings.filter((f) => f.id === findingId)
      : args.all === true
        ? findings.filter((f) => !f.acknowledgedAt)
        : [];
    if (findingId && !targets.length) return { text: `No finding ${findingId} on "${contract.title}". The finding ids are in read_contract.` };
    if (!findingId && args.all !== true) return { text: "Give a finding_id, or set all to mark every unread finding on the contract." };
    if (!targets.length) return { text: `Every finding on "${contract.title}" is already marked read.` };
    for (const f of targets) await acknowledgeFinding(person, f.id);
    return {
      artifacts: [{ kind: "contract", id: contract.id, title: contract.title, action: "updated" }],
      changed: true,
      text:
        `Marked read by ${person.nameLocal || person.name} on "${contract.title}": ${targets.map((f) => `clause ${f.clause}`).join(", ")}.` +
        " This records that they read the departure; it is not a judgement that it is acceptable.",
    };
  }

  if (name === "save_checklist_run") {
    const person = personOf(ctx);
    if (!person) return { text: "A checklist is answered by a person, and nobody is behind this turn. Nothing was saved." };
    const checklistId = id(args.checklist_id);
    const list = checklistId ? (await listChecklists(ctx.viewer)).find((l) => l.id === checklistId) : undefined;
    if (!list) return { text: "No such checklist. Use an id from list_checklists." };
    const keys = new Set(list.items.map((i) => i.key));

    /* The same shaping `saveRunAction` gives the screen. */
    const answers: Record<string, { value: string; note?: string }> = {};
    const unknown: string[] = [];
    const raw = args.answers && typeof args.answers === "object" && !Array.isArray(args.answers) ? (args.answers as Record<string, unknown>) : {};
    for (const [k, v] of Object.entries(raw)) {
      const value = typeof v === "string" ? v : v && typeof v === "object" ? (v as { value?: unknown }).value : undefined;
      const note = v && typeof v === "object" ? (v as { note?: unknown }).note : undefined;
      const val = typeof value === "string" ? value.trim().toLowerCase().replace("n/a", "na") : "";
      if (!keys.has(k) || !["yes", "no", "na"].includes(val)) {
        unknown.push(k);
        continue;
      }
      answers[k] = { value: val, ...(typeof note === "string" && note.trim() ? { note: note.slice(0, 500) } : {}) };
    }
    if (unknown.length) {
      return { text: `Not saved: ${unknown.join(", ")} ${unknown.length === 1 ? "is" : "are"} not an item of "${list.name}" answered yes, no or na. Its item keys are: ${[...keys].join(", ")}.` };
    }

    let runId: string | null = null;
    let merged = answers;
    let subject = str(args.subject, 300);
    let wasComplete = false;
    if (args.run_id !== undefined && args.run_id !== "") {
      runId = id(args.run_id);
      const existing = runId ? (await listRuns(ctx.viewer, 200)).find((r) => r.id === runId && r.checklistName === list.name) : undefined;
      if (!existing) return { text: "No such run of this checklist. The run ids are in list_checklists." };
      merged = { ...existing.answers, ...answers };
      subject = subject || existing.subject || "";
      wasComplete = existing.completedAt !== null;
    }
    if (!Object.keys(merged).length) return { text: "No answers were given, so nothing was saved." };

    /* A finished run stays finished unless the person reopens it. */
    const complete = args.complete === true || (wasComplete && args.complete !== false);
    const missing = list.items.filter((i) => !merged[i.key]).map((i) => i.key);
    const saved = await saveRun(person, { id: runId, checklistId: list.id, subject, answers: merged, complete });
    const no = Object.entries(merged).filter(([, a]) => a.value === "no").map(([k]) => k);
    return {
      artifacts: [{ kind: "checklist_run", id: saved, title: `${list.name}${subject ? ` · ${subject}` : ""}`, action: runId ? "updated" : "created" }],
      changed: true,
      text: [
        `${runId ? "Updated" : "Saved"} a run of "${list.name}"${subject ? ` for "${subject}"` : ""} as ${person.nameLocal || person.name} (run id: ${saved}), ${complete ? "marked complete" : "not yet complete"}.`,
        `${Object.keys(merged).length} of ${list.items.length} answered${no.length ? `; answered no: ${no.join(", ")}` : ""}.`,
        ...(missing.length ? [`Still unanswered: ${missing.join(", ")}.`] : []),
      ].join("\n"),
    };
  }

  return { text: `Unknown tool ${name}.` };
}

export const legalPack: ToolPack = { module: "legal", defs, run };
