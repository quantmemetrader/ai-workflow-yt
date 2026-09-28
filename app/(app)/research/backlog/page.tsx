import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scripts, topics, users, workProjects } from "@/lib/db/schema";
import { requireModule } from "@/lib/auth/dal";
import { projectsVisibleTo } from "@/lib/projects/service";
import { answeringModel } from "@/lib/ai/models";
import { ResearchShell } from "@/components/research/ResearchShell";
import { SavedBoard } from "@/components/research/SavedBoard";
import { rankedTopics } from "@/lib/research/service";
import { listCompetitors, ourMedianViews } from "@/lib/social/service";
import { creatorMemoryState } from "@/lib/creator/service";
import { env } from "@/lib/env";
import { jobs } from "@/lib/db/schema";
import { BacklogView } from "@/components/research/BacklogView";

export const metadata = { title: "我的储备 · Saved topics" };

/** Adopted topics, with owner, target channel and due date — what Script needs
 * before it can start (brief §4.3, Topic backlog). */
const CHANNELS = ["YouTube", "Instagram", "TikTok", "LinkedIn", "WeChat", "Xiaohongshu"];

export default async function BacklogPage({ searchParams }: { searchParams: Promise<{ board?: string }> }) {
  const viewer = await requireModule("research");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const board = (await searchParams).board === "1";

  const [rows, people, watched, competitors, ourMedian, creator, syncJobs] = await Promise.all([
    db
      .select({ topic: topics, ownerName: users.name, ownerNameLocal: users.nameLocal, ownerAvatar: users.avatarUrl })
      .from(topics)
      .leftJoin(users, eq(users.id, topics.ownerId))
      .where(and(eq(topics.tenantId, viewer.tenantId), inArray(topics.status, ["adopted", "saved"])))
      .orderBy(topics.dueDate),
    db
      .select({ id: users.id, name: users.name, nameLocal: users.nameLocal })
      .from(users)
      .where(and(eq(users.tenantId, viewer.tenantId), eq(users.isAgent, false)))
      .orderBy(users.name),
    /* The words being followed (a topic that is neither kept nor dropped). */
    rankedTopics(viewer, { statuses: ["new"], limit: 40 }),
    listCompetitors(viewer),
    ourMedianViews(viewer),
    creatorMemoryState(viewer.tenantId),
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.tenantId, viewer.tenantId), eq(jobs.type, "creator.sync"), inArray(jobs.status, ["queued", "running"])))
      .limit(1),
  ]);

  /* Where each topic has got to in Script: its project and its script, so a
     card can open them rather than only say "Scripting". A topic's project
     is the one started from it (`work_projects.topic_id`), else the one
     whose script was written from it (an idea kept here and then started
     from Home); its script is the one written from it (`scripts.topic_id`),
     else the project's.

     Only projects this researcher may see (`projectsVisibleTo`, the rule of
     the project page itself). A teammate's private project used to show as
     "项目 →" here and 404 on the click, and handed its id and its script's
     to everyone with Research. */
  const ids = rows.map((r) => r.topic.id);
  const [projects, written, writtenProjects] = ids.length
    ? await Promise.all([
        db
          .select({ id: workProjects.id, topicId: workProjects.topicId, scriptId: workProjects.scriptId })
          .from(workProjects)
          .where(and(eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), inArray(workProjects.topicId, ids), projectsVisibleTo(viewer)))
          .orderBy(workProjects.createdAt),
        db
          .select({
            id: scripts.id,
            topicId: scripts.topicId,
            status: scripts.status,
            beats: sql<number>`(select count(*)::int from script_beats b where b.script_id = "scripts"."id")`,
          })
          .from(scripts)
          .where(and(eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt), inArray(scripts.topicId, ids)))
          .orderBy(scripts.createdAt),
        /* The projects those scripts belong to, oldest first, by the same
           rule. A join rather than a subquery per script, so the rule is
           written once and not re-spelled against an alias. */
        db
          .select({ id: workProjects.id, scriptId: workProjects.scriptId })
          .from(workProjects)
          .innerJoin(scripts, eq(scripts.id, workProjects.scriptId))
          .where(
            and(
              eq(workProjects.tenantId, viewer.tenantId),
              isNull(workProjects.deletedAt),
              eq(scripts.tenantId, viewer.tenantId),
              isNull(scripts.deletedAt),
              inArray(scripts.topicId, ids),
              projectsVisibleTo(viewer),
            ),
          )
          .orderBy(workProjects.createdAt),
      ])
    : [[], [], []];
  const projectOfScript = new Map<string, string>();
  for (const p of writtenProjects) if (p.scriptId && !projectOfScript.has(p.scriptId)) projectOfScript.set(p.scriptId, p.id);
  const projectOf = new Map<string, { id: string; scriptId: string | null }>();
  for (const p of projects) if (p.topicId && !projectOf.has(p.topicId)) projectOf.set(p.topicId, { id: p.id, scriptId: p.scriptId });
  const scriptOf = new Map<string, { id: string; status: string; beats: number }>();
  for (const sc of written) {
    if (!sc.topicId || scriptOf.has(sc.topicId)) continue;
    scriptOf.set(sc.topicId, { id: sc.id, status: sc.status, beats: Number(sc.beats) });
    const projectId = projectOfScript.get(sc.id);
    if (projectId && !projectOf.has(sc.topicId)) projectOf.set(sc.topicId, { id: projectId, scriptId: sc.id });
  }

  if (board) {
    return (
      <ResearchShell zh={zh} savedCount={rows.length}>
      <BacklogView
      locale={viewer.locale ?? "zh-CN"}
      region="HK / TW / SG"
      model={answeringModel()}
      canWriteScripts={viewer.modules.includes("script")}
      channels={CHANNELS}
      people={people.map((p) => ({ id: p.id, name: (zh && p.nameLocal) || p.name }))}
      items={rows.map((r) => ({
        id: r.topic.id,
        name: (zh && r.topic.nameLocal) || r.topic.name,
        category: r.topic.category,
        summary: r.topic.summary,
        ownerName: (zh && r.ownerNameLocal) || r.ownerName,
        ownerId: r.topic.ownerId,
        ownerAvatar: r.ownerAvatar,
        targetChannel: r.topic.targetChannel,
        dueDate: r.topic.dueDate,
        heat: r.topic.heat,
        change: r.topic.change14d,
        adoptedAt: r.topic.updatedAt.toISOString(),
        stage: r.topic.stage,
        flagged: r.topic.flagged,
        flagReason: r.topic.flagReason,
        projectId: projectOf.get(r.topic.id)?.id ?? null,
        scriptId: scriptOf.get(r.topic.id)?.id ?? projectOf.get(r.topic.id)?.scriptId ?? null,
        scriptStatus: scriptOf.get(r.topic.id)?.status ?? null,
        beats: scriptOf.get(r.topic.id)?.beats ?? 0,
      }))}
      />
      </ResearchShell>
    );
  }
  return (
    <ResearchShell zh={zh} savedCount={rows.length}>
      <SavedBoard
        zh={zh}
        canWrite={viewer.modules.includes("script")}
        saved={rows.map((r) => ({
          id: r.topic.id,
          name: (zh && r.topic.nameLocal) || r.topic.name,
          summary: r.topic.summary,
          heat: r.topic.heat,
          change: r.topic.change14d,
          projectId: projectOf.get(r.topic.id)?.id ?? null,
          scriptId: scriptOf.get(r.topic.id)?.id ?? projectOf.get(r.topic.id)?.scriptId ?? null,
        }))}
        watched={watched.map((t) => ({ id: t.id, name: (zh && t.nameLocal) || t.name, heat: t.heat, change: t.change14d, rising: t.rising, collecting: t.collecting }))}
        competitors={competitors}
        ourMedian={ourMedian}
        tikhubConfigured={env.tikhub.configured}
        creator={creator}
        creatorSyncing={syncJobs.length > 0}
        canAdmin={viewer.modules.includes("admin")}
      />
    </ResearchShell>
  );
}
