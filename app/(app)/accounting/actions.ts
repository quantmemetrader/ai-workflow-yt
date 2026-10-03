"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import {
  addDocument,
  archiveAccount,
  closePeriod,
  createAccount,
  deleteDraft,
  DuplicateAccountCode,
  exportPeriodCsv,
  periodCloseView,
  postEntry,
  removeDocument,
  reopenPeriod,
  saveEntry,
  seedAccounts,
  unarchiveAccount,
  voidEntry,
} from "@/lib/accounting/service";
import { periodOfDate } from "@/lib/accounting/close";

async function bookkeeper() {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("accounting")) return null;
  return viewer;
}

const refresh = () => revalidatePath("/accounting");
const id = (v: unknown) => (typeof v === "string" && v && v.length <= 64 ? v : null);
const period = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}$/.test(v) ? v : null);
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

function micros(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > 1e12) return null;
  return Math.round(n * 1_000_000);
}

export async function seedAccountsAction() {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "你没有权限这样做" };
  try {
    await seedAccounts(viewer);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能完成，请再试一次" };
  }
}

export async function createAccountAction(code: string, name: string, kind: string) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "你没有权限这样做" };
  const kinds = ["asset", "liability", "equity", "income", "expense"];
  if (!kinds.includes(kind)) return { error: "没有这种科目类型" };
  try {
    await createAccount(viewer, {
      code: String(code ?? "").slice(0, 24),
      name: String(name ?? "").slice(0, 160),
      kind,
    });
    refresh();
    return {};
  } catch (err) {
    /* (4 Oct) A code already in use says so; a hidden one comes back with the
       account, so the screen can offer to show it again. */
    if (err instanceof DuplicateAccountCode) return { error: err.message, hidden: err.hidden };
    return { error: err instanceof Error ? err.message : "没能添加，请再试一次" };
  }
}

export async function unarchiveAccountAction(accountId: string) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "你没有权限这样做" };
  if (!id(accountId)) return { error: "找不到这一项" };
  try {
    await unarchiveAccount(viewer, accountId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能完成，请再试一次" };
  }
}

export async function archiveAccountAction(accountId: string) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "你没有权限这样做" };
  if (!id(accountId)) return { error: "找不到这一项" };
  try {
    await archiveAccount(viewer, accountId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能完成，请再试一次" };
  }
}

export async function addDocumentAction(input: {
  title: string;
  supplier: string;
  documentDate: string;
  amount: string;
  note: string;
  fileId: string | null;
}) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "你没有权限这样做" };
  try {
    await addDocument(viewer, {
      title: String(input.title ?? "").slice(0, 200),
      supplier: String(input.supplier ?? "").slice(0, 160) || null,
      documentDate: day(input.documentDate),
      amountMicros: input.amount ? micros(input.amount) : null,
      note: String(input.note ?? "").slice(0, 2000) || null,
      fileId: id(input.fileId),
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能添加，请再试一次" };
  }
}

export async function removeDocumentAction(documentId: string) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "你没有权限这样做" };
  if (!id(documentId)) return { error: "找不到这一项" };
  try {
    await removeDocument(viewer, documentId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能完成，请再试一次" };
  }
}

export async function saveEntryAction(input: {
  id?: string | null;
  /** Ignored since 4 Oct: the period is the month of `entryDate` (in the service too). */
  period?: string;
  entryDate: string;
  memo: string;
  documentId?: string | null;
  lines: { accountId: string; amount: string; description?: string }[];
}) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "你没有权限这样做" };

  const d = day(input.entryDate);
  const p = d ? periodOfDate(d) : null;
  if (!d || !p) return { error: "请填写日期" };

  const lines = (Array.isArray(input.lines) ? input.lines : [])
    .map((l) => ({
      accountId: id(l.accountId) ?? "",
      amountMicros: micros(l.amount) ?? 0,
      description: String(l.description ?? "").slice(0, 300) || null,
    }))
    .filter((l) => l.accountId && l.amountMicros !== 0);

  try {
    const entryId = await saveEntry(viewer, {
      id: id(input.id),
      entryDate: d,
      memo: String(input.memo ?? "").slice(0, 1000),
      documentId: id(input.documentId),
      lines,
    });
    refresh();
    return { id: entryId, period: p };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能保存，请再试一次" };
  }
}

export async function postEntryAction(entryId: string) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "你没有权限这样做" };
  if (!id(entryId)) return { error: "找不到这一项" };
  try {
    await postEntry(viewer, entryId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能过账，请再试一次" };
  }
}

export async function voidEntryAction(entryId: string) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "你没有权限这样做" };
  if (!id(entryId)) return { error: "找不到这一项" };
  try {
    await voidEntry(viewer, entryId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能作废，请再试一次" };
  }
}

export async function deleteDraftAction(entryId: string) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "你没有权限这样做" };
  if (!id(entryId)) return { error: "找不到这一项" };
  try {
    await deleteDraft(viewer, entryId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能删除，请再试一次" };
  }
}

/** The CSV comes back as text so the browser can offer it as a download
 * without a route that would have to repeat the permission check. */
export async function exportPeriodAction(p: string) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "你没有权限这样做" as const };
  const valid = period(p);
  if (!valid) return { error: "期间格式不对" as const };
  const csv = await exportPeriodCsv(viewer, valid);
  return { csv, filename: `journal-${valid}.csv` };
}

/* ---------------------------------------------------- month-end close (月结) */

/** One month's checklist, status and summary, for the 月结 tab's month picker. */
export async function periodCloseViewAction(p: string) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "你没有权限这样做" as const };
  const valid = period(p);
  if (!valid) return { error: "月份格式不对" as const };
  try {
    return { view: await periodCloseView(viewer, valid) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能读取，请再试一次" };
  }
}

/** 结账. The service refuses anyone but an owner or admin; checked here too so
 * the refusal is the same words as every other action's. */
export async function closePeriodAction(p: string, note?: string) {
  const viewer = await bookkeeper();
  if (!viewer || !viewer.isAdmin) return { error: "只有管理员或所有者可以结账" };
  const valid = period(p);
  if (!valid) return { error: "月份格式不对" };
  try {
    await closePeriod(viewer, valid, typeof note === "string" ? note.slice(0, 500) : null);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能结账，请再试一次" };
  }
}

export async function reopenPeriodAction(p: string, reason: string) {
  const viewer = await bookkeeper();
  if (!viewer || !viewer.isAdmin) return { error: "只有管理员或所有者可以反结账" };
  const valid = period(p);
  if (!valid) return { error: "月份格式不对" };
  try {
    await reopenPeriod(viewer, valid, String(reason ?? "").slice(0, 500));
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没能反结账，请再试一次" };
  }
}
