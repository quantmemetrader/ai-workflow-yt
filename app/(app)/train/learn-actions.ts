"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/dal";
import { isTrainKey } from "@/lib/agents/train-keys";
import { mayTrain } from "@/lib/agents/training";
import { decideProposal, recordFeedback, reflect, type FeedbackKind } from "@/lib/agents/learning";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentMessages, conversations } from "@/lib/db/schema";

const KINDS: FeedbackKind[] = ["good", "bad", "redo", "reject", "sendback", "taught"];

/** One piece of feedback for an employee; every eighth, it reflects in the background. */
export async function feedbackAction(agent: string, kind: string, text?: string, context?: string, messageId?: string): Promise<{ error?: string }> {
  const viewer = await getViewer();
  if (!viewer || viewer.role === "guest") return { error: "Not allowed" };
  /* A rated reply is credited to whoever is stored as having written it, not
     to the employee the screen guessed: 撰稿人 was being taught from a
     complaint about the assistant's answer (QA, 3 Oct). Only the person's own
     conversations are looked at. */
  if (typeof messageId === "string" && messageId && messageId.length < 64) {
    const [row] = await db
      .select({ speaker: agentMessages.speaker, role: agentMessages.role })
      .from(agentMessages)
      .innerJoin(conversations, eq(conversations.id, agentMessages.conversationId))
      .where(and(eq(agentMessages.id, messageId), eq(conversations.userId, viewer.id)))
      .limit(1);
    if (row?.role === "assistant") agent = row.speaker ?? "assistant";
  }
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
