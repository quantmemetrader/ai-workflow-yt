"use server";

import { isProviderModel } from "@/lib/ai/catalog";
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth/dal";
import { MODELS } from "@/lib/ai/models";
import { modelChoice, setModelChoice } from "@/lib/ai/choice";
import { isTrainKey, TRAIN_BUDGET } from "@/lib/agents/train-keys";
import { mayTrain, saveTrainingText, trainingRows } from "@/lib/agents/training";
import { audit } from "@/lib/audit";

/**
 * One AI employee's own model (AI 同事 › 训练), or back to the studio's
 * default with `null`. 编剧 on the writing model while 研究员 stays on the
 * standard one — a choice for one task that does not change it everywhere
 * (29 Sep: "why can't we choose the model for a specific task without
 * changing it in the whole place"). A message can still pick its own.
 */
export async function setAgentModelAction(agent: string, id: string | null): Promise<{ error?: string }> {
  const viewer = await requireViewer();
  if (viewer.role !== "owner" && viewer.role !== "admin") return { error: "只有管理员可以更换模型" };
  if (!isTrainKey(agent)) return { error: "没有这个 AI 同事" };
  if (id !== null && !MODELS.some((m) => m.id === id) && !(await isProviderModel(id))) return { error: "没有这个模型" };
  const current = modelChoice();
  const agents = { ...(current.agents ?? {}) };
  if (id) agents[agent] = id;
  else delete agents[agent];
  await setModelChoice({ ...current, agents }, viewer.id);
  await audit(viewer, "admin.model.agent", { module: "admin", meta: { agent, model: id } });
  revalidatePath(`/train/${agent}`);
  revalidatePath("/team");
  return {};
}

/**
 * 「教它」 under a reply: one standing rule added to that employee's 工作说明
 * (Ryan, 30 Sep: "the AI needs to be adjustable whenever we tell it"). It is
 * the same text as AI 同事 › 训练, with its history, so a rule taught in a
 * chat can be edited or undone there.
 */
export async function teachRuleAction(agent: string, rule: string): Promise<{ error?: string }> {
  const viewer = await requireViewer();
  if (!mayTrain(viewer)) return { error: "访客不能训练 AI 同事" };
  if (!isTrainKey(agent)) return { error: "没有这个 AI 同事" };
  const line = String(rule ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!line) return { error: "写下要它记住的一句话" };
  const rows = await trainingRows(viewer.tenantId, agent);
  const now = (rows.find((r) => r.kind === "instructions")?.body ?? "").trimEnd();
  const next = now ? `${now}\n- ${line}` : `- ${line}`;
  if (next.length > TRAIN_BUDGET.instructions) return { error: "工作说明已经很长了，先去「训练」页整理一下" };
  await saveTrainingText(viewer, agent, "instructions", next, "从对话里教的");
  revalidatePath(`/train/${agent}`);
  return {};
}
