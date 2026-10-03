import { requireModule } from "@/lib/auth/dal";
import { mayTrain, trainingSummaries } from "@/lib/agents/training";
import { TrainOverview } from "@/components/train/TrainOverview";

export const metadata = { title: "AI 训练" };

/** AI 训练: every AI employee, how much it has been taught, and the way in. */
export default async function TrainPage() {
  const viewer = await requireModule("chat");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const summaries = await trainingSummaries(viewer.tenantId);
  return <TrainOverview zh={zh} summaries={summaries} canTrain={mayTrain(viewer)} />;
}
