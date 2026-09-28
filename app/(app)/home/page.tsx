import { requireModule } from "@/lib/auth/dal";
import { HomeToday } from "@/components/home/HomeToday";
import { readToday } from "@/lib/home/today";
import { readHome } from "@/lib/home/service";
import { AGENT_KEYS } from "@/lib/agents/catalog";
import { Card } from "@/components/projects/kit";
import { TeamBoard, type TeamMember } from "@/components/agents/TeamBoard";

export const metadata = { title: "首页 · Home" };

/**
 * 首页: what is waiting on you, the AI colleagues (faces, what each is doing,
 * 派任务), a box to start a new video, the videos under way. Rebuilt on 28 Sep for people who are not technical — the role tabs,
 * suggestion strips, idea lists, chat feed, colleagues and job queue that
 * used to share this page each have their own page now (选题, 消息, AI 员工).
 */
export default async function HomePage() {
  const viewer = await requireModule("chat");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const [today, home] = await Promise.all([readToday(viewer, zh), readHome(viewer, zh)]);
  /* The AI colleagues, in plain sight: faces, what each is doing, 派任务. */
  const byKey = new Map(home.agents.map((a) => [a.key, a]));
  const team: TeamMember[] = AGENT_KEYS.map((key) => {
    const a = byKey.get(key);
    return { key, status: a?.status ?? "idle", line: a?.line ?? null, at: a?.at ? a.at.toISOString() : null };
  });
  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", background: "#f6f5f2" }}>
      <HomeToday
        zh={zh}
        me={(zh && viewer.nameLocal) || viewer.name}
        greeting={greeting(zh)}
        today={today}
        team={
          <Card icon="spark" title={zh ? "AI 同事" : "AI team"} right={<a href="/team" style={{ fontSize: 12.5, color: "#525252", textDecoration: "none" }}>{zh ? "全部同事 →" : "The whole team →"}</a>}>
            <TeamBoard team={team} zh={zh} />
          </Card>
        }
      />
    </div>
  );
}

function greeting(zh: boolean): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "2-digit", hour12: false }).format(new Date()));
  if (zh) return hour < 11 ? "早上好" : hour < 18 ? "下午好" : "晚上好";
  return hour < 11 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}
