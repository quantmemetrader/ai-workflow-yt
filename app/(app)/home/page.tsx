import { requireModule } from "@/lib/auth/dal";
import { HomeScreen } from "@/components/home/HomeScreen";
import { JOB_OWNER, jobName, readHome } from "@/lib/home/service";
import { channelThread, listPeople } from "@/lib/chat/service";
import { pipelineToday } from "@/lib/home/pipeline";
import { agentKeyFromEmail, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import { and, desc, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { videoExports, videoProjects } from "@/lib/db/schema";

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
  const [home, people, pipeline, recentProject] = await Promise.all([readHome(viewer, zh), listPeople(viewer), pipelineToday(viewer, zh), latestProject(viewer.tenantId)]);
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
        focus={focusOf(thread, (zh && viewer.nameLocal) || viewer.name)}
        recentProject={recentProject}
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

/**
 * The exchange a person is in the middle of with one employee: their last
 * message that tagged somebody, and everything since, if it is under an
 * hour old. Home shows it as the thing being worked on.
 */
function focusOf(thread: { id: string; author: string; agent: AgentKey | null; body: string; at: string }[], me: string): { agent: AgentKey; fromId: string } | null {
  for (let i = thread.length - 1; i >= 0; i--) {
    const m = thread[i];
    if (m.agent || m.author !== me) continue;
    const tagged = parseAgentMentions(m.body);
    if (!tagged.length) continue;
    /* The request itself must be recent: an old one with fresh chatter
       after it is not what the person is working on now. */
    if (Date.now() - new Date(m.at).getTime() > 60 * 60_000) return null;
    return { agent: tagged[0], fromId: m.id };
  }
  return null;
}

/** The video project touched most recently, and its newest finished render,
 *  for "open what 剪辑师 made" and a player right on Home. */
async function latestProject(tenantId: string): Promise<{ id: string; title: string; render: { fileId: string; at: string } | null } | null> {
  const [row] = await db
    .select({ id: videoProjects.id, title: videoProjects.title })
    .from(videoProjects)
    .where(and(eq(videoProjects.tenantId, tenantId), isNull(videoProjects.deletedAt), gte(videoProjects.updatedAt, new Date(Date.now() - 2 * 60 * 60_000))))
    .orderBy(desc(videoProjects.updatedAt))
    .limit(1);
  if (!row) return null;
  const [done] = await db
    .select({ fileId: videoExports.fileId, at: videoExports.finishedAt })
    .from(videoExports)
    .where(and(eq(videoExports.projectId, row.id), eq(videoExports.state, "done")))
    .orderBy(desc(videoExports.finishedAt))
    .limit(1);
  return { ...row, render: done?.fileId ? { fileId: done.fileId, at: (done.at ?? new Date()).toISOString() } : null };
}
