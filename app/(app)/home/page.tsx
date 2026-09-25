import { requireModule } from "@/lib/auth/dal";
import { HomeScreen } from "@/components/home/HomeScreen";
import { JOB_OWNER, jobName, readHome, roleExtra } from "@/lib/home/service";
import { channelThread, listPeople } from "@/lib/chat/service";
import { agentKeyFromEmail } from "@/lib/agents/catalog";
import { listProjectStages, workProjectDetail } from "@/lib/projects/service";
import { latestDigest } from "@/lib/home/pulse";
import { latestIdeas } from "@/lib/ideas/service";
import { HOME_LAYOUT, homeRoleOf, isHomeRole, layoutHas, projectsInHand } from "@/lib/home/roles";
import { evidenceNumbers, type Evidence } from "@/lib/research/signals";

export const metadata = { title: "首页 · Home" };

/** How many projects are drawn in full (stepper and last words). */
const HUB_SIZE = 6;

/**
 * 首页.
 *
 * The client asked for a screen that shows "what every page and agent is doing
 * at once", and then for it to be the way the work is actually driven rather
 * than a summary of it. `lib/home/service.ts` gathers the state; this passes it
 * through, and everything the screen does goes back out through the chat
 * actions with their own checks.
 *
 * Then for it to be per job: *"the video dev only sees video projects in
 * hand, the research guy only sees research."* The job is `?view=` when the
 * URL names one (the tabs; anybody may look at any job's Home), otherwise the
 * person's own (`homeRoleOf`). It picks a layout (`HOME_LAYOUT`), and this
 * filters to it: the projects in hand for the job, the decisions its
 * employee is waiting on, the jobs on the queue that are its employee's.
 * Projects are still visible to the whole studio — the filter is what Home
 * leads with, and every layout links to all of them.
 *
 * Gated on Chat, because that is where all of it happens.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const viewer = await requireModule("chat");
  const locale = viewer.locale ?? "zh-CN";
  const zh = locale.startsWith("zh");
  const { view } = await searchParams;
  const defaultRole = homeRoleOf(viewer);
  const role = isHomeRole(view) ? view : defaultRole;
  const layout = HOME_LAYOUT[role];
  const agent = role === "overview" ? null : role;

  /* Everything this job's layout draws, and nothing it does not: the ideas,
     the brief and the job's own panel are each a query or two that the
     editor's Home has no use for. */
  const [home, people, stages, ideas, extra, digest] = await Promise.all([
    readHome(viewer, zh, { runningFor: agent }),
    listPeople(viewer),
    listProjectStages(viewer, { limit: 60, zh }),
    layoutHas(layout, "ideas") ? latestIdeas(viewer, 6) : Promise.resolve([]),
    layoutHas(layout, "extra") ? roleExtra(viewer, role) : Promise.resolve(null),
    layoutHas(layout, "suggestion") ? latestDigest(viewer.tenantId) : Promise.resolve(null),
  ]);
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

  /* The projects in hand for this job, from one batched query; the full
     detail (beats, clips, last words) only for the six that are drawn. */
  const inHand = projectsInHand(role, stages);
  const hub = (await Promise.all(inHand.slice(0, HUB_SIZE).map((x) => workProjectDetail(viewer, x.id, zh, 12)))).filter((x): x is NonNullable<typeof x> => x !== null);
  const allActiveCount = stages.filter((p) => p.status === "active").length;

  /* Today's suggested video: the morning brief's signals, or its topic. */
  const suggestions = digest?.signals.length
    ? digest.signals.slice(0, 2).map((sg) => ({
        title: sg.title,
        why: sg.whyNow.replace(/（证据\d+）|\[[A-Z]\d{1,2}\]/g, "").trim() || null,
        hook: sg.hook || null,
        strength: sg.strength || null,
        evidence: sg.evidence.slice(0, 3).map((e) => ({ label: e.source.replace(/（.*?）/, ""), url: e.url, numbers: evidenceNumbers(e as unknown as Evidence).split(" · ")[0] ?? "" })),
      }))
    : digest?.topic
      ? [{ title: digest.topic, why: digest.why, hook: null, strength: null, evidence: [] }]
      : [];

  /* A job's Home shows what its employee is waiting on; the overview, all. */
  const decisions = agent ? home.decisions.filter((d) => d.agent === agent) : home.decisions;
  const running = home.running.map((j) => ({ ...j, label: jobName(j.type, zh), owner: JOB_OWNER[j.type] ?? null }));
  const runningNames = Object.fromEntries(home.running.map((j) => [j.type, jobName(j.type, zh)]));

  /* "设为我的默认" saves a job, or clears it for the overview. Clearing
     only means "the overview" when that is what the studio's rule gives this
     person without a job; for a member whose modules say "editor" it would
     not, so the press is not offered there. */
  const canSetDefault = role !== "overview" || homeRoleOf({ ...viewer, workRole: null }) === "overview";

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
      <HomeScreen
        key={role}
        zh={zh}
        me={(zh && viewer.nameLocal) || viewer.name}
        role={role}
        defaultRole={defaultRole}
        canSetDefault={canSetDefault}
        modules={viewer.modules}
        agents={home.agents}
        decisions={decisions}
        running={running}
        runningNames={runningNames}
        teamChannel={home.teamChannel}
        hub={hub}
        inHandCount={inHand.length}
        allActiveCount={allActiveCount}
        suggestions={suggestions}
        ideas={ideas}
        extra={extra}
        projects={stages.filter((x) => x.status !== "archived").slice(0, 30).map((x) => ({ id: x.id, title: x.title, channelSlug: x.channelSlug }))}
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
