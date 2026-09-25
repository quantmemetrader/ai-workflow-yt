import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { scripts, topics, users, workProjects } from "@/lib/db/schema";
import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import { ResearchSidebar } from "@/components/canvas/ResearchSidebar";
import { BacklogView } from "@/components/research/BacklogView";
import { connectedSources, decisionCount } from "@/lib/research/service";
import { openCommentCount } from "@/lib/social/service";

export const metadata = { title: "选题储备 · Backlog" };

/** Adopted topics, with owner, target channel and due date — what Script needs
 * before it can start (brief §4.3, Topic backlog). */
const CHANNELS = ["YouTube", "Instagram", "TikTok", "LinkedIn", "WeChat", "Xiaohongshu"];

export default async function BacklogPage() {
  const viewer = await requireModule("research");
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");

  const [rows, people, sources, decisions, open] = await Promise.all([
    db
      .select({ topic: topics, ownerName: users.name, ownerNameLocal: users.nameLocal })
      .from(topics)
      .leftJoin(users, eq(users.id, topics.ownerId))
      .where(and(eq(topics.tenantId, viewer.tenantId), inArray(topics.status, ["adopted", "saved"])))
      .orderBy(topics.dueDate),
    db
      .select({ id: users.id, name: users.name, nameLocal: users.nameLocal })
      .from(users)
      .where(and(eq(users.tenantId, viewer.tenantId), eq(users.isAgent, false)))
      .orderBy(users.name),
    connectedSources(),
    decisionCount(viewer),
    openCommentCount(viewer),
  ]);

  /* Where each topic has got to in Script: its project and its script, so a
     card can open them rather than only say "Scripting". A topic's project
     is the one started from it (`work_projects.topic_id`), else the one
     whose script was written from it (an idea kept here and then started
     from Home); its script is the one written from it (`scripts.topic_id`),
     else the project's. */
  const ids = rows.map((r) => r.topic.id);
  const [projects, written] = ids.length
    ? await Promise.all([
        db
          .select({ id: workProjects.id, topicId: workProjects.topicId, scriptId: workProjects.scriptId })
          .from(workProjects)
          .where(and(eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), inArray(workProjects.topicId, ids)))
          .orderBy(workProjects.createdAt),
        db
          .select({
            id: scripts.id,
            topicId: scripts.topicId,
            status: scripts.status,
            beats: sql<number>`(select count(*)::int from script_beats b where b.script_id = "scripts"."id")`,
            projectId: sql<string | null>`(select p.id from work_projects p where p.script_id = "scripts"."id" and p.tenant_id = "scripts"."tenant_id" and p.deleted_at is null order by p.created_at limit 1)`,
          })
          .from(scripts)
          .where(and(eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt), inArray(scripts.topicId, ids)))
          .orderBy(scripts.createdAt),
      ])
    : [[], []];
  const projectOf = new Map<string, { id: string; scriptId: string | null }>();
  for (const p of projects) if (p.topicId && !projectOf.has(p.topicId)) projectOf.set(p.topicId, { id: p.id, scriptId: p.scriptId });
  const scriptOf = new Map<string, { id: string; status: string; beats: number }>();
  for (const sc of written) {
    if (!sc.topicId || scriptOf.has(sc.topicId)) continue;
    scriptOf.set(sc.topicId, { id: sc.id, status: sc.status, beats: Number(sc.beats) });
    if (sc.projectId && !projectOf.has(sc.topicId)) projectOf.set(sc.topicId, { id: sc.projectId, scriptId: sc.id });
  }

  return (
    <>
      <ResearchSidebar
        locale={viewer.locale ?? "zh-CN"}
        decisionCount={decisions}
        inboxCount={open}
        backlogCount={rows.length}
        sources={sources.map((s) => ({
          key: s.key,
          name: s.name,
          kind: s.kind,
          status: s.status,
          note: s.note ?? s.lastError,
        }))}
      />
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
    </>
  );
}
