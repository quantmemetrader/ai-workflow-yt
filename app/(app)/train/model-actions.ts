"use server";

import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth/dal";
import { MODELS } from "@/lib/ai/models";
import { modelChoice, setModelChoice } from "@/lib/ai/choice";
import { isTrainKey } from "@/lib/agents/train-keys";
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
  if (id !== null && !MODELS.some((m) => m.id === id)) return { error: "没有这个模型" };
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
