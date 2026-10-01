import { requireModule } from "@/lib/auth/dal";
import { readHome } from "@/lib/home/service";
import { AGENT_KEYS } from "@/lib/agents/catalog";
import { Card, PageBody } from "@/components/projects/kit";
import { TeamBoard, type TeamMember } from "@/components/agents/TeamBoard";

export const metadata = { title: "AI 同事" };

/**
 * The AI colleagues' own page: every one of them with its face, what it is
 * doing now, and 派任务 / 聊天 / 训练 — and, under them, what each production
 * colleague suggests the studio makes next (their proposal strips).
 */
export default async function TeamPage() {
  const viewer = await requireModule("chat");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const t = (a: string, b: string) => (zh ? a : b);
  const home = await readHome(viewer, zh);
  const byKey = new Map(home.agents.map((a) => [a.key, a]));
  const team: TeamMember[] = AGENT_KEYS.map((key) => {
    const a = byKey.get(key);
    return { key, status: a?.status ?? "idle", line: a?.line ?? null, at: a?.at ? a.at.toISOString() : null };
  });
  const working = team.filter((m) => m.status === "working").length;
  return (
    <PageBody>
      <div style={{ padding: "4px 2px 2px" }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{t("AI 同事", "AI team")}</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "#7c7c7c" }}>
          {working ? t(`${working} 位正在工作。点「派任务」直接交代，或者和他们聊天。`, `${working} at work. Assign them something, or chat.`) : t("点「派任务」直接交代，或者和他们聊天、训练他们。", "Assign them something, chat with them, or train them.")}
        </p>
      </div>
      <Card icon="spark" title={t("团队", "The team")}>
        <TeamBoard team={team} zh={zh} full />
      </Card>

    </PageBody>
  );
}
