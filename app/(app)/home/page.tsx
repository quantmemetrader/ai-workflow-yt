import { requireModule } from "@/lib/auth/dal";
import { HomeScreen } from "@/components/home/HomeScreen";
import { jobName, readHome } from "@/lib/home/service";
import { listPeople } from "@/lib/chat/service";
import { AgentDock } from "@/components/shell/AgentDock";
import { answeringModel } from "@/lib/ai/models";

export const metadata = { title: "首页 · Home" };

/**
 * 首页.
 *
 * The client asked for a screen that shows "what every page and agent is doing
 * at once", and then for it to be the way the work is actually driven rather
 * than a summary of it. `lib/home/service.ts` gathers the state; this passes it
 * through, and everything the screen does goes back out through the chat
 * actions with their own checks.
 *
 * Gated on Chat, because that is where all of it happens.
 */
export default async function HomePage() {
  const viewer = await requireModule("chat");
  const locale = viewer.locale ?? "zh-CN";
  const zh = locale.startsWith("zh");
  const [home, people] = await Promise.all([readHome(viewer, zh), listPeople(viewer)]);

  const runningNames = Object.fromEntries(home.running.map((j) => [j.type, jobName(j.type, zh)]));

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
      <HomeScreen
        zh={zh}
        me={(zh && viewer.nameLocal) || viewer.name}
        agents={home.agents}
        decisions={home.decisions}
        running={home.running.map((j) => ({ ...j, label: jobName(j.type, zh) }))}
        runningNames={runningNames}
        teamChannel={home.teamChannel}
        people={people.map((p) => ({
          id: p.id,
          name: (zh && p.nameLocal) || p.name,
          avatarUrl: p.avatarUrl,
          title: p.title,
          email: p.email,
        }))}
      />

      {/* The assistant, as on every other screen: it acts as you, and the AI
          employees on the page act as themselves. */}
      <AgentDock
        zh={zh}
        model={answeringModel()}
        context={{ module: "chat" }}
        scope={zh ? "今天" : "Today"}
        note={
          zh
            ? "可以问它今天该做什么、某条片到哪一步了。它以你的身份行动。要叫 AI 员工，在上面的输入框里 @ 它们。"
            : "Ask what today looks like, or where a cut has got to. It acts as you. To bring in an AI employee, @ them in the box above."
        }
        placeholder={zh ? "问问今天…" : "Ask about today…"}
      />
    </div>
  );
}
