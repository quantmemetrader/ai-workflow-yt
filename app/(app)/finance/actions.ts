"use server";

import { revalidatePath } from "next/cache";
import { generateReport, saveReport, shareReport } from "@/lib/finance/reports";
import { getViewer } from "@/lib/auth/dal";
import {
  addActual,
  archiveCentre,
  createCentre,
  decideSpend,
  markSpendPaid,
  raiseSpend,
  removeActual,
  setBudgetLine,
  setThresholds,
} from "@/lib/finance/service";

/** Every action re-reads the viewer and re-checks the module: a server action
 * is a public endpoint whatever the screen around it looked like. */
async function finance() {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("finance")) return null;
  return viewer;
}

const refresh = () => revalidatePath("/finance");
const id = (v: unknown) => (typeof v === "string" && v && v.length <= 64 ? v : null);
const period = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}$/.test(v) ? v : null);

/** Amounts are typed in whole units on screen and stored in millionths. */
function micros(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || Math.abs(n) > 1e12) return null;
  return Math.round(n * 1_000_000);
}

/* -------------------------------------------------------------- reports */

/** Write the period's management report. A model call, so it is awaited rather
 * than optimistic — the screen shows it working. */
export async function generateReportAction(period: string) {
  const viewer = await finance();
  if (!viewer) return { error: "Not allowed" };
  const p = String(period ?? "").trim();
  if (!/^\d{4}-(?:\d{2}|Q[1-4])$/.test(p)) return { error: "That is not a period." };
  try {
    const report = await generateReport(viewer, p);
    refresh();
    return { id: report.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not write that" };
  }
}

/** Edit a draft. Editing something already shared forks it, so what people
 * have read stays what they read. */
export async function saveReportAction(reportId: string, body: string) {
  const viewer = await finance();
  if (!viewer) return { error: "Not allowed" };
  try {
    const id = await saveReport(viewer, String(reportId), String(body ?? ""));
    refresh();
    return { id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save that" };
  }
}

export async function shareReportAction(reportId: string) {
  const viewer = await finance();
  if (!viewer) return { error: "Not allowed" };
  try {
    await shareReport(viewer, String(reportId));
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not share that" };
  }
}

export async function createCentreAction(kind: string, name: string, code: string) {
  const viewer = await finance();
  if (!viewer) return { error: "Not allowed" };
  try {
    await createCentre(viewer, { kind, name: String(name ?? "").slice(0, 120), code: String(code ?? "").slice(0, 32) });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add that" };
  }
}

export async function archiveCentreAction(centreId: string) {
  const viewer = await finance();
  if (!viewer) return { error: "Not allowed" };
  if (!id(centreId)) return { error: "Not found" };
  try {
    await archiveCentre(viewer, centreId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not archive that" };
  }
}

export async function setBudgetLineAction(centreId: string, p: string, amount: number) {
  const viewer = await finance();
  if (!viewer) return { error: "Not allowed" };
  const m = micros(amount);
  if (!id(centreId) || !period(p) || m === null) return { error: "Not allowed" };
  try {
    await setBudgetLine(viewer, centreId, p, m);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save that line" };
  }
}

export async function addActualAction(input: {
  period: string;
  centreId: string | null;
  amount: number;
  description: string;
}) {
  const viewer = await finance();
  if (!viewer) return { error: "Not allowed" };
  const m = micros(input.amount);
  if (!period(input.period) || m === null) return { error: "That is not an amount" };
  try {
    await addActual(viewer, {
      period: input.period,
      centreId: id(input.centreId),
      amountMicros: m,
      description: String(input.description ?? "").slice(0, 500),
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add that" };
  }
}

export async function removeActualAction(actualId: string) {
  const viewer = await finance();
  if (!viewer) return { error: "Not allowed" };
  if (!id(actualId)) return { error: "Not found" };
  try {
    await removeActual(viewer, actualId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not remove that" };
  }
}

export async function raiseSpendAction(input: {
  title: string;
  description: string;
  amount: number;
  centreId: string | null;
  neededBy: string | null;
}) {
  const viewer = await finance();
  if (!viewer) return { error: "Not allowed" };
  const m = micros(input.amount);
  if (m === null || m <= 0) return { error: "An amount is a positive number" };

  let neededBy: Date | null = null;
  if (input.neededBy) {
    const parsed = new Date(input.neededBy);
    if (Number.isNaN(parsed.getTime())) return { error: "That is not a date" };
    neededBy = parsed;
  }

  try {
    await raiseSpend(viewer, {
      title: String(input.title ?? "").slice(0, 200),
      description: String(input.description ?? "").slice(0, 4000),
      amountMicros: m,
      centreId: id(input.centreId),
      neededBy,
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not raise that" };
  }
}

export async function decideSpendAction(requestId: string, decision: string, note: string) {
  const viewer = await finance();
  if (!viewer) return { error: "Not allowed" };
  if (!id(requestId)) return { error: "Not found" };
  if (decision !== "approve" && decision !== "reject") return { error: "Not allowed" };

  try {
    await decideSpend(viewer, requestId, decision, String(note ?? "").slice(0, 1000) || null);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not record that" };
  }
}

export async function markPaidAction(requestId: string, p: string) {
  const viewer = await finance();
  if (!viewer) return { error: "Not allowed" };
  if (!id(requestId) || !period(p)) return { error: "Not allowed" };
  try {
    await markSpendPaid(viewer, requestId, p);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not mark that paid" };
  }
}

export async function setThresholdsAction(autoBelow: number, oneApproverBelow: number) {
  const viewer = await finance();
  if (!viewer) return { error: "Not allowed" };
  const a = Number(autoBelow);
  const b = Number(oneApproverBelow);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { error: "Those are not amounts" };
  try {
    await setThresholds(viewer, { autoBelow: a, oneApproverBelow: b });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save those" };
  }
}
