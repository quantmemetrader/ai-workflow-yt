import "server-only";
import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  approvals,
  chatChannels,
  chatMessages,
  comments,
  hotSnapshots,
  jobs,
  publishPosts,
  scripts,
  timelineItems,
  videoProjects,
} from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import type { AgentKey } from "@/lib/agents/catalog";

/**
 * Where today's video is, step by step.
 *
 * The client's picture of the product is one line of work: 研究员 finds the
 * topic, 策划 plans it, 编剧 writes it, a person approves it, 剪辑师 cuts it,
 * 撰稿人 posts it, and the numbers come back to 研究员. Every one of those
 * steps already leaves a record — a message with a date in its meta, a script
 * row, an approval, a project, a job, a post, a comment. This reads them back
 * in that order and says, for each step, whether it is done, running, waiting
 * on a person, or not started.
 *
 * Nothing here is a state machine of its own. If a step reads wrong, the fix
 * is in the table it reads, not in a second copy of the truth kept here.
 */
export type StageKey = "topic" | "plan" | "script" | "approve" | "cut" | "export" | "publish" | "feedback";
export type StageState = "done" | "running" | "you" | "todo";

export type Stage = {
  key: StageKey;
  n: number;
  owner: AgentKey | "you";
  state: StageState;
  /** One short line under the owner: "08:00 已完成", "进行中 62%", "等上一步". */
  line: string;
  /** Where to go to see or do it. */
  href: string | null;
  /** 0..1 while running, when the job reports one. */
  progress: number | null;
};

export type Pipeline = {
  /** The piece of work these steps are about, when there is one. */
  title: string | null;
  scriptId: string | null;
  projectId: string | null;
  stages: Stage[];
  /** When the hot lists were last collected from every platform. */
  collectedAt: string | null;
};

const HK = "Asia/Hong_Kong";
const RESEARCH_CHANNEL = "研究日报";
const RECENT_DAYS = 3;

function hkDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: HK, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
function hkTime(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: HK, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
}

export async function pipelineToday(viewer: Viewer, zh: boolean): Promise<Pipeline> {
  const tenantId = viewer.tenantId;
  const today = hkDate();
  const t = (a: string, b: string) => (zh ? a : b);
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);

  /* ---- 1 · 2  the morning posts, by the date they carry ---------------- */
  const posted = await db
    .select({ body: chatMessages.body, meta: chatMessages.meta, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
    .where(
      and(
        eq(chatChannels.tenantId, tenantId),
        isNull(chatMessages.deletedAt),
        sql`((${chatMessages.meta} -> 'digest' ->> 'date') is not null or (${chatMessages.meta} -> 'plan' ->> 'date') is not null)`,
        gte(chatMessages.createdAt, since),
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(12);

  type Meta = { digest?: { date?: unknown }; plan?: { date?: unknown; list?: unknown } };
  const digest = posted.find((m) => typeof (m.meta as Meta | null)?.digest?.date === "string") ?? null;
  const plan = posted.find((m) => typeof (m.meta as Meta | null)?.plan?.date === "string") ?? null;
  const digestToday = digest !== null && String((digest.meta as Meta).digest!.date).startsWith(today);
  const planToday = plan !== null && String((plan.meta as Meta).plan!.date).startsWith(today);
  const planList = (plan?.meta as Meta | null)?.plan?.list;
  const todoCount = Array.isArray(planList) ? planList.length : 0;
  const digestTopic = digest ? (digest.body.match(/\*\*今天讨论[：:]\s*(.+?)\*\*/)?.[1]?.trim() ?? null) : null;

  const research = `/chat/c/${encodeURIComponent(RESEARCH_CHANNEL)}`;

  /*
   * The line starts from today's topic.
   *
   * Everything after step 2 is about the piece today's brief chose, so it
   * only counts work started after that brief was posted. Before the brief,
   * yesterday's half-finished script is not "today's video", and showing it
   * as the current step told the studio the line was further on than it is.
   */
  const workSince = digestToday ? digest!.createdAt : null;

  /* ---- 3 · 4  the script and its approval ------------------------------ */
  const [script] = !workSince ? [] : await db
    .select({
      id: scripts.id,
      title: scripts.title,
      titleLocal: scripts.titleLocal,
      status: scripts.status,
      version: scripts.version,
      lockedVersion: scripts.lockedVersion,
      updatedAt: scripts.updatedAt,
    })
    .from(scripts)
    .where(and(eq(scripts.tenantId, tenantId), isNull(scripts.deletedAt), gte(scripts.createdAt, workSince)))
    .orderBy(desc(scripts.updatedAt))
    .limit(1);

  const [approval] = script
    ? await db
        .select({ state: approvals.state, decidedAt: approvals.decidedAt, requestedAt: approvals.requestedAt })
        .from(approvals)
        .where(and(eq(approvals.tenantId, tenantId), eq(approvals.objectType, "script"), eq(approvals.objectId, script.id)))
        .orderBy(desc(approvals.requestedAt))
        .limit(1)
    : [];

  /* ---- 5 · 6  the project, its timeline, and the jobs on it ------------ */
  const [project] = !workSince ? [] : await db
    .select({ id: videoProjects.id, title: videoProjects.title, masterFileId: videoProjects.masterFileId, updatedAt: videoProjects.updatedAt })
    .from(videoProjects)
    .where(
      and(
        eq(videoProjects.tenantId, tenantId),
        isNull(videoProjects.deletedAt),
        script ? eq(videoProjects.scriptId, script.id) : gte(videoProjects.createdAt, workSince),
      ),
    )
    .orderBy(desc(videoProjects.updatedAt))
    .limit(1);

  const [[timeline], live] = project
    ? await Promise.all([
        db.select({ n: count() }).from(timelineItems).where(eq(timelineItems.projectId, project.id)),
        db
          .select({ type: jobs.type, status: jobs.status, progress: jobs.progress, objectId: jobs.objectId })
          .from(jobs)
          .where(
            and(
              eq(jobs.tenantId, tenantId),
              inArray(jobs.status, ["queued", "running"]),
              inArray(jobs.type, ["video.autoedit", "video.direct", "video.transcribe", "video.export"]),
            ),
          )
          .orderBy(desc(jobs.createdAt))
          .limit(6),
      ])
    : [[{ n: 0 }], []];
  const onProject = (j: { objectId: string | null }) => !project || !j.objectId || j.objectId === project.id;
  const cutting = live.find((j) => j.type !== "video.export" && onProject(j)) ?? null;
  const exporting = live.find((j) => j.type === "video.export" && onProject(j)) ?? null;

  /* ---- 7 · 8  the post, and what came back ----------------------------- */
  const [post] = script
    ? await db
        .select({ id: publishPosts.id, state: publishPosts.state, updatedAt: publishPosts.updatedAt })
        .from(publishPosts)
        .where(and(eq(publishPosts.tenantId, tenantId), eq(publishPosts.scriptId, script.id), isNull(publishPosts.deletedAt)))
        .orderBy(desc(publishPosts.updatedAt))
        .limit(1)
    : [];
  const published = post?.state === "published";
  const [heard] = published
    ? await db
        .select({ n: count() })
        .from(comments)
        .where(and(eq(comments.tenantId, tenantId), gte(comments.postedAt, post!.updatedAt)))
    : [{ n: 0 }];

  /* ---- and the line of work, in order ---------------------------------- */
  const stages: Stage[] = [];
  const push = (s: Omit<Stage, "n">) => stages.push({ ...s, n: stages.length + 1 });
  const waits = t("等上一步", "waiting");

  push({
    key: "topic",
    owner: "research",
    state: digestToday ? "done" : "todo",
    line: digestToday ? `${hkTime(digest!.createdAt)} ${t("已完成", "done")}` : digest ? t("今天还没发", "not yet today") : t("每天 08:00", "daily 08:00"),
    href: research,
    progress: null,
  });
  push({
    key: "plan",
    owner: "planning",
    state: planToday ? "done" : "todo",
    line: planToday
      ? `${hkTime(plan!.createdAt)} · ${todoCount} ${t("条待办", "to-dos")}`
      : digestToday
        ? t("晨报之后", "after the brief")
        : waits,
    href: research,
    progress: null,
  });

  const scriptHref = script ? `/script/${script.id}` : "/script";
  const recent = script ? Date.now() - new Date(script.updatedAt).getTime() < 15 * 60_000 : false;
  if (!script) {
    push({ key: "script", owner: "script", state: "todo", line: waits, href: "/script", progress: null });
  } else if (script.status === "locked") {
    push({ key: "script", owner: "script", state: "done", line: `${t("第", "v")}${script.lockedVersion ?? script.version}${t(" 版已锁", " locked")}`, href: scriptHref, progress: null });
  } else if (script.status === "awaiting_approval") {
    push({ key: "script", owner: "script", state: "done", line: t("已交审", "sent for approval"), href: scriptHref, progress: null });
  } else if (script.status === "drafting") {
    push({
      key: "script",
      owner: "script",
      state: recent ? "running" : "you",
      line: recent ? `${t("第", "v")}${script.version + 1}${t(" 版 · 正在写", " · writing")}` : t("草稿等你看", "draft to read"),
      href: scriptHref,
      progress: null,
    });
  } else {
    push({ key: "script", owner: "script", state: "you", line: t("有简报，还没写", "brief, not written"), href: scriptHref, progress: null });
  }

  if (script?.status === "locked") {
    push({
      key: "approve",
      owner: "you",
      state: "done",
      line: approval?.decidedAt ? `${hkTime(approval.decidedAt)} ${t("已批准", "approved")}` : t("已批准", "approved"),
      href: `${scriptHref}?tab=approval`,
      progress: null,
    });
  } else if (script?.status === "awaiting_approval") {
    push({ key: "approve", owner: "you", state: "you", line: t("等你批准", "waiting for you"), href: `${scriptHref}?tab=approval`, progress: null });
  } else {
    push({ key: "approve", owner: "you", state: "todo", line: waits, href: script ? `${scriptHref}?tab=approval` : null, progress: null });
  }

  const projectHref = project ? `/video?project=${project.id}` : "/video";
  if (cutting) {
    const pct = cutting.status === "running" && cutting.progress > 0 ? Math.round(cutting.progress * 100) : null;
    push({
      key: "cut",
      owner: "video",
      state: "running",
      line: cutting.type === "video.transcribe" ? t("正在转写素材", "transcribing") : pct !== null ? `${t("进行中", "running")} ${pct}%` : t("进行中", "running"),
      href: projectHref,
      progress: cutting.progress,
    });
  } else if (project && timeline.n > 0) {
    push({ key: "cut", owner: "video", state: "done", line: `${timeline.n} ${t("段", "segments")}`, href: projectHref, progress: null });
  } else if (project) {
    push({ key: "cut", owner: "video", state: "todo", line: t("等素材上传", "waiting for footage"), href: projectHref, progress: null });
  } else {
    push({ key: "cut", owner: "video", state: "todo", line: waits, href: null, progress: null });
  }

  if (exporting) {
    const pct = exporting.status === "running" && exporting.progress > 0 ? Math.round(exporting.progress * 100) : null;
    push({ key: "export", owner: "video", state: "running", line: pct !== null ? `${t("正在渲染", "rendering")} ${pct}%` : t("正在渲染", "rendering"), href: projectHref, progress: exporting.progress });
  } else if (project?.masterFileId) {
    push({ key: "export", owner: "video", state: "done", line: t("成片已出", "master ready"), href: projectHref, progress: null });
  } else {
    push({ key: "export", owner: "video", state: "todo", line: waits, href: project ? projectHref : null, progress: null });
  }

  if (published) {
    push({ key: "publish", owner: "article", state: "done", line: `${hkTime(post!.updatedAt)} ${t("已发布", "published")}`, href: "/publish", progress: null });
  } else if (post?.state === "awaiting_approval") {
    push({ key: "publish", owner: "article", state: "you", line: t("文案等你批", "copy waiting for you"), href: "/publish", progress: null });
  } else if (post) {
    push({ key: "publish", owner: "article", state: "running", line: post.state === "draft" ? t("文案草稿", "copy drafted") : t("已排期", "scheduled"), href: "/publish", progress: null });
  } else {
    push({ key: "publish", owner: "article", state: "todo", line: waits, href: null, progress: null });
  }

  if (published && heard.n > 0) {
    push({ key: "feedback", owner: "research", state: "done", line: `${heard.n} ${t("条评论已收", "comments in")}`, href: "/research/inbox", progress: null });
  } else if (published) {
    push({ key: "feedback", owner: "research", state: "running", line: t("发布后 24 小时", "24h after post"), href: "/research/performance", progress: null });
  } else {
    push({ key: "feedback", owner: "research", state: "todo", line: t("发布后 24 小时", "24h after post"), href: null, progress: null });
  }

  const [collected] = await db.select({ at: sql<Date | null>`max(${hotSnapshots.fetchedAt})` }).from(hotSnapshots);
  const collectedAt = collected?.at ? new Date(collected.at).toISOString() : null;

  return {
    collectedAt,
    title: script ? (zh && script.titleLocal) || script.title : project?.title ?? (digestToday ? digestTopic : null),
    scriptId: script?.id ?? null,
    projectId: project?.id ?? null,
    stages,
  };
}
