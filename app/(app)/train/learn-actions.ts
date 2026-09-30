"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { isTrainKey } from "@/lib/agents/train-keys";
import { mayTrain } from "@/lib/agents/training";
import { decideProposal, recordFeedback, reflect, type FeedbackKind } from "@/lib/agents/learning";

const KINDS: FeedbackKind[] = ["good", "bad", "redo", "reject", "sendback", "taught"];

/** One piece of feedback for an employee; every eighth, it reflects in the background. */
export async function feedbackAction(agent: string, kind: string, text?: string, context?: string): Promise<{ error?: string }> {
  const viewer = await getViewer();
  if (!viewer || viewer.role === "guest") return { error: "Not allowed" };
  if (!isTrainKey(agent) || !KINDS.includes(kind as FeedbackKind)) return { error: "Not allowed" };
  const due = await recordFeedback(viewer, agent, { kind: kind as FeedbackKind, text: text ?? "", context: context ?? "" });
  if (due) after(async () => {
    try {
      await reflect(viewer, agent);
    } catch (err) {
      console.error("[learn] reflect failed", err);
    }
  });
  return {};
}

/** 「现在总结一次」 on the training page. */
export async function reflectNowAction(agent: string): Promise<{ added?: number; error?: string }> {
  const viewer = await getViewer();
  if (!viewer || !mayTrain(viewer) || !isTrainKey(agent)) return { error: "Not allowed" };
  try {
    const res = await reflect(viewer, agent);
    revalidatePath(`/train/${agent}`);
    return res;
  } catch (err) {
    return { error: err instanceof Error ? err.message : "没总结出来" };
  }
}

export async function decideProposalAction(agent: string, id: string, adopt: boolean): Promise<{ error?: string }> {
  const viewer = await getViewer();
  if (!viewer || !mayTrain(viewer) || !isTrainKey(agent) || typeof id !== "string") return { error: "Not allowed" };
  const res = await decideProposal(viewer, agent, id, adopt);
  revalidatePath(`/train/${agent}`);
  return res;
}
