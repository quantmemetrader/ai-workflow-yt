import { requireModule } from "@/lib/auth/dal";
import { readHome } from "@/lib/home/service";
import { officeMembers } from "@/lib/home/office";
import { answeringModel } from "@/lib/ai/models";
import { AGENT_KEYS } from "@/lib/agents/catalog";
import { Card, PageBody } from "@/components/projects/kit";
import { TeamBoard, type TeamMember } from "@/components/agents/TeamBoard";
import { OfficeView } from "@/components/office/OfficeView";
import { ViewToggle } from "@/components/office/ViewToggle";
import { OFFICE_KEYS } from "@/components/office/looks";
import type { LookKey } from "@/components/office/art";

export const metadata = { title: "AI 同事" };

/**
 * The AI colleagues' own page. Opens as the office (owner, 2 Oct: "show the
 * AI employees as a pixel office"): everyone at a desk with what they are
 * doing, the roster underneath and 指挥中心 on the right. 列表 keeps the
 * board of cards with 派任务 / 聊天 / 训练.
 */
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ view?: string; pick?: string }> }) {
  const viewer = await requireModule("chat");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const t = (a: string, b: string) => (zh ? a : b);
  const { view, pick } = await searchParams;
  const list = view === "list";
  const home = await readHome(viewer, zh);
  const byKey = new Map(home.agents.map((a) => [a.key, a]));
  const team: TeamMember[] = AGENT_KEYS.map((key) => {
    const a = byKey.get(key);
    return { key, status: a?.status ?? "idle", line: a?.line ?? null, at: a?.at ? a.at.toISOString() : null };
  });
  const working = team.filter((m) => m.status === "working").length;

  const header = (
    <div style={{ padding: "4px 2px 2px", display: "flex", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
      <div style={{ minWidth: 0, flexGrow: 1 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{t("AI 同事", "AI team")}</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13.5, color: "#7c7c7c" }}>
          {list
            ? working
              ? t(`${working} 位正在工作。点「派任务」直接交代，或者和他们聊天。`, `${working} at work. Assign them something, or chat.`)
              : t("点「派任务」直接交代，或者和他们聊天、训练他们。", "Assign them something, chat with them, or train them.")
            : t("点一位同事，在右边直接交代。", "Click a colleague and tell them what you need on the right.")}
        </p>
      </div>
      <ViewToggle view={list ? "list" : "office"} zh={zh} />
    </div>
  );

  if (list) {
    return (
      <PageBody>
        {header}
        <Card icon="spark" title={t("团队", "The team")}>
          <TeamBoard team={team} zh={zh} full />
        </Card>
      </PageBody>
    );
  }

  const members = officeMembers(home, zh);
  const initialPick = OFFICE_KEYS.includes(pick as LookKey) ? (pick as LookKey) : null;

  return <OfficeView members={members} zh={zh} model={answeringModel()} header={header} initialPick={initialPick} />;
}
