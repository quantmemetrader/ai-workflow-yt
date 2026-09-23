"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import {
  addDocument,
  archiveAccount,
  createAccount,
  deleteDraft,
  exportPeriodCsv,
  postEntry,
  removeDocument,
  saveEntry,
  seedAccounts,
  voidEntry,
} from "@/lib/accounting/service";

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
  if (!viewer) return { error: "Not allowed" };
  try {
    await seedAccounts(viewer);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not do that" };
  }
}

export async function createAccountAction(code: string, name: string, kind: string) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "Not allowed" };
  const kinds = ["asset", "liability", "equity", "income", "expense"];
  if (!kinds.includes(kind)) return { error: "No such kind of account" };
  try {
    await createAccount(viewer, {
      code: String(code ?? "").slice(0, 24),
      name: String(name ?? "").slice(0, 160),
      kind,
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add that" };
  }
}

export async function archiveAccountAction(accountId: string) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "Not allowed" };
  if (!id(accountId)) return { error: "Not found" };
  try {
    await archiveAccount(viewer, accountId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not do that" };
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
  if (!viewer) return { error: "Not allowed" };
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
    return { error: err instanceof Error ? err.message : "Could not add that" };
  }
}

export async function removeDocumentAction(documentId: string) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "Not allowed" };
  if (!id(documentId)) return { error: "Not found" };
  try {
    await removeDocument(viewer, documentId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not do that" };
  }
}

export async function saveEntryAction(input: {
  id?: string | null;
  period: string;
  entryDate: string;
  memo: string;
  documentId?: string | null;
  lines: { accountId: string; amount: string; description?: string }[];
}) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "Not allowed" };

  const p = period(input.period);
  const d = day(input.entryDate);
  if (!p || !d) return { error: "A date and a period are needed" };

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
      period: p,
      entryDate: d,
      memo: String(input.memo ?? "").slice(0, 1000),
      documentId: id(input.documentId),
      lines,
    });
    refresh();
    return { id: entryId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save that" };
  }
}

export async function postEntryAction(entryId: string) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "Not allowed" };
  if (!id(entryId)) return { error: "Not found" };
  try {
    await postEntry(viewer, entryId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not post that" };
  }
}

export async function voidEntryAction(entryId: string) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "Not allowed" };
  if (!id(entryId)) return { error: "Not found" };
  try {
    await voidEntry(viewer, entryId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not void that" };
  }
}

export async function deleteDraftAction(entryId: string) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "Not allowed" };
  if (!id(entryId)) return { error: "Not found" };
  try {
    await deleteDraft(viewer, entryId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete that" };
  }
}

/** The CSV comes back as text so the browser can offer it as a download
 * without a route that would have to repeat the permission check. */
export async function exportPeriodAction(p: string) {
  const viewer = await bookkeeper();
  if (!viewer) return { error: "Not allowed" as const };
  const valid = period(p);
  if (!valid) return { error: "That is not a period" as const };
  const csv = await exportPeriodCsv(viewer, valid);
  return { csv, filename: `journal-${valid}.csv` };
}
