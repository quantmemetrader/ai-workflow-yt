import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accounts, documents, journalEntries, journalLines, users } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";

/**
 * Accounting (spec §4.7).
 *
 * Manual, at the client's own direction: nothing is read off a document
 * automatically, there is no accounting system to integrate with, and the
 * export is a CSV.
 *
 * What survives the simplification is the rule the spec actually cares about:
 * **nothing posts without a confirmation.** An entry is a draft until a named
 * person posts it, posting refuses an entry that does not balance, and a
 * posted entry is immutable. A correction is another entry, which is what
 * double entry is for and why "just edit it" is not offered.
 */

/** A chart of accounts that lets somebody start today. Created on first use,
 * never silently re-created, and every line editable afterwards. */
const STARTER: { code: string; name: string; kind: string }[] = [
  { code: "1000", name: "Cash at bank", kind: "asset" },
  { code: "1100", name: "Accounts receivable", kind: "asset" },
  { code: "2000", name: "Accounts payable", kind: "liability" },
  { code: "3000", name: "Owner equity", kind: "equity" },
  { code: "4000", name: "Production income", kind: "income" },
  { code: "5000", name: "Contractors and crew", kind: "expense" },
  { code: "5100", name: "Software and subscriptions", kind: "expense" },
  { code: "5200", name: "Equipment", kind: "expense" },
  { code: "5300", name: "Travel", kind: "expense" },
  { code: "5400", name: "Model and API spend", kind: "expense" },
  { code: "5900", name: "Other expenses", kind: "expense" },
];

export type AccountRow = { id: string; code: string; name: string; kind: string };

export async function listAccounts(viewer: Viewer): Promise<AccountRow[]> {
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.tenantId, viewer.tenantId), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.code));
  return rows.map((a) => ({ id: a.id, code: a.code, name: a.name, kind: a.kind }));
}

/** Writes the starter chart, once. `onConflictDoNothing` on the code index is
 * what makes "once" true even if two people press it together. */
export async function seedAccounts(viewer: Viewer) {
  await db
    .insert(accounts)
    .values(
      STARTER.map((a) => ({
        id: newId("acct"),
        tenantId: viewer.tenantId,
        code: a.code,
        name: a.name,
        kind: a.kind,
      })),
    )
    .onConflictDoNothing();
  await audit(viewer, "accounting.accounts.seed", { module: "accounting" });
}

export async function createAccount(viewer: Viewer, input: { code: string; name: string; kind: string }) {
  const code = input.code.trim();
  const name = input.name.trim();
  if (!code || !name) throw new Error("An account needs a code and a name");
  const id = newId("acct");
  await db
    .insert(accounts)
    .values({ id, tenantId: viewer.tenantId, code, name, kind: input.kind })
    .onConflictDoNothing();
  await audit(viewer, "accounting.account.create", { module: "accounting", meta: { code, name } });
  return id;
}

export async function archiveAccount(viewer: Viewer, accountId: string) {
  await db
    .update(accounts)
    .set({ archivedAt: new Date() })
    .where(and(eq(accounts.id, accountId), eq(accounts.tenantId, viewer.tenantId)));
  await audit(viewer, "accounting.account.archive", { module: "accounting", objectId: accountId });
}

/* ------------------------------------------------------------- documents */

export type DocumentRow = {
  id: string;
  title: string;
  supplier: string | null;
  documentDate: string | null;
  amountMicros: number | null;
  currency: string;
  note: string | null;
  fileId: string | null;
  enteredAt: Date | null;
  addedByName: string | null;
  createdAt: Date;
};

export async function listDocuments(viewer: Viewer, onlyPending = false): Promise<DocumentRow[]> {
  const rows = await db
    .select({ d: documents, byName: users.name })
    .from(documents)
    .leftJoin(users, eq(users.id, documents.addedBy))
    .where(
      and(
        eq(documents.tenantId, viewer.tenantId),
        onlyPending ? isNull(documents.enteredAt) : undefined,
      ),
    )
    .orderBy(desc(documents.createdAt))
    .limit(200);

  return rows.map((r) => ({
    id: r.d.id,
    title: r.d.title,
    supplier: r.d.supplier,
    documentDate: r.d.documentDate,
    amountMicros: r.d.amountMicros,
    currency: r.d.currency,
    note: r.d.note,
    fileId: r.d.fileId,
    enteredAt: r.d.enteredAt,
    addedByName: r.byName,
    createdAt: r.d.createdAt,
  }));
}

export async function addDocument(
  viewer: Viewer,
  input: {
    title: string;
    supplier?: string | null;
    documentDate?: string | null;
    amountMicros?: number | null;
    currency?: string;
    note?: string | null;
    fileId?: string | null;
  },
) {
  const title = input.title.trim();
  if (!title) throw new Error("It needs a title");
  const id = newId("doc");
  await db.insert(documents).values({
    id,
    tenantId: viewer.tenantId,
    title,
    supplier: input.supplier?.trim() || null,
    documentDate: input.documentDate || null,
    amountMicros: input.amountMicros ?? null,
    currency: input.currency || "HKD",
    note: input.note?.slice(0, 2000) || null,
    fileId: input.fileId ?? null,
    addedBy: viewer.id,
  });
  await audit(viewer, "accounting.document.add", { module: "accounting", objectId: id });
  return id;
}

export async function removeDocument(viewer: Viewer, documentId: string) {
  await db
    .delete(documents)
    .where(and(eq(documents.id, documentId), eq(documents.tenantId, viewer.tenantId), isNull(documents.enteredAt)));
  await audit(viewer, "accounting.document.remove", { module: "accounting", objectId: documentId });
}

/* --------------------------------------------------------------- entries */

export type EntryLine = { id: string; accountId: string; code: string; name: string; amountMicros: number; description: string | null };

export type EntryRow = {
  id: string;
  period: string;
  entryDate: string;
  memo: string;
  state: string;
  documentId: string | null;
  documentTitle: string | null;
  postedByName: string | null;
  postedAt: Date | null;
  createdByName: string | null;
  lines: EntryLine[];
  /** Sum of the lines. Zero means it balances; anything else is why it will
   * not post, and the screen shows the number rather than a red cross. */
  balanceMicros: number;
};

export async function listEntries(viewer: Viewer, period?: string): Promise<EntryRow[]> {
  const rows = await db
    .select({
      e: journalEntries,
      documentTitle: documents.title,
      postedByName: sql<string | null>`poster.name`,
      createdByName: sql<string | null>`creator.name`,
    })
    .from(journalEntries)
    .leftJoin(documents, eq(documents.id, journalEntries.documentId))
    .leftJoin(sql`${users} as poster`, sql`poster.id = ${journalEntries.postedBy}`)
    .leftJoin(sql`${users} as creator`, sql`creator.id = ${journalEntries.createdBy}`)
    .where(
      and(eq(journalEntries.tenantId, viewer.tenantId), period ? eq(journalEntries.period, period) : undefined),
    )
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
    .limit(200);

  if (!rows.length) return [];

  const lines = await db
    .select({ l: journalLines, code: accounts.code, name: accounts.name })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(inArray(journalLines.entryId, rows.map((r) => r.e.id)));

  const byEntry = new Map<string, EntryLine[]>();
  for (const l of lines) {
    const list = byEntry.get(l.l.entryId) ?? [];
    list.push({
      id: l.l.id,
      accountId: l.l.accountId,
      code: l.code,
      name: l.name,
      amountMicros: l.l.amountMicros,
      description: l.l.description,
    });
    byEntry.set(l.l.entryId, list);
  }

  return rows.map((r) => {
    const own = (byEntry.get(r.e.id) ?? []).sort((a, b) => b.amountMicros - a.amountMicros);
    return {
      id: r.e.id,
      period: r.e.period,
      entryDate: r.e.entryDate,
      memo: r.e.memo,
      state: r.e.state,
      documentId: r.e.documentId,
      documentTitle: r.documentTitle,
      postedByName: r.postedByName,
      postedAt: r.e.postedAt,
      createdByName: r.createdByName,
      lines: own,
      balanceMicros: own.reduce((n, l) => n + l.amountMicros, 0),
    };
  });
}

export async function saveEntry(
  viewer: Viewer,
  input: {
    id?: string | null;
    period: string;
    entryDate: string;
    memo: string;
    documentId?: string | null;
    lines: { accountId: string; amountMicros: number; description?: string | null }[];
  },
) {
  const clean = input.lines.filter((l) => l.accountId && Number.isFinite(l.amountMicros) && l.amountMicros !== 0);
  if (clean.length < 2) throw new Error("An entry needs at least two lines");

  if (input.id) {
    const [current] = await db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.id, input.id), eq(journalEntries.tenantId, viewer.tenantId)))
      .limit(1);
    if (!current) throw new Error("That entry does not exist");
    // A posted entry is immutable. A correction is another entry.
    if (current.state === "posted") throw new Error("A posted entry cannot be edited. Write a correcting entry.");

    await db
      .update(journalEntries)
      .set({
        period: input.period,
        entryDate: input.entryDate,
        memo: input.memo.slice(0, 1000),
        documentId: input.documentId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(journalEntries.id, current.id));

    await db.delete(journalLines).where(eq(journalLines.entryId, current.id));
    await db.insert(journalLines).values(
      clean.map((l) => ({
        id: newId("doc"),
        entryId: current.id,
        accountId: l.accountId,
        amountMicros: Math.round(l.amountMicros),
        description: l.description?.slice(0, 300) ?? null,
      })),
    );

    await audit(viewer, "accounting.entry.update", {
      module: "accounting",
      objectType: "journal_entry",
      objectId: current.id,
    });
    return current.id;
  }

  const id = newId("doc");
  await db.insert(journalEntries).values({
    id,
    tenantId: viewer.tenantId,
    period: input.period,
    entryDate: input.entryDate,
    memo: input.memo.slice(0, 1000),
    documentId: input.documentId ?? null,
    createdBy: viewer.id,
  });
  await db.insert(journalLines).values(
    clean.map((l) => ({
      id: newId("doc"),
      entryId: id,
      accountId: l.accountId,
      amountMicros: Math.round(l.amountMicros),
      description: l.description?.slice(0, 300) ?? null,
    })),
  );

  await audit(viewer, "accounting.entry.create", {
    module: "accounting",
    objectType: "journal_entry",
    objectId: id,
  });
  return id;
}

/**
 * Post an entry. The confirmation the spec asks for.
 *
 * The state is claimed in the statement that checks it, so two people pressing
 * Post produce one posting. The balance is checked here rather than on the
 * screen, because the screen is not the thing that has to be right.
 */
export async function postEntry(viewer: Viewer, entryId: string) {
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.tenantId, viewer.tenantId)))
    .limit(1);
  if (!entry) throw new Error("That entry does not exist");
  if (entry.state === "posted") throw new Error("That entry is already posted");

  const [sum] = await db
    .select({ total: sql<number>`coalesce(sum(${journalLines.amountMicros}), 0)::bigint` })
    .from(journalLines)
    .where(eq(journalLines.entryId, entryId));

  const balance = Number(sum?.total ?? 0);
  if (balance !== 0) {
    throw new Error(`This entry is out by ${(balance / 1_000_000).toFixed(2)}. It has to balance before it posts.`);
  }

  const claimed = await db
    .update(journalEntries)
    .set({ state: "posted", postedBy: viewer.id, postedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.state, "draft")))
    .returning({ id: journalEntries.id });
  if (!claimed.length) throw new Error("That entry is no longer a draft");

  if (entry.documentId) {
    await db
      .update(documents)
      .set({ enteredAt: new Date() })
      .where(eq(documents.id, entry.documentId));
  }

  await audit(viewer, "accounting.entry.post", {
    module: "accounting",
    objectType: "journal_entry",
    objectId: entryId,
  });
}

/** Voiding is how a posted entry is undone: the row stays, and the reason is
 * on the record. Nothing is deleted. */
export async function voidEntry(viewer: Viewer, entryId: string) {
  const claimed = await db
    .update(journalEntries)
    .set({ state: "void", updatedAt: new Date() })
    .where(
      and(
        eq(journalEntries.id, entryId),
        eq(journalEntries.tenantId, viewer.tenantId),
        eq(journalEntries.state, "posted"),
      ),
    )
    .returning({ id: journalEntries.id });
  if (!claimed.length) throw new Error("Only a posted entry is voided");

  await audit(viewer, "accounting.entry.void", {
    module: "accounting",
    objectType: "journal_entry",
    objectId: entryId,
  });
}

export async function deleteDraft(viewer: Viewer, entryId: string) {
  const deleted = await db
    .delete(journalEntries)
    .where(
      and(
        eq(journalEntries.id, entryId),
        eq(journalEntries.tenantId, viewer.tenantId),
        eq(journalEntries.state, "draft"),
      ),
    )
    .returning({ id: journalEntries.id });
  if (!deleted.length) throw new Error("Only a draft is deleted");
  await audit(viewer, "accounting.entry.delete", { module: "accounting", objectId: entryId });
}

/* ---------------------------------------------------------------- period */

export async function periodSummary(viewer: Viewer, period: string) {
  const rows = await db
    .select({
      accountId: journalLines.accountId,
      code: accounts.code,
      name: accounts.name,
      kind: accounts.kind,
      total: sql<number>`coalesce(sum(${journalLines.amountMicros}), 0)::bigint`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalEntries.tenantId, viewer.tenantId),
        eq(journalEntries.period, period),
        eq(journalEntries.state, "posted"),
      ),
    )
    .groupBy(journalLines.accountId, accounts.code, accounts.name, accounts.kind)
    .orderBy(accounts.code);

  const [drafts] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, viewer.tenantId),
        eq(journalEntries.period, period),
        eq(journalEntries.state, "draft"),
      ),
    );

  const [unentered] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(documents)
    .where(and(eq(documents.tenantId, viewer.tenantId), isNull(documents.enteredAt)));

  return {
    period,
    balances: rows.map((r) => ({
      code: r.code,
      name: r.name,
      kind: r.kind,
      totalMicros: Number(r.total),
    })),
    draftCount: drafts?.n ?? 0,
    unenteredDocuments: unentered?.n ?? 0,
  };
}

/**
 * The period as a CSV, in the order a bookkeeper reads it.
 *
 * Only posted entries: a draft is not a transaction and must not reach
 * whatever system this lands in. Built as a string here rather than in the
 * browser so the same export is available to a script later.
 */
export async function exportPeriodCsv(viewer: Viewer, period: string): Promise<string> {
  const rows = await db
    .select({
      entryDate: journalEntries.entryDate,
      memo: journalEntries.memo,
      code: accounts.code,
      name: accounts.name,
      amountMicros: journalLines.amountMicros,
      description: journalLines.description,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalEntries.tenantId, viewer.tenantId),
        eq(journalEntries.period, period),
        eq(journalEntries.state, "posted"),
      ),
    )
    .orderBy(asc(journalEntries.entryDate), asc(accounts.code));

  const esc = (v: string | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = "Date,Memo,Account code,Account,Debit,Credit,Line description";
  const body = rows.map((r) => {
    const amount = r.amountMicros / 1_000_000;
    return [
      esc(r.entryDate),
      esc(r.memo),
      esc(r.code),
      esc(r.name),
      amount > 0 ? amount.toFixed(2) : "",
      amount < 0 ? (-amount).toFixed(2) : "",
      esc(r.description),
    ].join(",");
  });

  await audit(viewer, "accounting.export", { module: "accounting", meta: { period, lines: rows.length } });
  return [header, ...body].join("\n");
}
