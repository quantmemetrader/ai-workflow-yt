import "server-only";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { accountingPeriods, accounts, documents, journalEntries, journalLines, users } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";
import { closeBlockers, isPeriod, lockedReason, reopenBlocker, type CloseChecklist } from "@/lib/accounting/close";

/** (QA, 2 Oct) A person's name the way the reader reads it: the Chinese name on a Chinese screen. */
function personName(viewer: Viewer) {
  return (viewer.locale ?? "zh-CN").startsWith("zh")
    ? sql<string | null>`coalesce(nullif(${users.nameLocal}, ''), ${users.name})`
    : sql<string | null>`${users.name}`;
}


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
  if (!code || !name) throw new Error("科目需要编号和名称");
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
    .select({ d: documents, byName: personName(viewer) })
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
  if (!title) throw new Error("请填写标题");
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
  if (clean.length < 2) throw new Error("一笔分录至少要有两行");

  /* 月结: nothing may be written into, or dated into, a closed month. */
  const closed = await closedPeriodSet(viewer.tenantId);
  const intoClosed = lockedReason(closed, input, "录入或修改");
  if (intoClosed) throw new Error(intoClosed);

  if (input.id) {
    const [current] = await db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.id, input.id), eq(journalEntries.tenantId, viewer.tenantId)))
      .limit(1);
    if (!current) throw new Error("这笔分录不存在");
    // A posted entry is immutable. A correction is another entry.
    if (current.state === "posted") throw new Error("已过账的分录不能修改，请另写一笔更正分录。");
    const fromClosed = lockedReason(closed, current, "修改");
    if (fromClosed) throw new Error(fromClosed);

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
  if (!entry) throw new Error("这笔分录不存在");
  if (entry.state === "posted") throw new Error("这笔分录已经过账");
  const locked = lockedReason(await closedPeriodSet(viewer.tenantId), entry, "过账");
  if (locked) throw new Error(locked);

  const [sum] = await db
    .select({ total: sql<number>`coalesce(sum(${journalLines.amountMicros}), 0)::bigint` })
    .from(journalLines)
    .where(eq(journalLines.entryId, entryId));

  const balance = Number(sum?.total ?? 0);
  if (balance !== 0) {
    throw new Error(`借贷差 ${(balance / 1_000_000).toFixed(2)}，平衡后才能过账。`);
  }

  const claimed = await db
    .update(journalEntries)
    .set({ state: "posted", postedBy: viewer.id, postedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.state, "draft"), inOpenPeriod(viewer.tenantId)))
    .returning({ id: journalEntries.id });
  if (!claimed.length) throw new Error("这笔分录已经不是草稿，或所在月份刚刚结账");

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
  await assertEntryOpen(viewer, entryId, "作废");
  const claimed = await db
    .update(journalEntries)
    .set({ state: "void", updatedAt: new Date() })
    .where(
      and(
        eq(journalEntries.id, entryId),
        eq(journalEntries.tenantId, viewer.tenantId),
        eq(journalEntries.state, "posted"),
        inOpenPeriod(viewer.tenantId),
      ),
    )
    .returning({ id: journalEntries.id });
  if (!claimed.length) throw new Error("只有已过账的分录才能作废");

  await audit(viewer, "accounting.entry.void", {
    module: "accounting",
    objectType: "journal_entry",
    objectId: entryId,
  });
}

export async function deleteDraft(viewer: Viewer, entryId: string) {
  await assertEntryOpen(viewer, entryId, "删除");
  const deleted = await db
    .delete(journalEntries)
    .where(
      and(
        eq(journalEntries.id, entryId),
        eq(journalEntries.tenantId, viewer.tenantId),
        eq(journalEntries.state, "draft"),
        inOpenPeriod(viewer.tenantId),
      ),
    )
    .returning({ id: journalEntries.id });
  if (!deleted.length) throw new Error("只有草稿可以删除");
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
  /* Chinese column names: the studio's bookkeeping is read in Chinese (QA, 3 Oct). */
  const header = "日期,摘要,科目代码,科目,借方,贷方,分录说明";
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

/* ------------------------------------------------------- month-end close */

/** The months this tenant has closed (and not reopened). */
export async function closedPeriodSet(tenantId: string): Promise<Set<string>> {
  const rows = await db
    .select({ period: accountingPeriods.period })
    .from(accountingPeriods)
    .where(and(eq(accountingPeriods.tenantId, tenantId), eq(accountingPeriods.closed, true)));
  return new Set(rows.map((r) => r.period));
}

/** In the statement that claims the row, so a month closed between the check
 * and the write still wins: the entry's period and the month of its date are
 * both open. */
function inOpenPeriod(tenantId: string) {
  return sql`not exists (select 1 from ${accountingPeriods} ap where ap.tenant_id = ${tenantId} and ap.closed and (ap.period = ${journalEntries.period} or ap.period = substr(${journalEntries.entryDate}, 1, 7)))`;
}

async function assertEntryOpen(viewer: Viewer, entryId: string, verb: string) {
  const [entry] = await db
    .select({ period: journalEntries.period, entryDate: journalEntries.entryDate })
    .from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.tenantId, viewer.tenantId)))
    .limit(1);
  if (!entry) throw new Error("这笔分录不存在");
  const locked = lockedReason(await closedPeriodSet(viewer.tenantId), entry, verb);
  if (locked) throw new Error(locked);
}

export type PeriodStatus = {
  period: string;
  entries: number;
  closed: boolean;
  closedAt: Date | null;
  closedByName: string | null;
  note: string | null;
  reopenedAt: Date | null;
  reopenedByName: string | null;
  reopenReason: string | null;
};

async function periodRows(viewer: Viewer, only?: string) {
  const rows = await db
    .select({
      p: accountingPeriods,
      closedByName: sql<string | null>`closer.name`,
      closedByLocal: sql<string | null>`closer.name_local`,
      reopenedByName: sql<string | null>`reopener.name`,
      reopenedByLocal: sql<string | null>`reopener.name_local`,
    })
    .from(accountingPeriods)
    .leftJoin(sql`${users} as closer`, sql`closer.id = ${accountingPeriods.closedBy}`)
    .leftJoin(sql`${users} as reopener`, sql`reopener.id = ${accountingPeriods.reopenedBy}`)
    .where(and(eq(accountingPeriods.tenantId, viewer.tenantId), only ? eq(accountingPeriods.period, only) : undefined));
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const pick = (name: string | null, local: string | null) => (zh && local ? local : name);
  return new Map(
    rows.map((r) => [
      r.p.period,
      {
        closed: r.p.closed,
        closedAt: r.p.closedAt,
        closedByName: pick(r.closedByName, r.closedByLocal),
        note: r.p.note,
        reopenedAt: r.p.reopenedAt,
        reopenedByName: pick(r.reopenedByName, r.reopenedByLocal),
        reopenReason: r.p.reopenReason,
      },
    ]),
  );
}

const EMPTY_STATUS = {
  closed: false,
  closedAt: null,
  closedByName: null,
  note: null,
  reopenedAt: null,
  reopenedByName: null,
  reopenReason: null,
};

/** Every month with entries or a close record, plus this month, newest first. */
export async function listPeriodStatuses(viewer: Viewer): Promise<PeriodStatus[]> {
  const counts = await db
    .select({ period: journalEntries.period, n: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(eq(journalEntries.tenantId, viewer.tenantId))
    .groupBy(journalEntries.period);
  const byPeriod = new Map(counts.map((c) => [c.period, c.n]));
  const status = await periodRows(viewer);
  const months = new Set<string>([new Date().toISOString().slice(0, 7), ...byPeriod.keys(), ...status.keys()]);
  return [...months]
    .filter(isPeriod)
    .sort()
    .reverse()
    .slice(0, 36)
    .map((period) => ({ period, entries: byPeriod.get(period) ?? 0, ...(status.get(period) ?? EMPTY_STATUS) }));
}

/** An entry belongs to the month it is booked into, or the month it is dated in. */
const inMonth = (period: string) =>
  or(eq(journalEntries.period, period), sql`substr(${journalEntries.entryDate}, 1, 7) = ${period}`);

async function closeChecklist(viewer: Viewer, period: string): Promise<CloseChecklist> {
  const [drafts] = await db
    .select({
      n: sql<number>`count(*)::int`,
      unbalanced: sql<number>`(count(*) filter (where coalesce((select sum(jl.amount_micros) from ${journalLines} jl where jl.entry_id = ${journalEntries.id}), 0) <> 0))::int`,
    })
    .from(journalEntries)
    .where(and(eq(journalEntries.tenantId, viewer.tenantId), eq(journalEntries.state, "draft"), inMonth(period)));

  const [docs] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, viewer.tenantId),
        isNull(documents.enteredAt),
        or(
          sql`substr(${documents.documentDate}, 1, 7) = ${period}`,
          and(isNull(documents.documentDate), sql`to_char(${documents.createdAt}, 'YYYY-MM') = ${period}`),
        ),
      ),
    );

  const [trial] = await db
    .select({ total: sql<number>`coalesce(sum(${journalLines.amountMicros}), 0)::bigint` })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalEntries.tenantId, viewer.tenantId), eq(journalEntries.period, period), eq(journalEntries.state, "posted")));

  const earlier = await db
    .selectDistinct({ period: journalEntries.period })
    .from(journalEntries)
    .where(and(eq(journalEntries.tenantId, viewer.tenantId), lt(journalEntries.period, period)));
  const closed = await closedPeriodSet(viewer.tenantId);

  return {
    drafts: drafts?.n ?? 0,
    unbalanced: drafts?.unbalanced ?? 0,
    unenteredDocuments: docs?.n ?? 0,
    trialBalanceMicros: Number(trial?.total ?? 0),
    earlierOpen: earlier.map((e) => e.period).filter((p) => isPeriod(p) && !closed.has(p)).sort(),
  };
}

export type PeriodCloseView = {
  period: string;
  status: Omit<PeriodStatus, "period" | "entries">;
  checklist: CloseChecklist;
  blockers: string[];
  balances: { code: string; name: string; kind: string; totalMicros: number }[];
};

/** Everything the 月结 tab shows for one month. */
export async function periodCloseView(viewer: Viewer, period: string): Promise<PeriodCloseView> {
  const [checklist, summary, status] = await Promise.all([
    closeChecklist(viewer, period),
    periodSummary(viewer, period),
    periodRows(viewer, period),
  ]);
  return {
    period,
    status: status.get(period) ?? EMPTY_STATUS,
    checklist,
    blockers: closeBlockers(period, checklist),
    balances: summary.balances,
  };
}

/** 结账. Owner or admin only; refused with every reason at once while anything blocks it. */
export async function closePeriod(viewer: Viewer, period: string, note?: string | null) {
  if (!viewer.isAdmin) throw new Error("只有管理员或所有者可以结账");
  if (!isPeriod(period)) throw new Error("月份格式不对");

  const checklist = await closeChecklist(viewer, period);
  const blockers = closeBlockers(period, checklist);
  if (blockers.length) throw new Error(`${period} 还不能结账：${blockers.join("；")}`);

  const now = new Date();
  const cleanNote = note?.trim().slice(0, 500) || null;
  const done = await db
    .insert(accountingPeriods)
    .values({
      id: newId("per"),
      tenantId: viewer.tenantId,
      period,
      closed: true,
      closedAt: now,
      closedBy: viewer.id,
      note: cleanNote,
    })
    .onConflictDoUpdate({
      target: [accountingPeriods.tenantId, accountingPeriods.period],
      set: { closed: true, closedAt: now, closedBy: viewer.id, note: cleanNote, updatedAt: now },
      setWhere: eq(accountingPeriods.closed, false),
    })
    .returning({ id: accountingPeriods.id });
  if (!done.length) throw new Error(`${period} 已经结账了`);

  await audit(viewer, "accounting.period.close", {
    module: "accounting",
    objectType: "accounting_period",
    objectId: done[0].id,
    meta: { period, note: cleanNote, unenteredDocuments: checklist.unenteredDocuments },
  });
}

/** 反结账. Owner or admin only, with a reason, latest closed month first. */
export async function reopenPeriod(viewer: Viewer, period: string, reason: string) {
  if (!viewer.isAdmin) throw new Error("只有管理员或所有者可以反结账");
  const blocker = reopenBlocker(period, await closedPeriodSet(viewer.tenantId), reason ?? "");
  if (blocker) throw new Error(blocker);

  const why = reason.trim().slice(0, 500);
  const done = await db
    .update(accountingPeriods)
    .set({ closed: false, reopenedAt: new Date(), reopenedBy: viewer.id, reopenReason: why, updatedAt: new Date() })
    .where(
      and(
        eq(accountingPeriods.tenantId, viewer.tenantId),
        eq(accountingPeriods.period, period),
        eq(accountingPeriods.closed, true),
      ),
    )
    .returning({ id: accountingPeriods.id });
  if (!done.length) throw new Error(`${period} 没有结账，无需反结账`);

  await audit(viewer, "accounting.period.reopen", {
    module: "accounting",
    objectType: "accounting_period",
    objectId: done[0].id,
    meta: { period, reason: why },
  });
}
