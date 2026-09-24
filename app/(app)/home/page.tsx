import { requireModule } from "@/lib/auth/dal";
import { HomeScreen } from "@/components/home/HomeScreen";
import { JOB_OWNER, jobName, readHome } from "@/lib/home/service";
import { channelThread, listPeople } from "@/lib/chat/service";
import { pipelineToday } from "@/lib/home/pipeline";
import { AUTOMATIONS, readAutomations } from "@/lib/automations/service";
import { agentKeyFromEmail } from "@/lib/agents/catalog";

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
  const [home, people, pipeline, autos] = await Promise.all([readHome(viewer, zh), listPeople(viewer), pipelineToday(viewer, zh), readAutomations()]);
  /* The same rows the flow page builds, for the preview of it on this page. */
  const automations = AUTOMATIONS.map((def) => ({ key: def.key, name: def.name, nameEn: def.nameEn, what: def.what, whatEn: def.whatEn, scheduled: def.scheduled, value: autos[def.key] }));
  /* The tail of the team channel: fourteen messages, newest last. Same read the
     channel page does, so what is here is exactly what is there. */
  const tail = home.teamChannel ? await channelThread(viewer, home.teamChannel.slug, 14) : null;
  const thread = (tail?.messages ?? []).map((m) => ({
    id: m.id,
    author: (zh && m.authorNameLocal) || m.authorName || "—",
    agent: m.authorIsAgent ? agentKeyFromEmail(m.authorEmail) : null,
    body: m.body,
    at: m.createdAt.toISOString(),
    actions: m.actions,
    done: m.done,
  }));

  const runningNames = Object.fromEntries(home.running.map((j) => [j.type, jobName(j.type, zh)]));

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
      <HomeScreen
        zh={zh}
        me={(zh && viewer.nameLocal) || viewer.name}
        agents={home.agents}
        decisions={home.decisions}
        running={home.running.map((j) => ({ ...j, label: jobName(j.type, zh), owner: JOB_OWNER[j.type] ?? null }))}
        runningNames={runningNames}
        teamChannel={home.teamChannel}
        pipeline={pipeline}
        automations={automations}
        thread={thread}
        people={people.map((p) => ({
          id: p.id,
          name: (zh && p.nameLocal) || p.name,
          avatarUrl: p.avatarUrl,
          title: p.title,
          email: p.email,
        }))}
      />

      {/* No assistant panel: the task box at the top talks to the team. */}
    </div>
  );
}
