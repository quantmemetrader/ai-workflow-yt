"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import {
  addCandidate,
  addOnboardingTask,
  cancelLeave,
  decideLeave,
  deleteCandidate,
  openRequisition,
  requestLeave,
  saveEmployee,
  seedBalances,
  setEntitlement,
  setRequisitionState,
  setStage,
  setTaskDone,
} from "@/lib/hr/service";

async function hr() {
  const viewer = await getViewer();
  if (!viewer || !viewer.modules.includes("hr")) return null;
  return viewer;
}

const refresh = () => revalidatePath("/hr");
const id = (v: unknown) => (typeof v === "string" && v && v.length <= 64 ? v : null);
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

const STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected", "withdrawn"];

export async function seedBalancesAction(year: number) {
  const viewer = await hr();
  if (!viewer) return { error: "Not allowed" };
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return { error: "That is not a year" };
  try {
    await seedBalances(viewer, y);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not do that" };
  }
}

export async function setEntitlementAction(balanceId: string, days: number) {
  const viewer = await hr();
  if (!viewer) return { error: "Not allowed" };
  if (!id(balanceId)) return { error: "Not found" };
  try {
    await setEntitlement(viewer, balanceId, Number(days));
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save that" };
  }
}

export async function requestLeaveAction(input: {
  kind: string;
  startOn: string;
  endOn: string;
  days: number;
  reason: string;
}) {
  const viewer = await hr();
  if (!viewer) return { error: "Not allowed" };
  const start = day(input.startOn);
  const end = day(input.endOn);
  if (!start || !end) return { error: "Both dates are needed" };

  try {
    await requestLeave(viewer, {
      kind: String(input.kind ?? "annual").slice(0, 40),
      startOn: start,
      endOn: end,
      days: Number(input.days),
      reason: String(input.reason ?? "").slice(0, 1000) || null,
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not request that" };
  }
}

export async function decideLeaveAction(requestId: string, decision: string, note: string) {
  const viewer = await hr();
  if (!viewer) return { error: "Not allowed" };
  if (!id(requestId)) return { error: "Not found" };
  if (decision !== "approved" && decision !== "rejected") return { error: "Not allowed" };
  try {
    await decideLeave(viewer, requestId, decision, String(note ?? "").slice(0, 1000) || null);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not record that" };
  }
}

export async function cancelLeaveAction(requestId: string) {
  const viewer = await hr();
  if (!viewer) return { error: "Not allowed" };
  if (!id(requestId)) return { error: "Not found" };
  try {
    await cancelLeave(viewer, requestId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not cancel that" };
  }
}

export async function openRequisitionAction(input: {
  title: string;
  department: string;
  headcount: number;
  description: string;
}) {
  const viewer = await hr();
  if (!viewer) return { error: "Not allowed" };
  try {
    await openRequisition(viewer, {
      title: String(input.title ?? "").slice(0, 200),
      department: String(input.department ?? "").slice(0, 120) || null,
      headcount: Number(input.headcount) || 1,
      description: String(input.description ?? "").slice(0, 8000),
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not open that" };
  }
}

export async function setRequisitionStateAction(requisitionId: string, state: string) {
  const viewer = await hr();
  if (!viewer) return { error: "Not allowed" };
  if (!id(requisitionId)) return { error: "Not found" };
  if (!["open", "on_hold", "filled", "closed"].includes(state)) return { error: "No such state" };
  try {
    await setRequisitionState(viewer, requisitionId, state);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change that" };
  }
}

export async function addCandidateAction(input: {
  name: string;
  email: string;
  phone: string;
  source: string;
  notes: string;
  consented: boolean;
  retainMonths: number;
  requisitionId: string | null;
}) {
  const viewer = await hr();
  if (!viewer) return { error: "Not allowed" };
  try {
    await addCandidate(viewer, {
      name: String(input.name ?? "").slice(0, 200),
      email: String(input.email ?? "").slice(0, 320) || null,
      phone: String(input.phone ?? "").slice(0, 60) || null,
      source: String(input.source ?? "direct").slice(0, 80),
      notes: String(input.notes ?? "").slice(0, 4000) || null,
      consented: Boolean(input.consented),
      retainMonths: Number(input.retainMonths) || 12,
      requisitionId: id(input.requisitionId),
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add that" };
  }
}

export async function setStageAction(applicationId: string, stage: string) {
  const viewer = await hr();
  if (!viewer) return { error: "Not allowed" };
  if (!id(applicationId)) return { error: "Not found" };
  if (!STAGES.includes(stage)) return { error: "No such stage" };
  try {
    await setStage(viewer, applicationId, stage);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change that" };
  }
}

export async function deleteCandidateAction(candidateId: string) {
  const viewer = await hr();
  if (!viewer) return { error: "Not allowed" };
  if (!id(candidateId)) return { error: "Not found" };
  try {
    await deleteCandidate(viewer, candidateId);
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not delete that" };
  }
}

export async function saveEmployeeAction(
  userId: string,
  input: { jobTitle: string; department: string; startedOn: string; employmentType: string },
) {
  const viewer = await hr();
  if (!viewer) return { error: "Not allowed" };
  if (!id(userId)) return { error: "Not found" };
  try {
    await saveEmployee(viewer, userId, {
      jobTitle: String(input.jobTitle ?? "").slice(0, 160) || null,
      department: String(input.department ?? "").slice(0, 120) || null,
      startedOn: day(input.startedOn),
      employmentType: ["full_time", "part_time", "contract", "intern"].includes(input.employmentType)
        ? input.employmentType
        : "full_time",
    });
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not save that" };
  }
}

export async function addTaskAction(userId: string, label: string, dueOn: string) {
  const viewer = await hr();
  if (!viewer) return { error: "Not allowed" };
  if (!id(userId)) return { error: "Not found" };
  try {
    await addOnboardingTask(viewer, userId, String(label ?? "").slice(0, 200), day(dueOn));
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not add that" };
  }
}

export async function setTaskDoneAction(taskId: string, done: boolean) {
  const viewer = await hr();
  if (!viewer) return { error: "Not allowed" };
  if (!id(taskId)) return { error: "Not found" };
  try {
    await setTaskDone(viewer, taskId, Boolean(done));
    refresh();
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not change that" };
  }
}
