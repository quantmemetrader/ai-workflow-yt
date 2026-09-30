import { notFound } from "next/navigation";
import { AgentLearning } from "@/components/train/AgentLearning";
import { learningState } from "@/lib/agents/learning";
import { requireModule } from "@/lib/auth/dal";
import { isTrainKey, mayTrain, trainingRows } from "@/lib/agents/training";
import { trainName } from "@/components/train/names";
import { TrainAgent } from "@/components/train/TrainAgent";
import { AgentModel } from "@/components/train/AgentModel";
import { MODELS, modelFor } from "@/lib/ai/models";
import { modelChoice } from "@/lib/ai/choice";

export const metadata = { title: "AI 训练 · Train the AI" };

/** One employee's training: its model, its instructions, style list, examples and a try-out. */
export default async function TrainAgentPage({ params }: { params: Promise<{ agent: string }> }) {
  const viewer = await requireModule("chat");
  const { agent } = await params;
  if (!isTrainKey(agent)) notFound();
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const rows = await trainingRows(viewer.tenantId, agent);
  const own = modelChoice().agents?.[agent] ?? null;
  const learning = await learningState(viewer.tenantId, agent);
  const fallback = agent === "script" ? modelFor.drafting() : modelFor.assistant();
  return (
    <TrainAgent
      key={agent}
      agent={agent}
      zh={zh}
      rows={rows}
      canEdit={mayTrain(viewer)}
      model={<>
        <AgentModel agent={agent} name={trainName(agent, zh)} zh={zh} current={own} fallback={fallback} options={MODELS.filter((m) => m.tier !== "free").map((m) => ({ id: m.id, label: m.label }))} canChoose={viewer.role === "owner" || viewer.role === "admin"} />
        <AgentLearning agent={agent} name={trainName(agent, zh)} zh={zh} state={learning} canTrain={mayTrain(viewer)} />
      </>}
    />
  );
}
