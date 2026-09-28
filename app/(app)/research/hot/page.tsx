import { requireModule } from "@/lib/auth/dal";
import { ResearchShell } from "@/components/research/ResearchShell";
import { HotBoard } from "@/components/research/HotBoard";

export const metadata = { title: "热点榜 · Hot now" };

/** 选题 · 热点榜: every platform's hottest posts on the studio's beats, as one list (`HotBoard`). */
export default async function HotPage() {
  const viewer = await requireModule("research");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  return (
    <ResearchShell zh={zh}>
      <HotBoard zh={zh} canWrite={viewer.modules.includes("script")} />
    </ResearchShell>
  );
}
