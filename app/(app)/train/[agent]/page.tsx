import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { isTrainKey, mayTrain, trainingRows } from "@/lib/agents/training";
import { TrainAgent } from "@/components/train/TrainAgent";

export const metadata = { title: "AI 训练 · Train the AI" };

/** One employee's training: its instructions, style list, examples and a try-out. */
export default async function TrainAgentPage({ params }: { params: Promise<{ agent: string }> }) {
  const viewer = await requireModule("chat");
  const { agent } = await params;
  if (!isTrainKey(agent)) notFound();
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const rows = await trainingRows(viewer.tenantId, agent);
  return <TrainAgent key={agent} agent={agent} zh={zh} rows={rows} canEdit={mayTrain(viewer)} />;
}
