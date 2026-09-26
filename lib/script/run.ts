import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { projectsVisibleTo } from "@/lib/projects/service";
import {
  approvals,
  articles,
  chatChannels,
  chatMessages,
  jobs,
  publishPosts,
  scriptBeats,
  scripts,
  timelineItems,
  topics,
  users,
  videoProjects,
  workProjects,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { isWriting, type ProjectSource } from "@/lib/projects/topic";

/**
 * One script's place in the line of work.
 *
 * The script screen shows the words. This is everything around them that
 * already exists in other tables: the topic it came from, the to-do that
 * asked for it, who wrote each version, who approved it, the project it was
 * handed to and how far the cut has got, and what went out. Read-only, so
 * the panel that draws it can never be the thing that changes a script.
 */
export type ScriptRun = {
  status: "brief" | "drafting" | "awaiting_approval" | "locked" | "archived";
  updatedAt: string;
  /** Touched in the last quarter hour: 编剧 is at it, or somebody is. */
  recent: boolean;
  /**
   * 编剧 is writing a draft into it right now: the project's own mark
   * (`work_projects.source.writing`, younger than ten minutes), the same
   * one `/api/script/[id]/pulse` answers with. "Touched recently" is not
   * the same thing: a person fixing a comma touches it too, and the panel
   * used to say "正在写" for a quarter of an hour after every save.
   */
  writing: boolean;
  /** How many beats the draft has now. */
  beats: number;
  /**
   * What it is about. The script's own backlog topic when it has one, and
   * otherwise the project's: a project started from an idea, a morning-brief
   * signal or a hot-list row carries its topic on the project
   * (`work_projects.topic_id` / `.source`), never on the script, so reading
   * only `scripts.topic_id` said "没有绑定选题" for exactly the scripts that
   * came from a topic. `from` is where the topic was picked ("研究员的选题灵感").
   */
  topic: { name: string; href: string; from: string | null } | null;
  plan: { date: string; text: string; href: string } | null;
  versions: { no: number; by: string | null; at: string; model: string | null; note: string | null }[];
  lockedVersion: number | null;
  approval: { state: "requested" | "approved" | "rejected" | "withdrawn"; by: string | null; at: string | null } | null;
  project: {
    id: string;
    title: string;
    href: string;
    segments: number;
    master: boolean;
    job: { type: string; progress: number } | null;
  } | null;
  post: { state: string; href: string } | null;
  article: { title: string; status: string; href: string } | null;
  sources: number;
};

export async function scriptRun(viewer: Viewer, scriptId: string, zh: boolean): Promise<ScriptRun | null> {
  const tenantId = viewer.tenantId;
  const [script] = await db
    .select({
      id: scripts.id,
      title: scripts.title,
      status: scripts.status,
      topicId: scripts.topicId,
      lockedVersion: scripts.lockedVersion,
      sourceFileIds: scripts.sourceFileIds,
      updatedAt: scripts.updatedAt,
    })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, tenantId), isNull(scripts.deletedAt)))
    .limit(1);
  if (!script) return null;

  /* The project it is the script of: the topic links there, where the
     topic's why and evidence are, rather than to the generic backlog. The
     oldest one, as the pulse and the topic strip pick it, so the three
     never disagree about which project a script belongs to. Read here
     rather than through `projectFor`, which returns only ids and the title,
     because the topic lives in the project's `topic_id` and `source`. */
  const [inProject] = await db
    .select({ id: workProjects.id, title: workProjects.title, topicId: workProjects.topicId, source: workProjects.source })
    .from(workProjects)
    /* Only a project this person may see, as the project bar above the
       script (`projectFor`) and its topic card (`scriptTopic`): the flow
       panel draws its title and a link to it, and a private project's name
       and id are its members'. The script itself is the studio's. */
    .where(and(eq(workProjects.tenantId, tenantId), eq(workProjects.scriptId, scriptId), isNull(workProjects.deletedAt), projectsVisibleTo(viewer)))
    .orderBy(asc(workProjects.createdAt))
    .limit(1);
  const src = (inProject?.source as ProjectSource | null | undefined) ?? null;

  /* A backlog topic by any of the three places one can be recorded: the
     script's own, the project's (an idea's id lands here too, and simply
     matches no `topics` row), and the snapshot's. */
  const topicIds = [script.topicId, inProject?.topicId, src?.topicId].filter((x): x is string => typeof x === "string" && x.length > 0);
  const [topic] = topicIds.length
    ? await db
        .select({ name: topics.name, nameLocal: topics.nameLocal })
        .from(topics)
        .where(and(inArray(topics.id, topicIds), eq(topics.tenantId, tenantId)))
        .limit(1)
    : [];
  /* No backlog row, but the project was started from a picked topic (an
     idea, a signal, a hot-list row, somebody's own pick): its title is the
     topic, and the snapshot says where it was picked. A project with no
     snapshot and no topic id was typed in by hand and has no topic to show. */
  const projectTopic = !topic && inProject && (src || inProject.topicId) ? inProject.title : null;

  const [beatCount] = await db.select({ n: count() }).from(scriptBeats).where(eq(scriptBeats.scriptId, scriptId));

  /* The latest plan, and the to-do in it that names this script. */
  const [plan] = await db
    .select({ meta: chatMessages.meta, slug: chatChannels.slug })
    .from(chatMessages)
    .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
    .where(
      and(
        eq(chatChannels.tenantId, tenantId),
        isNull(chatMessages.deletedAt),
        sql`(${chatMessages.meta} -> 'plan' -> 'list') is not null`,
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);
  type Todo = { text?: unknown; owner?: unknown };
  const planMeta = (plan?.meta as { plan?: { date?: unknown; list?: unknown } } | null)?.plan;
  const key = script.title.replace(/[《》“”"]/g, "").slice(0, 12);
  const todo = (Array.isArray(planMeta?.list) ? (planMeta!.list as Todo[]) : []).find(
    (x) => x.owner === "script" && typeof x.text === "string" && key && x.text.includes(key),
  );

  const versionRows = await db.execute<{ version_no: number; created_at: unknown; model: string | null; note: string | null; name: string | null; name_local: string | null }>(sql`
    select v.version_no, v.created_at, v.model, v.note, u.name, u.name_local
      from script_versions v
      left join ${users} u on u.id = v.author_id
     where v.script_id = ${scriptId}
     order by v.version_no asc
  `);

  const [approval] = await db
    .select({ state: approvals.state, decidedAt: approvals.decidedAt, decidedBy: users.name, decidedByLocal: users.nameLocal })
    .from(approvals)
    .leftJoin(users, eq(users.id, approvals.decidedBy))
    .where(and(eq(approvals.tenantId, tenantId), eq(approvals.objectType, "script"), eq(approvals.objectId, scriptId)))
    .orderBy(desc(approvals.requestedAt))
    .limit(1);

  const [project] = await db
    .select({ id: videoProjects.id, title: videoProjects.title, masterFileId: videoProjects.masterFileId })
    .from(videoProjects)
    .where(and(eq(videoProjects.tenantId, tenantId), eq(videoProjects.scriptId, scriptId), isNull(videoProjects.deletedAt)))
    .orderBy(desc(videoProjects.updatedAt))
    .limit(1);

  const [[segments], [job]] = project
    ? await Promise.all([
        db.select({ n: count() }).from(timelineItems).where(eq(timelineItems.projectId, project.id)),
        db
          .select({ type: jobs.type, progress: jobs.progress })
          .from(jobs)
          .where(
            and(
              eq(jobs.tenantId, tenantId),
              eq(jobs.objectId, project.id),
              inArray(jobs.status, ["queued", "running"]),
              inArray(jobs.type, ["video.autoedit", "video.direct", "video.transcribe", "video.export"]),
            ),
          )
          .orderBy(desc(jobs.createdAt))
          .limit(1),
      ])
    : [[{ n: 0 }], []];

  const [post] = await db
    .select({ state: publishPosts.state })
    .from(publishPosts)
    .where(and(eq(publishPosts.tenantId, tenantId), eq(publishPosts.scriptId, scriptId), isNull(publishPosts.deletedAt)))
    .orderBy(desc(publishPosts.updatedAt))
    .limit(1);

  const [article] = await db
    .select({ id: articles.id, title: articles.title, titleLocal: articles.titleLocal, status: articles.status })
    .from(articles)
    .where(and(eq(articles.tenantId, tenantId), eq(articles.scriptId, scriptId), isNull(articles.deletedAt)))
    .orderBy(desc(articles.updatedAt))
    .limit(1);

  const iso = (v: unknown) => (v instanceof Date ? v : new Date(String(v))).toISOString();

  return {
    status: script.status,
    updatedAt: script.updatedAt.toISOString(),
    recent: Date.now() - script.updatedAt.getTime() < 15 * 60_000,
    writing: isWriting(src, Date.now()),
    beats: beatCount?.n ?? 0,
    topic:
      topic || projectTopic
        ? {
            name: topic ? (zh && topic.nameLocal) || topic.name : (projectTopic as string),
            href: inProject ? `/projects/${inProject.id}` : "/research/backlog",
            from: typeof src?.label === "string" && src.label ? src.label : topic ? (zh ? "选题储备" : "Topic backlog") : null,
          }
        : null,
    plan:
      todo && typeof planMeta?.date === "string"
        ? { date: planMeta.date, text: String(todo.text), href: `/chat/c/${encodeURIComponent(plan!.slug ?? "研究日报")}` }
        : null,
    versions: versionRows.rows.map((v) => ({
      no: v.version_no,
      by: (zh && v.name_local) || v.name,
      at: iso(v.created_at),
      model: v.model,
      note: v.note,
    })),
    lockedVersion: script.lockedVersion,
    approval: approval
      ? { state: approval.state, by: (zh && approval.decidedByLocal) || approval.decidedBy, at: approval.decidedAt?.toISOString() ?? null }
      : null,
    project: project
      ? {
          id: project.id,
          title: project.title,
          href: `/video?project=${project.id}`,
          segments: segments.n,
          master: Boolean(project.masterFileId),
          job: job ? { type: job.type, progress: job.progress } : null,
        }
      : null,
    post: post ? { state: post.state, href: "/publish" } : null,
    article: article ? { title: (zh && article.titleLocal) || article.title, status: article.status, href: `/article/${article.id}` } : null,
    sources: script.sourceFileIds.length,
  };
}
