"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { clean } from "@/lib/files/doc-edit";
import { toSimplified } from "@/lib/text/simplified";
import { isContractState, updateContract } from "@/lib/legal/service";
import { saveReport, shareReport } from "@/lib/finance/reports";
import { renameSpend, writeSpendDescription } from "@/lib/finance/service";

/**
 * Saves from the document pages of records that are not files (5 Oct):
 * contracts, monthly reports, spend requests. Each is bound to its record on
 * the server page and sends the formatted page with its text; the module and
 * the record's own rules are checked again here and in the services.
 */

const okId = (v: unknown) => (typeof v === "string" && /^[a-z]+_[0-9a-z]+$/i.test(v) && v.length <= 64 ? v : null);
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : v === "" ? null : undefined);

async function holder(module: "legal" | "finance") {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes(module)) return null;
  return viewer;
}

const fail = (err: unknown, fallback: string) => ({ error: err instanceof Error ? err.message : fallback });

export async function saveContractDocAction(contractId: string, html: string, text: string) {
  const viewer = await holder("legal");
  if (!viewer) return { error: "你没有权限这样做" };
  if (!okId(contractId) || typeof html !== "string" || typeof text !== "string") return { error: "找不到这一项" };
  try {
    await updateContract(viewer, contractId, { body: toSimplified(text), bodyHtml: toSimplified(clean(html)) });
    revalidatePath("/legal");
    return {};
  } catch (err) {
    return fail(err, "没能保存，请再试一次");
  }
}

export async function renameContractAction(contractId: string, name: string) {
  const viewer = await holder("legal");
  if (!viewer) return { error: "你没有权限这样做" };
  const title = String(name ?? "").trim().slice(0, 300);
  if (!okId(contractId) || !title) return { error: "请填写合同标题" };
  try {
    await updateContract(viewer, contractId, { title });
    revalidatePath("/legal");
    return { name: title };
  } catch (err) {
    return fail(err, "没能改名，请再试一次");
  }
}

/** The details in the contract page's side panel: who it is with, its state and dates. */
export async function updateContractDetailsAction(
  contractId: string,
  input: { counterparty?: string; state?: string; signedOn?: string; expiresOn?: string },
) {
  const viewer = await holder("legal");
  if (!viewer) return { error: "你没有权限这样做" };
  if (!okId(contractId)) return { error: "找不到这一项" };
  if (input.state !== undefined && !isContractState(input.state)) return { error: "没有这个状态" };
  const signedOn = day(input.signedOn);
  const expiresOn = day(input.expiresOn);
  try {
    await updateContract(viewer, contractId, {
      ...(input.counterparty !== undefined ? { counterparty: String(input.counterparty).slice(0, 200) || null } : {}),
      ...(input.state !== undefined && isContractState(input.state) ? { state: input.state } : {}),
      ...(signedOn !== undefined ? { signedOn } : {}),
      ...(expiresOn !== undefined ? { expiresOn } : {}),
    });
    revalidatePath("/legal");
    revalidatePath(`/legal/contracts/${contractId}`);
    return {};
  } catch (err) {
    return fail(err, "没能保存，请再试一次");
  }
}

/** A draft report's page. A shared report is a record: its page is read-only, and 另存为新草稿 forks it. */
export async function saveReportDocAction(reportId: string, html: string, text: string) {
  const viewer = await holder("finance");
  if (!viewer) return { error: "你没有权限这样做" };
  if (!okId(reportId) || typeof html !== "string" || typeof text !== "string") return { error: "找不到这一项" };
  try {
    const id = await saveReport(viewer, reportId, toSimplified(text), toSimplified(clean(html)));
    revalidatePath("/finance");
    return id === reportId ? {} : { id };
  } catch (err) {
    return fail(err, "没能保存，请再试一次");
  }
}

/** 另存为新草稿 on a shared report: the same words as a new draft, opened next. */
export async function forkReportAction(reportId: string, html: string | null, text: string) {
  const viewer = await holder("finance");
  if (!viewer) return { error: "你没有权限这样做" };
  if (!okId(reportId)) return { error: "找不到这一项" };
  try {
    const id = await saveReport(viewer, reportId, toSimplified(String(text ?? "")), html ? toSimplified(clean(html)) : null);
    revalidatePath("/finance");
    return { id };
  } catch (err) {
    return fail(err, "没能另存，请再试一次");
  }
}

export async function shareReportDocAction(reportId: string) {
  const viewer = await holder("finance");
  if (!viewer) return { error: "你没有权限这样做" };
  if (!okId(reportId)) return { error: "找不到这一项" };
  try {
    await shareReport(viewer, reportId);
    revalidatePath("/finance");
    revalidatePath(`/finance/reports/${reportId}`);
    return {};
  } catch (err) {
    return fail(err, "没能分享，请再试一次");
  }
}

export async function saveSpendDocAction(requestId: string, html: string, text: string) {
  const viewer = await holder("finance");
  if (!viewer) return { error: "你没有权限这样做" };
  if (!okId(requestId) || typeof html !== "string" || typeof text !== "string") return { error: "找不到这一项" };
  try {
    await writeSpendDescription(viewer, requestId, toSimplified(text), toSimplified(clean(html)));
    revalidatePath("/finance");
    return {};
  } catch (err) {
    return fail(err, "没能保存，请再试一次");
  }
}

export async function renameSpendAction(requestId: string, name: string) {
  const viewer = await holder("finance");
  if (!viewer) return { error: "你没有权限这样做" };
  const title = String(name ?? "").trim().slice(0, 200);
  if (!okId(requestId) || !title) return { error: "请填写用途" };
  try {
    await renameSpend(viewer, requestId, title);
    revalidatePath("/finance");
    return { name: title };
  } catch (err) {
    return fail(err, "没能改名，请再试一次");
  }
}
