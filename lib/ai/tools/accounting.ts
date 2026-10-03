import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { files, journalEntries } from "@/lib/db/schema";
import type { ToolDef } from "@/lib/ai/openrouter";
import {
  closedPeriodSet,
  exportPeriodCsv,
  listAccounts,
  listEntries,
  postEntry,
  saveEntry,
  type AccountRow,
} from "@/lib/accounting/service";
import { beginUpload, completeUpload } from "@/lib/files/service";
import { putObjectConfirmed } from "@/lib/storage/r2";
import { dayOf, hk, hkMonthNow, monthArg, officePerson, parseAmount } from "./office";
import { id, num, str, type ToolContext, type ToolPack, type ToolResult } from "./types";

/**
 * Accounting, by conversation.
 *
 * "九月的分录有哪些", "记一笔：10 月 3 日付给摄影师 HK$8,000" and "把九月导出来"
 * are the journal screen in a sentence. Every figure comes from the ledger
 * through `lib/accounting/service.ts`, never from the model.
 *
 * There is no AI employee for Accounting. This pack serves the person's own
 * assistant and every tool runs *as that person*, so the record names who
 * wrote, posted or exported each entry. The service's rules are the screen's
 * and are not repeated or bypassed here: nothing is written into or dated
 * into a closed month (月结), an entry posts only when it balances, and a
 * posted entry never changes — a correction is another entry.
 *
 * Amounts are HK$ (`ACCOUNTING_CURRENCY`), stored in millionths: a debit is
 * positive and a credit negative, the way the export reads them.
 */
const defs: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "list_accounts",
      description: "The chart of accounts: each account's code, name, kind (asset, liability, equity, income, expense) and id. Read it before save_entry when unsure which account a line belongs to.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "list_entries",
      description:
        "Journal entries for one month, newest first: id, date, memo, state (draft, posted, void), each line's account with its debit or credit in HK$, whether it balances, who wrote and who posted it, and whether the month is closed.",
      parameters: {
        type: "object",
        properties: {
          period: { type: "string", description: "YYYY-MM. Optional; defaults to this month (Hong Kong time)." },
          state: { type: "string", enum: ["draft", "posted", "void"], description: "Optional." },
          limit: { type: "number", description: "Default 20." },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_entry",
      description:
        "Write a journal entry as a draft, as the person you are working for, or change a draft (pass its id). Each line names an account (by code, name or id) and either a debit or a credit in HK$; debits must equal credits. The month is the month of the entry date, and a closed month refuses it. Saving does not post: posting is post_entry. Only when the person explicitly asked in this turn to record this entry, with figures they gave.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "A draft to change, doc_…. Optional; a new draft if left out." },
          entry_date: { type: "string", description: "YYYY-MM-DD." },
          memo: { type: "string", description: "What the entry is, e.g. \"摄影师林一 九月拍摄费\"." },
          lines: {
            type: "array",
            description: "At least two lines that balance.",
            items: {
              type: "object",
              properties: {
                account: { type: "string", description: "Account code (e.g. \"5000\"), name or id." },
                debit: { type: "string", description: "HK$ amount debited, e.g. \"8,000\". Give debit or credit, not both." },
                credit: { type: "string", description: "HK$ amount credited." },
                description: { type: "string", description: "Optional line note." },
              },
              required: ["account"],
            },
          },
        },
        required: ["entry_date", "memo", "lines"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "post_entry",
      description:
        "Post a draft journal entry, as the person you are working for. Posting is the confirmation the books require: a posted entry can never be edited, only voided or corrected by another entry. It is refused if the entry does not balance or its month is closed. Only when the person explicitly asked in this turn to post this entry; never post as a follow-on to saving one.",
      parameters: {
        type: "object",
        properties: { id: { type: "string", description: "The entry id, doc_… from list_entries or save_entry." } },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "export_period",
      description:
        "Export one month's posted entries as a CSV (日期, 摘要, 科目代码, 科目, 借方, 贷方, 分录说明), saved as a file in the person's own files, and return its link. Drafts and voided entries are left out.",
      parameters: {
        type: "object",
        properties: { period: { type: "string", description: "YYYY-MM." } },
        required: ["period"],
      },
    },
  },
];

/** An account by id, exact code, exact name, or the one name that contains the words. */
function accountOf(accounts: AccountRow[], v: unknown): AccountRow | { error: string } {
  const wanted = str(v, 160);
  const lower = wanted.toLowerCase();
  if (!wanted) return { error: "Every line needs an account." };
  const exact =
    accounts.find((a) => a.id === wanted) ??
    accounts.find((a) => a.code === wanted) ??
    accounts.find((a) => a.name.toLowerCase() === lower);
  if (exact) return exact;
  const partial = accounts.filter((a) => a.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  return {
    error: partial.length > 1
      ? `"${wanted}" matches more than one account: ${partial.map((a) => `${a.code} ${a.name}`).join(", ")}. Say which.`
      : `No account matches "${wanted}". list_accounts lists them.`,
  };
}

const side = (micros: number) => (micros >= 0 ? `Dr ${hk(micros)}` : `Cr ${hk(-micros)}`);

const WRITES = new Set(["save_entry", "post_entry", "export_period"]);

async function run(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const gate = officePerson(ctx, "accounting");
  if ("refuse" in gate) return { text: gate.refuse };
  const person = gate.person;
  const who = person.nameLocal || person.name;
  if (ctx.readOnly && WRITES.has(name)) return { text: `${name} changes the books or makes a file, and this turn only looks things up.` };

  if (name === "list_accounts") {
    const accounts = await listAccounts(person);
    if (!accounts.length) return { text: "There is no chart of accounts yet. Somebody with Accounting access adds the starter chart on the Accounting screen." };
    return { text: accounts.map((a) => `- ${a.code} ${a.name} (${a.kind}, id: ${a.id})`).join("\n") };
  }

  if (name === "list_entries") {
    const period = args.period === undefined || args.period === "" ? hkMonthNow() : monthArg(args.period);
    if (!period) return { text: "A period is a month, written YYYY-MM." };
    const state = str(args.state, 10);
    const [rows, closed] = await Promise.all([listEntries(person, period), closedPeriodSet(person.tenantId)]);
    const shown = rows.filter((e) => !state || e.state === state);
    const head = `${period}${closed.has(period) ? " (closed: nothing can be written, posted or changed in it)" : ""}`;
    if (!shown.length) return { text: `No ${state ? `${state} ` : ""}journal entries in ${head}.` };
    return {
      text: [
        `Journal entries, ${head}, amounts HK$:`,
        ...shown.slice(0, Math.min(100, Math.max(1, num(args.limit, 20)))).map((e) =>
          [
            `- ${e.entryDate} ${e.memo || "(no memo)"} — ${e.state}` +
              (e.balanceMicros !== 0 ? ` · does NOT balance (off by ${hk(e.balanceMicros)})` : "") +
              (e.createdByName ? ` · written by ${e.createdByName}` : "") +
              (e.postedByName ? ` · posted by ${e.postedByName}` : "") +
              (e.documentTitle ? ` · document: ${e.documentTitle}` : "") +
              ` (id: ${e.id})`,
            ...e.lines.map((l) => `    ${l.code} ${l.name}: ${side(l.amountMicros)}${l.description ? ` · ${l.description}` : ""}`),
          ].join("\n"),
        ),
      ].join("\n"),
    };
  }

  if (name === "save_entry") {
    const entryDate = dayOf(args.entry_date);
    if (!entryDate) return { text: "The entry date is needed, written YYYY-MM-DD." };
    const memo = str(args.memo, 1000);
    if (!memo) return { text: "Give the entry a memo: what it is." };
    const raw = Array.isArray(args.lines) ? (args.lines as unknown[]) : [];
    if (raw.length < 2) return { text: "An entry needs at least two lines: what is debited and what is credited." };
    if (raw.length > 50) return { text: "That is more lines than one entry should hold. Split it." };

    const accounts = await listAccounts(person);
    if (!accounts.length) return { text: "There is no chart of accounts yet. Somebody with Accounting access adds the starter chart on the Accounting screen." };

    const lines: { accountId: string; amountMicros: number; description: string | null }[] = [];
    const said: string[] = [];
    for (const [i, item] of raw.entries()) {
      const l = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const account = accountOf(accounts, l.account);
      if ("error" in account) return { text: `Line ${i + 1}: ${account.error}` };
      const hasDebit = l.debit !== undefined && l.debit !== "" && l.debit !== null;
      const hasCredit = l.credit !== undefined && l.credit !== "" && l.credit !== null;
      if (hasDebit === hasCredit) return { text: `Line ${i + 1} (${account.code} ${account.name}): give a debit or a credit, one of the two.` };
      const amount = parseAmount(hasDebit ? l.debit : l.credit);
      if (amount === null || amount <= 0) return { text: `Line ${i + 1} (${account.code} ${account.name}): the amount is a positive HK$ figure with at most two decimals.` };
      const micros = hasDebit ? amount : -amount;
      lines.push({ accountId: account.id, amountMicros: micros, description: str(l.description, 300) || null });
      said.push(`${account.code} ${account.name}: ${side(micros)}`);
    }

    const debits = lines.filter((l) => l.amountMicros > 0).reduce((s, l) => s + l.amountMicros, 0);
    const credits = -lines.filter((l) => l.amountMicros < 0).reduce((s, l) => s + l.amountMicros, 0);
    if (debits !== credits) {
      return { text: `Not saved: debits ${hk(debits)} and credits ${hk(credits)} differ by ${hk(debits - credits)}. Every entry has to balance; check the figures with the person.` };
    }

    const draftId = args.id === undefined || args.id === "" ? null : id(args.id);
    if (args.id !== undefined && args.id !== "" && !draftId) return { text: "That is not an entry id. Use one from list_entries." };
    /* saveEntry refuses a closed month, a posted entry and a missing one,
       in Chinese, and its message is passed on as it is. */
    const entryId = await saveEntry(person, { id: draftId, entryDate, memo, lines });
    return {
      artifacts: [{ kind: "journal_entry", id: entryId, title: memo, action: draftId ? "updated" : "created" }],
      changed: true,
      text: [
        `${draftId ? "Draft updated" : "Saved as a draft"} by ${who}: ${entryDate} "${memo}" (id: ${entryId}), ${hk(debits)} each side.`,
        ...said.map((s) => `  ${s}`),
        "It is not posted. Posting is a separate step the person confirms (post_entry).",
      ].join("\n"),
    };
  }

  if (name === "post_entry") {
    const entryId = id(args.id);
    if (!entryId) return { text: "Give the entry id from list_entries." };
    const [entry] = await db
      .select({ memo: journalEntries.memo, entryDate: journalEntries.entryDate })
      .from(journalEntries)
      .where(and(eq(journalEntries.id, entryId), eq(journalEntries.tenantId, person.tenantId)))
      .limit(1);
    if (!entry) return { text: "No such entry. Use an id from list_entries." };
    /* postEntry refuses an unbalanced entry, a posted one and a closed month. */
    await postEntry(person, entryId);
    return {
      artifacts: [{ kind: "journal_entry", id: entryId, title: entry.memo, action: "updated" }],
      changed: true,
      text: `Posted by ${who}: ${entry.entryDate} "${entry.memo}" (id: ${entryId}). A posted entry cannot be edited; a mistake is corrected with another entry or by voiding it on the Accounting screen.`,
    };
  }

  if (name === "export_period") {
    const period = monthArg(args.period);
    if (!period) return { text: "A period is a month, written YYYY-MM." };
    const csv = await exportPeriodCsv(person, period);
    const lineCount = csv.split("\n").length - 1;
    if (lineCount <= 0) return { text: `${period} has no posted entries, so there is nothing to export. Drafts are not exported; they are posted first.` };

    /* A BOM so Excel opens the Chinese headers as UTF-8. */
    const bytes = new TextEncoder().encode(`﻿${csv}`);
    const filename = `journal-${period}.csv`;
    const { file, storageKey } = await beginUpload(person, { name: filename, mime: "text/csv", sizeBytes: bytes.byteLength });
    const stored = await putObjectConfirmed(storageKey, bytes, "text/csv");
    await completeUpload(person, file.id, stored.etag ?? undefined);
    await db.update(files).set({ text: csv.slice(0, 200_000) }).where(eq(files.id, file.id));

    return {
      artifacts: [{ kind: "file", id: file.id, title: filename, action: "created" }],
      changed: true,
      text: `Exported ${period}: ${lineCount} posted line(s), amounts HK$, saved to ${who}'s files as ${filename} (file id: ${file.id}). Open it at /files/${file.id}.`,
    };
  }

  return { text: `Unknown tool ${name}.` };
}

export const accountingPack: ToolPack = { module: "accounting", defs, run };
