import "server-only";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  approvals,
  articles,
  chatChannels,
  chatMessages,
  jobs,
  publishPosts,
  scripts,
  timelineItems,
  topics,
  users,
  videoProjects,
  workProjects,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";

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
  topic: { name: string; href: string } | null;
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

  const [topic] = script.topicId
    ? await db
        .select({ name: topics.name, nameLocal: topics.nameLocal })
        .from(topics)
        .where(and(eq(topics.id, script.topicId), eq(topics.tenantId, tenantId)))
        .limit(1)
    : [];

  /* The project it is the script of: the topic links there, where the
     topic's why and evidence are, rather than to the generic backlog. */
  const [inProject] = await db
    .select({ id: workProjects.id })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, tenantId), eq(workProjects.scriptId, scriptId), isNull(workProjects.deletedAt)))
    .limit(1);

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
    topic: topic ? { name: (zh && topic.nameLocal) || topic.name, href: inProject ? `/projects/${inProject.id}` : "/research/backlog" } : null,
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
