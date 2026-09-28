import { requireModule } from "@/lib/auth/dal";
import { readHome } from "@/lib/home/service";
import { proposalsFor } from "@/lib/agents/proposals";
import { AGENT_KEYS } from "@/lib/agents/catalog";
import { Card, PageBody } from "@/components/projects/kit";
import { TeamBoard, type TeamMember } from "@/components/agents/TeamBoard";
import { ProposalsStrip } from "@/components/agents/ProposalsStrip";

export const metadata = { title: "AI 同事 · AI team" };

/**
 * The AI colleagues' own page: every one of them with its face, what it is
 * doing now, and 派任务 / 聊天 / 训练 — and, under them, what each production
 * colleague suggests the studio makes next (their proposal strips).
 */
export default async function TeamPage() {
  const viewer = await requireModule("chat");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const t = (a: string, b: string) => (zh ? a : b);
  const [home, script, video, article] = await Promise.all([
    readHome(viewer, zh),
    proposalsFor(viewer, "script").catch(() => null),
    proposalsFor(viewer, "video").catch(() => null),
    proposalsFor(viewer, "article").catch(() => null),
  ]);
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
      {script || video || article ? (
        <Card icon="bulb" title={t("他们建议做的", "What they suggest")} sub={t("按一下就交给对应的同事去做", "One press hands it to that colleague")}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {script ? <ProposalsStrip owner="script" items={script.items} planDate={script.planDate} zh={zh} /> : null}
            {video ? <ProposalsStrip owner="video" items={video.items} planDate={video.planDate} zh={zh} /> : null}
            {article ? <ProposalsStrip owner="article" items={article.items} planDate={article.planDate} zh={zh} /> : null}
          </div>
        </Card>
      ) : null}
    </PageBody>
  );
}
