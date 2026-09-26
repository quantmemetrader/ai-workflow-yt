import "server-only";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, chatMembers, chatMessages, hotSnapshots, ideas, relationTuples, seriesCache, settings, topics, users, scriptBeats, scripts, timelineItems, videoClips, videoExports, videoProjects, workProjects } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import type { Viewer } from "@/lib/auth/types";
import { viewerById } from "@/lib/auth/viewer-by-id";
import { createScript } from "@/lib/script/service";
import { createProject as createVideoProject } from "@/lib/video/service";
import { channelThread, createChannel } from "@/lib/chat/service";
import { agentKeyFromEmail, type AgentKey } from "@/lib/agents/catalog";
import { frontierStep } from "@/lib/home/roles";
import { audit } from "@/lib/audit";
import { share } from "@/lib/authz/rebac";
import { TITLE_NOISE, backlogQueryOf, channelNote, fromHotRow, fromIdea, fromSignal, fromTopicRow, type ProjectSource, type SignalLike, type SourceEvidence, type TopicRef, titleCore } from "@/lib/projects/topic";
import { PLATFORMS, isPlatformKey, type HotRow } from "@/lib/research/platform-catalog";
import { HOT_TENANT } from "@/lib/research/platforms";

/**
 * Which projects this person may see: their own, the studio-wide ones
 * (not for guests), the ones shared with a group they are in, the ones
 * naming them. Owners and admins see all of the studio's.
 */
function visibleTo(viewer: Viewer) {
  if (viewer.isAdmin) return sql`true`;
  return sql`(${workProjects.createdBy} = ${viewer.id}
    or (${workProjects.access} ->> 'mode' = 'everyone' and ${viewer.role} <> 'guest')
    or (${workProjects.access} ->> 'mode' = 'groups' and (${workProjects.access} -> 'groups') ? ${viewer.role})
    or (${workProjects.access} ->> 'mode' = 'groups' and ${viewer.role} = 'owner' and (${workProjects.access} -> 'groups') ? 'admin')
    or (${workProjects.access} ->> 'mode' = 'people' and (${workProjects.access} -> 'userIds') ? ${viewer.id}))`;
}

export type WorkProjectRow = {
  id: string;
  title: string;
  status: string;
  mode: string;
  updatedAt: string;
  scriptId: string | null;
  videoProjectId: string | null;
  channelSlug: string | null;
  createdBy: string;
  access: string;
};

/**
 * Start a project: its chat, its script and its video project, together.
 *
 * All three exist from the first moment so every employee knows where to
 * put its work: the chat's description names the script and the video
 * project, and the channel description is read with every question.
 *
 * `source` is the topic snapshot (`lib/projects/topic.ts`) when the project
 * was started from a picked topic: the brief is its clean text, the chat's
 * description carries its hook and up to three evidence lines, and the new
 * script starts with the topic's id, angle and must-cover points rather than
 * with the brief pasted in as its angle.
 */
export async function createWorkProject(
  viewer: Viewer,
  input: {
    title: string;
    brief?: string | null;
    mode?: string;
    source?: ProjectSource | { kind: string; label?: string; url?: string | null; evidence?: unknown[] } | null;
    scriptId?: string;
    /** A video project that already goes with that script (one made by an
     *  older hand-off), so the project takes it over instead of starting a
     *  second, empty one beside it. */
    videoProjectId?: string;
    /** The backlog topic (or idea) this project is about. */
    topicId?: string | null;
    /** What the new script starts with, when the project makes one. */
    script?: { topicId?: string | null; angle?: string | null; mandatoryPoints?: string[]; targetChannel?: string | null; aspect?: string | null; targetSeconds?: number | null; language?: string | null; subtitleLanguage?: string | null };
  },
): Promise<{ id: string; channelSlug: string; channelId: string; scriptId: string; videoProjectId: string }> {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 80) || "新项目";
  const id = newId("wp");
  const snapshot = (input.source ?? null) as ProjectSource | null;
  const scriptId =
    input.scriptId ??
    (await createScript(viewer, {
      title,
      topicId: input.script?.topicId ?? null,
      angle: input.script?.angle ?? snapshot?.angle ?? null,
      mandatoryPoints: (input.script?.mandatoryPoints ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 12),
      targetChannel: input.script?.targetChannel ?? null,
      aspect: input.script?.aspect ?? null,
      targetSeconds: input.script?.targetSeconds ?? null,
      language: input.script?.language ?? null,
      subtitleLanguage: input.script?.subtitleLanguage ?? null,
    }));
  const videoProjectId = input.videoProjectId ?? (await createVideoProject(viewer, title, scriptId));
  const note = channelNote(snapshot, input.brief ?? null);
  const topic = [
    `这是项目《${title}》的对话，只谈这个项目。`,
    `脚本：${scriptId}（/script/${scriptId}）。视频项目：${videoProjectId}（/video?project=${videoProjectId}）。`,
    "写脚本就写进这个脚本；剪辑、找素材、渲染都用这个视频项目。不要新建别的。",
    note ? `选题：${note}` : "",
  ]
    .filter(Boolean)
    .join("");
  /* The studio works on a project together: its script and its video are
     shared with everyone in it as editors, the five employees included. As
     private files the employees could read the brief and then refuse to
     cut ("no edit permission"). */
  await Promise.all([
    share(viewer, { type: "script", id: scriptId }, "editor", { type: "tenant", id: viewer.tenantId }),
    share(viewer, { type: "project", id: videoProjectId }, "editor", { type: "tenant", id: viewer.tenantId }),
  ]);
  const channel = await createChannel(viewer, { name: `${title.slice(0, 40)} · ${id.slice(-4)}`, topic });
  await db.insert(workProjects).values({
    id,
    tenantId: viewer.tenantId,
    title,
    brief: input.brief ?? null,
    mode: input.mode ?? "full",
    source: input.source ?? null,
    topicId: input.topicId ?? null,
    channelId: channel.id,
    scriptId,
    videoProjectId,
    createdBy: viewer.id,
  });
  await audit(viewer, "project.create", { module: "chat", objectType: "project", objectId: id, meta: { title, mode: input.mode ?? "full", topicId: input.topicId ?? null, from: snapshot?.key ?? snapshot?.kind ?? null } });
  return { id, channelSlug: channel.slug ?? "", channelId: channel.id, scriptId, videoProjectId };
}

/** What starting work inside a project needs from it. */
export type ProjectHandle = { id: string; title: string; channelId: string; scriptId: string | null; videoProjectId: string | null };

/**
 * The project a script's work belongs to, made when there is none.
 *
 * Everything lives under a project. A script written or approved outside
 * one — an older draft from the Script library, an approval hand-off, the
 * script page's "交给剪辑师" — used to get a bare video project beside it
 * (`projectFromScript`), which no project page, no project chat and no
 * sidebar entry knew about: 剪辑师 was handed a cut nobody could find. Now
 * the script's live project is used, or one is started around it (the
 * studio can see it, as any project started from a pick), taking over the
 * video project the script already has, if any.
 *
 * Started as the script's owner when that is somebody who still exists, so
 * the script and the video are shared with the studio by someone allowed to
 * share them; otherwise as `viewer`.
 */
export async function ensureScriptProject(viewer: Viewer, scriptId: string): Promise<(ProjectHandle & { created: boolean }) | null> {
  const [existing] = await db
    .select({ id: workProjects.id, title: workProjects.title, channelId: workProjects.channelId, scriptId: workProjects.scriptId, videoProjectId: workProjects.videoProjectId })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, viewer.tenantId), eq(workProjects.scriptId, scriptId), isNull(workProjects.deletedAt)))
    .orderBy(workProjects.createdAt)
    .limit(1);
  if (existing) return { ...existing, created: false };

  const [script] = await db
    .select({ id: scripts.id, title: scripts.title, angle: scripts.angle, topicId: scripts.topicId, ownerId: scripts.ownerId })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, viewer.tenantId), isNull(scripts.deletedAt)))
    .limit(1);
  if (!script) return null;
  const [video] = await db
    .select({ id: videoProjects.id })
    .from(videoProjects)
    .where(and(eq(videoProjects.scriptId, scriptId), eq(videoProjects.tenantId, viewer.tenantId), isNull(videoProjects.deletedAt)))
    .orderBy(desc(videoProjects.updatedAt))
    .limit(1);

  const owner = (script.ownerId && script.ownerId !== viewer.id ? await viewerById(script.ownerId) : null) ?? viewer;
  const created = await createWorkProject(owner, {
    title: script.title,
    brief: script.angle ?? null,
    mode: "full",
    source: { kind: "script", label: "从脚本开始" },
    scriptId,
    ...(video ? { videoProjectId: video.id } : {}),
    topicId: script.topicId ?? null,
  });
  return { id: created.id, title: script.title.replace(/\s+/g, " ").trim().slice(0, 80) || "新项目", channelId: created.channelId, scriptId, videoProjectId: created.videoProjectId, created: true };
}

/**
 * A live project to write a new script into, by its exact title: one this
 * person may see, whose script is still empty and not locked. So "写《X》的
 * 脚本" asked outside a project fills the project somebody already started
 * for X (from a morning brief, a pick, the plan) instead of starting a
 * second one beside it. A project whose script already has a draft is not
 * rewritten from outside it; a new project is started instead.
 */
export async function emptyProjectTitled(viewer: Viewer, title: string): Promise<ProjectHandle | null> {
  const wanted = title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!wanted) return null;
  const [row] = await db
    .select({ id: workProjects.id, title: workProjects.title, channelId: workProjects.channelId, scriptId: workProjects.scriptId, videoProjectId: workProjects.videoProjectId })
    .from(workProjects)
    .innerJoin(scripts, and(eq(scripts.id, workProjects.scriptId), isNull(scripts.deletedAt)))
    .where(
      and(
        eq(workProjects.tenantId, viewer.tenantId),
        isNull(workProjects.deletedAt),
        eq(workProjects.status, "active"),
        visibleTo(viewer),
        sql`lower(${workProjects.title}) = lower(${wanted})`,
        sql`${scripts.lockedVersion} is null`,
        sql`not exists (select 1 from ${scriptBeats} b where b.script_id = ${scripts.id})`,
      ),
    )
    .orderBy(workProjects.createdAt)
    .limit(1);
  return row ?? null;
}

/** How many clips are in a video project's bin: what 剪辑师 has to cut from. */
export async function clipCount(videoProjectId: string): Promise<number> {
  const [row] = await db.select({ n: count() }).from(videoClips).where(eq(videoClips.projectId, videoProjectId));
  return Number(row?.n ?? 0);
}

/**
 * The project each chat message is about, for the "打开项目" button — only
 * projects this person may see.
 *
 * A message names a project outright (`meta.project`, a hand-off's or a
 * receipt's work project), or through the script or the video project it
 * handed over, which is how every hand-off from before projects existed
 * still finds its way to the project it belongs to.
 */
export async function projectLinks(
  viewer: Viewer,
  refs: { messageId: string; projectIds: string[]; scriptIds: string[]; videoIds: string[] }[],
): Promise<Map<string, { id: string; title: string }>> {
  const out = new Map<string, { id: string; title: string }>();
  const projectIds = [...new Set(refs.flatMap((r) => r.projectIds))].slice(0, 200);
  const scriptIds = [...new Set(refs.flatMap((r) => r.scriptIds))].slice(0, 200);
  const videoIds = [...new Set(refs.flatMap((r) => r.videoIds))].slice(0, 200);
  if (!projectIds.length && !scriptIds.length && !videoIds.length) return out;
  const anyOf = [
    projectIds.length ? inArray(workProjects.id, projectIds) : null,
    scriptIds.length ? inArray(workProjects.scriptId, scriptIds) : null,
    videoIds.length ? inArray(workProjects.videoProjectId, videoIds) : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);
  const rows = await db
    .select({ id: workProjects.id, title: workProjects.title, scriptId: workProjects.scriptId, videoProjectId: workProjects.videoProjectId })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), visibleTo(viewer), sql`(${sql.join(anyOf.map((c) => sql`(${c})`), sql` or `)})`));
  for (const r of refs) {
    const hit =
      rows.find((p) => r.projectIds.includes(p.id)) ??
      rows.find((p) => p.scriptId !== null && r.scriptIds.includes(p.scriptId)) ??
      rows.find((p) => p.videoProjectId !== null && r.videoIds.includes(p.videoProjectId));
    if (hit) out.set(r.messageId, { id: hit.id, title: hit.title });
  }
  return out;
}

export async function listWorkProjects(viewer: Viewer, limit = 40, order: "activity" | "created" = "activity"): Promise<WorkProjectRow[]> {
  const rows = await db
    .select({
      id: workProjects.id,
      title: workProjects.title,
      status: workProjects.status,
      mode: workProjects.mode,
      updatedAt: workProjects.updatedAt,
      scriptId: workProjects.scriptId,
      videoProjectId: workProjects.videoProjectId,
      channelSlug: chatChannels.slug,
      lastMessageAt: chatChannels.lastMessageAt,
      createdBy: workProjects.createdBy,
      access: sql<string>`${workProjects.access} ->> 'mode'`,
    })
    .from(workProjects)
    .leftJoin(chatChannels, eq(chatChannels.id, workProjects.channelId))
    .where(and(eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), visibleTo(viewer)))
    .orderBy(order === "created" ? desc(workProjects.createdAt) : desc(sql`greatest(${workProjects.updatedAt}, coalesce(${chatChannels.lastMessageAt}, ${workProjects.updatedAt}))`))
    .limit(limit);
  return rows.map((r) => ({ ...r, updatedAt: (r.lastMessageAt && r.lastMessageAt > r.updatedAt ? r.lastMessageAt : r.updatedAt).toISOString() }));
}

export type ProjectStageRow = WorkProjectRow & {
  scriptStatus: string | null;
  beats: number;
  /** `video_projects.director.state`, when the director has been at it. */
  directorState: string | null;
  steps: ProjectStep[];
  /** Where it has got to (`frontierStep`); null when delivered. */
  frontier: ProjectStep | null;
  /**
   * The file a card's picture comes from (`/api/files/{id}/thumb`): the first
   * clip in the bin, as on Home, or — for a cut made without uploads (a
   * direct edit from stock) — the finished render. Null draws the soft
   * gradient and the clapper.
   */
  thumbFileId: string | null;
};

/**
 * Every project this person may see, with its steps, in one query.
 *
 * What role Homes filter by. `workProjectDetail` answers the same question
 * for one project with nine round trips and a thread read, which is right
 * for its page and wrong for a list: sixty projects would be five hundred
 * queries to find the six a video editor has in hand. Here the script's
 * status, the counts, the latest render and the director's state come from
 * correlated subqueries of the same row, and the steps are built by the same
 * `buildSteps` the project page uses, so a card and its page cannot disagree.
 *
 * Same visibility (`visibleTo`), same order (latest activity first) and the
 * same `updatedAt` as `listWorkProjects`.
 */
export async function listProjectStages(
  viewer: Viewer,
  options: { status?: "active" | "done" | "archived"; limit?: number; zh?: boolean } = {},
): Promise<ProjectStageRow[]> {
  const limit = Math.min(Math.max(1, options.limit ?? 60), 200);
  const zh = options.zh ?? true;
  const rows = await db
    .select({
      id: workProjects.id,
      title: workProjects.title,
      status: workProjects.status,
      mode: workProjects.mode,
      updatedAt: workProjects.updatedAt,
      scriptId: workProjects.scriptId,
      videoProjectId: workProjects.videoProjectId,
      channelSlug: chatChannels.slug,
      lastMessageAt: chatChannels.lastMessageAt,
      createdBy: workProjects.createdBy,
      access: sql<string>`${workProjects.access} ->> 'mode'`,
      source: workProjects.source,
      scriptStatus: scripts.status,
      scriptVersion: scripts.version,
      directorState: sql<string | null>`${videoProjects.director} ->> 'state'`,
      beats: sql<number>`(select count(*)::int from ${scriptBeats} where ${scriptBeats.scriptId} = ${scripts.id})`,
      clips: sql<number>`(select count(*)::int from ${videoClips} where ${videoClips.projectId} = ${videoProjects.id})`,
      items: sql<number>`(select count(*)::int from ${timelineItems} where ${timelineItems.projectId} = ${videoProjects.id})`,
      render: sql<{ state: string; progress: number; fileId: string | null } | null>`(
        select json_build_object('state', ${videoExports.state}, 'progress', ${videoExports.progress}, 'fileId', ${videoExports.fileId})
          from ${videoExports}
         where ${videoExports.projectId} = ${videoProjects.id}
         order by ${videoExports.createdAt} desc
         limit 1)`,
      /* One more correlated read of the same row, for the projects list's
         pictures: the first clip added, which is what Home shows too. */
      firstClipFileId: sql<string | null>`(select ${videoClips.fileId} from ${videoClips} where ${videoClips.projectId} = ${videoProjects.id} order by ${videoClips.addedAt} asc limit 1)`,
    })
    .from(workProjects)
    .leftJoin(chatChannels, eq(chatChannels.id, workProjects.channelId))
    .leftJoin(scripts, and(eq(scripts.id, workProjects.scriptId), isNull(scripts.deletedAt)))
    .leftJoin(videoProjects, and(eq(videoProjects.id, workProjects.videoProjectId), isNull(videoProjects.deletedAt)))
    .where(
      and(
        eq(workProjects.tenantId, viewer.tenantId),
        isNull(workProjects.deletedAt),
        visibleTo(viewer),
        options.status ? eq(workProjects.status, options.status) : undefined,
      ),
    )
    .orderBy(desc(sql`greatest(${workProjects.updatedAt}, coalesce(${chatChannels.lastMessageAt}, ${workProjects.updatedAt}))`))
    .limit(limit);

  return rows.map((r) => {
    /* pg hands a json column back parsed; a driver that returns the text
       instead is read the same way. */
    const render = typeof r.render === "string" ? (JSON.parse(r.render) as typeof r.render) : r.render;
    const steps = buildSteps(
      {
        mode: r.mode,
        status: r.status,
        source: r.source,
        script: r.scriptStatus ? { status: r.scriptStatus, version: r.scriptVersion ?? 1 } : null,
        beats: Number(r.beats ?? 0),
        clips: Number(r.clips ?? 0),
        items: Number(r.items ?? 0),
        render: render ? { state: String(render.state), progress: Number(render.progress ?? 0), fileId: render.fileId ?? null } : null,
      },
      zh,
    );
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      mode: r.mode,
      updatedAt: (r.lastMessageAt && r.lastMessageAt > r.updatedAt ? r.lastMessageAt : r.updatedAt).toISOString(),
      scriptId: r.scriptId,
      videoProjectId: r.videoProjectId,
      channelSlug: r.channelSlug,
      createdBy: r.createdBy,
      access: r.access,
      scriptStatus: r.scriptStatus ?? null,
      beats: Number(r.beats ?? 0),
      directorState: r.directorState ?? null,
      steps,
      frontier: frontierStep(steps),
      thumbFileId: r.firstClipFileId ?? (render?.state === "done" ? (render.fileId ?? null) : null),
    };
  });
}

/** Channels that belong to projects, so Chat can leave them to their pages. */
export async function projectChannelIds(tenantId: string): Promise<string[]> {
  const rows = await db.select({ id: workProjects.channelId }).from(workProjects).where(eq(workProjects.tenantId, tenantId));
  return rows.map((r) => r.id);
}

export type StepState = "done" | "running" | "you" | "todo" | "skipped";
export type ProjectStep = { key: "topic" | "script" | "clips" | "edit" | "deliver"; label: string; owner: AgentKey | "you"; state: StepState; line: string };

export type ProjectDetail = {
  id: string;
  title: string;
  brief: string | null;
  status: string;
  mode: string;
  access: { mode: "private" | "everyone" | "groups" | "people"; groups?: string[]; userIds?: string[] };
  canManage: boolean;
  source: { kind: string; label?: string; url?: string | null } | null;
  createdAt: string;
  channel: { id: string; slug: string; name: string };
  script: { id: string; title: string; status: string; version: number; beats: number } | null;
  video: { id: string; title: string; clips: number; items: number } | null;
  /** The script's beats, in order, for the card and its popup. */
  beats: { ord: number; visual: string; voiceover: string }[];
  /** The clips in the bin, for thumbnails. */
  clipList: { id: string; fileId: string; label: string; durationMs: number | null }[];
  render: { fileId: string | null; state: string; progress: number; at: string } | null;
  /** Where the director has got to, when it is at work on this project. */
  director: { state: string; step: string | null; error: string | null } | null;
  steps: ProjectStep[];
  messages: {
    id: string;
    author: string;
    agent: AgentKey | null;
    body: string;
    at: string;
    actions: import("@/lib/agents/cards").CardAction[];
    done: import("@/lib/agents/cards").CardDone | null;
    /** What it handed over (the script, the video), drawn as links. */
    handoff: import("@/lib/chat/handoff").ChatHandoff | null;
    /** Another project it names, when that is not this one. */
    otherProject: { id: string; title: string } | null;
    /** A long job it started, for the live chip. */
    job: { videoProjectId: string } | null;
  }[];
  /** The employees at work in this project's chat right now, and on what. */
  pending: import("@/lib/chat/pending").PendingRow[];
};

/** What the five steps are worked out from. Everything a project's own rows
 * say; nothing about who is looking except the language. */
export type StepFacts = {
  mode: string;
  status: string;
  source: { label?: string } | null;
  /** The live script, if it has one (deleted counts as none). */
  script: { status: string; version: number } | null;
  beats: number;
  clips: number;
  items: number;
  /** The latest render. */
  render: { state: string; progress: number; fileId: string | null } | null;
};

/**
 * A project's five steps and where each stands, from its rows.
 *
 * Pure, and the only place the rule lives: the project page
 * (`workProjectDetail`) and the Home lists (`listProjectStages`) both call
 * it, so a card and its page cannot tell two stories.
 */
export function buildSteps(f: StepFacts, zh: boolean): ProjectStep[] {
  const t = (a: string, b: string) => (zh ? a : b);
  const { script, render } = f;
  const beats = { n: f.beats };
  const clips = { n: f.clips };
  const items = { n: f.items };
  const direct = f.mode.startsWith("direct:") ? (f.mode.slice(7) as AgentKey) : null;
  const skip = (key: ProjectStep["key"]) =>
    direct === "video" ? key === "script" || key === "clips" : direct === "article" ? key !== "deliver" && key !== "topic" : false;

  const scriptState: StepState = !script
    ? "todo"
    : script.status === "locked"
      ? "done"
      : script.status === "awaiting_approval"
        ? "you"
        : script.status === "drafting" || beats.n > 0
          ? "running"
          : "todo";
  const rendered = render?.state === "done" && render.fileId;
  const rendering = render && (render.state === "queued" || render.state === "rendering");
  return [
    { key: "topic", label: t("选题", "Topic"), owner: "research", state: "done", line: f.source?.label ?? t("你定的题", "Your topic") },
    {
      key: "script",
      label: t("脚本", "Script"),
      owner: "script",
      state: skip("script") ? "skipped" : scriptState,
      line: skip("script")
        ? t("跳过 · 直接剪辑", "Skipped · straight to the edit")
        : scriptState === "done"
          ? t(`第 ${script!.version} 版已锁定`, `v${script!.version} locked`)
          : scriptState === "you"
            ? t("写好了，等你批准", "Written; waiting for your OK")
            : scriptState === "running"
              ? t(`草稿 · ${beats.n} 个分镜`, `Draft · ${beats.n} beats`)
              : t("等编剧开写", "Waiting for the writer"),
    },
    {
      key: "clips",
      label: t("上传素材", "Upload clips"),
      owner: "you",
      state: skip("clips") ? "skipped" : clips.n > 0 ? "done" : scriptState === "done" ? "you" : "todo",
      line: skip("clips") ? t("跳过 · 用素材库", "Skipped · stock footage") : clips.n > 0 ? t(`${clips.n} 段素材`, `${clips.n} clips`) : t("主持人拍好后上传", "The host uploads when filmed"),
    },
    {
      key: "edit",
      label: t("剪辑", "Edit"),
      owner: "video",
      state: rendered ? "done" : rendering || items.n > 0 ? "running" : "todo",
      line: rendered ? t("成片已出", "Rendered") : rendering ? t(`渲染中 ${Math.round((render!.progress ?? 0) * (render!.progress > 1 ? 1 : 100))}%`, `Rendering ${Math.round((render!.progress ?? 0) * (render!.progress > 1 ? 1 : 100))}%`) : items.n > 0 ? t(`时间线 ${items.n} 段`, `${items.n} on the timeline`) : t("素材到了就开始", "Starts when clips arrive"),
    },
    {
      key: "deliver",
      label: t("批准交付", "Approve & deliver"),
      owner: "you",
      state: f.status === "done" ? "done" : rendered ? "you" : "todo",
      line: f.status === "done" ? t("已交付", "Delivered") : rendered ? t("看成片，满意就交付", "Watch it; deliver when happy") : t("剪完之后", "After the edit"),
    },
  ];
}

export async function workProjectDetail(viewer: Viewer, id: string, zh: boolean, messageLimit = 80): Promise<ProjectDetail | null> {
  const [p] = await db
    .select()
    .from(workProjects)
    .where(and(eq(workProjects.id, id), eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), visibleTo(viewer)))
    .limit(1);
  if (!p) return null;
  const [ch] = await db.select({ id: chatChannels.id, slug: chatChannels.slug, name: chatChannels.name }).from(chatChannels).where(eq(chatChannels.id, p.channelId)).limit(1);
  if (!ch?.slug) return null;

  const [script] = p.scriptId
    ? await db.select({ id: scripts.id, title: scripts.title, status: scripts.status, version: scripts.version }).from(scripts).where(and(eq(scripts.id, p.scriptId), isNull(scripts.deletedAt))).limit(1)
    : [];
  const [video] = p.videoProjectId
    ? await db.select({ id: videoProjects.id, title: videoProjects.title, director: videoProjects.director }).from(videoProjects).where(and(eq(videoProjects.id, p.videoProjectId), isNull(videoProjects.deletedAt))).limit(1)
    : [];
  const [beatRows, clipRows] = await Promise.all([
    script ? db.select({ ord: scriptBeats.ord, visual: scriptBeats.visual, voiceover: scriptBeats.voiceover }).from(scriptBeats).where(eq(scriptBeats.scriptId, script.id)).orderBy(scriptBeats.ord) : Promise.resolve([]),
    video ? db.select({ id: videoClips.id, fileId: videoClips.fileId, label: videoClips.label, durationMs: videoClips.durationMs }).from(videoClips).where(eq(videoClips.projectId, video.id)).limit(40) : Promise.resolve([]),
  ]);
  const [[beats], [clips], [items], [render], thread] = await Promise.all([
    script ? db.select({ n: count() }).from(scriptBeats).where(eq(scriptBeats.scriptId, script.id)) : Promise.resolve([{ n: 0 }]),
    video ? db.select({ n: count() }).from(videoClips).where(eq(videoClips.projectId, video.id)) : Promise.resolve([{ n: 0 }]),
    video ? db.select({ n: count() }).from(timelineItems).where(eq(timelineItems.projectId, video.id)) : Promise.resolve([{ n: 0 }]),
    video
      ? db
          .select({ fileId: videoExports.fileId, state: videoExports.state, progress: videoExports.progress, at: videoExports.createdAt })
          .from(videoExports)
          .where(eq(videoExports.projectId, video.id))
          .orderBy(desc(videoExports.createdAt))
          .limit(1)
      : Promise.resolve([]),
    channelThread(viewer, ch.slug, messageLimit),
  ]);

  /* A message in this chat that names some other project (a hand-off
     that came from elsewhere) gets a way there; this project's own is
     already on screen. */
  const links = thread ? await projectLinks(viewer, thread.messages.map((m) => ({ messageId: m.id, ...m.refs }))) : new Map<string, { id: string; title: string }>();

  const steps = buildSteps(
    {
      mode: p.mode,
      status: p.status,
      source: (p.source as { label?: string } | null) ?? null,
      script: script ? { status: script.status, version: script.version } : null,
      beats: beats.n,
      clips: clips.n,
      items: items.n,
      render: render ? { state: render.state, progress: render.progress, fileId: render.fileId } : null,
    },
    zh,
  );

  return {
    id: p.id,
    title: p.title,
    brief: p.brief,
    status: p.status,
    mode: p.mode,
    access: p.access ?? { mode: "everyone" },
    canManage: viewer.isAdmin || p.createdBy === viewer.id,
    source: (p.source as ProjectDetail["source"]) ?? null,
    createdAt: p.createdAt.toISOString(),
    channel: { id: ch.id, slug: ch.slug, name: ch.name },
    script: script ? { ...script, beats: beats.n } : null,
    beats: beatRows,
    clipList: clipRows,
    video: video ? { id: video.id, title: video.title, clips: clips.n, items: items.n } : null,
    director: video?.director && typeof (video.director as { state?: unknown }).state === "string" ? { state: String((video.director as { state: string }).state), step: ((video.director as { step?: string }).step ?? null), error: ((video.director as { error?: string }).error ?? null) } : null,
    render: render ? { fileId: render.fileId, state: render.state, progress: render.progress, at: render.at.toISOString() } : null,
    steps,
    messages: (thread?.messages ?? []).map((m) => ({
      id: m.id,
      author: (zh && m.authorNameLocal) || m.authorName || "—",
      agent: m.authorIsAgent ? agentKeyFromEmail(m.authorEmail) : null,
      body: m.body,
      at: m.createdAt.toISOString(),
      actions: m.actions,
      done: m.done,
      handoff: m.handoff,
      otherProject: links.get(m.id) && links.get(m.id)!.id !== p.id ? links.get(m.id)! : null,
      job: m.job,
    })),
    pending: thread?.pending ?? [],
  };
}

/**
 * Mark a project active, done or archived. Only one this person may see:
 * the action is reachable with any id, and a private project is not
 * somebody else's to close. False when nothing was changed.
 */
export async function setProjectStatus(viewer: Viewer, id: string, status: "active" | "done" | "archived"): Promise<boolean> {
  const rows = await db
    .update(workProjects)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(workProjects.id, id), eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), visibleTo(viewer)))
    .returning({ id: workProjects.id });
  return rows.length > 0;
}

export async function touchProjects(ids: string[]) {
  if (ids.length) await db.update(workProjects).set({ updatedAt: new Date() }).where(inArray(workProjects.id, ids));
}

/**
 * The project a script or a video project belongs to, if any.
 *
 * Given the person, only a project they may see: the script and video
 * screens draw its title and a link to it from this, and a private
 * project's name and id are not every Script holder's to read. Given only
 * the studio's id, any live project, for callers with no person behind them.
 */
export async function projectFor(who: Viewer | string, by: { scriptId?: string; videoProjectId?: string }) {
  const cond = by.scriptId ? eq(workProjects.scriptId, by.scriptId) : by.videoProjectId ? eq(workProjects.videoProjectId, by.videoProjectId) : null;
  if (!cond) return null;
  const tenantId = typeof who === "string" ? who : who.tenantId;
  const [row] = await db
    .select({ id: workProjects.id, title: workProjects.title, scriptId: workProjects.scriptId, videoProjectId: workProjects.videoProjectId })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, tenantId), isNull(workProjects.deletedAt), cond, typeof who === "string" ? undefined : visibleTo(who)))
    .limit(1);
  return row ?? null;
}

/**
 * Whether this person may reach a script or a video project by the project
 * rule: one that belongs to live projects only through a project of those
 * they may see; one in no project answers to its own module's checks alone.
 *
 * For ids that arrive from outside — what a screen says is open, what an
 * assistant turn falls back on — before an employee, who is a member of
 * every private project's chat and an editor of its script, acts on them
 * for somebody. Existence in the studio is the caller's to check.
 */
export async function reachableThroughProjects(viewer: Viewer, by: { scriptId?: string; videoProjectId?: string }): Promise<boolean> {
  const cond = by.scriptId ? eq(workProjects.scriptId, by.scriptId) : by.videoProjectId ? eq(workProjects.videoProjectId, by.videoProjectId) : null;
  if (!cond) return false;
  const [row] = await db
    .select({ all: count(), open: sql<number>`count(*) filter (where ${visibleTo(viewer)})` })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), cond));
  return Number(row?.all ?? 0) === 0 || Number(row?.open ?? 0) > 0;
}

type Access = { mode: "private" | "everyone" | "groups" | "people"; groups?: string[]; userIds?: string[] };

/**
 * Change who can see and work on a project, and make the chat, the script
 * and the video project follow. Only the person who started it, or an admin.
 */
export async function setProjectAccess(viewer: Viewer, id: string, access: Access): Promise<void> {
  const [p] = await db.select().from(workProjects).where(and(eq(workProjects.id, id), eq(workProjects.tenantId, viewer.tenantId))).limit(1);
  if (!p) throw new Error("No such project");
  if (!viewer.isAdmin && p.createdBy !== viewer.id) throw new Error("Only the person who started it, or an admin, can change who sees it");

  const roles = (access.groups ?? []).filter((g) => ["owner", "admin", "member", "guest"].includes(g));
  const clean: Access =
    access.mode === "groups" ? { mode: "groups", groups: roles } : access.mode === "people" ? { mode: "people", userIds: (access.userIds ?? []).slice(0, 100) } : { mode: access.mode === "private" ? "private" : "everyone" };

  const tenantUsers = await db
    .select({ id: users.id, role: users.role, isAgent: users.isAgent })
    .from(users)
    .where(and(eq(users.tenantId, viewer.tenantId), isNull(users.deletedAt)));
  const agents = tenantUsers.filter((u) => u.isAgent).map((u) => u.id);
  const people =
    clean.mode === "everyone"
      ? tenantUsers.filter((u) => !u.isAgent && u.role !== "guest").map((u) => u.id)
      : clean.mode === "groups"
        ? tenantUsers.filter((u) => !u.isAgent && (roles.includes(u.role) || (u.role === "owner" && roles.includes("admin")))).map((u) => u.id)
        : clean.mode === "people"
          ? tenantUsers.filter((u) => !u.isAgent && clean.userIds!.includes(u.id)).map((u) => u.id)
          : [];
  const members = [...new Set([p.createdBy, ...people, ...agents])];

  await db.transaction(async (trx) => {
    await trx.update(workProjects).set({ access: clean, updatedAt: new Date() }).where(eq(workProjects.id, id));
    /* The chat: open to the studio, or private to exactly these people. */
    await trx.update(chatChannels).set({ isPrivate: clean.mode !== "everyone" }).where(eq(chatChannels.id, p.channelId));
    if (clean.mode !== "everyone") {
      await trx.delete(chatMembers).where(eq(chatMembers.channelId, p.channelId));
      await trx.insert(chatMembers).values(members.map((userId) => ({ channelId: p.channelId, userId }))).onConflictDoNothing();
    }
    /* The script and the video: editors are exactly who may work on it. */
    for (const [type, objectId] of [["script", p.scriptId], ["project", p.videoProjectId]] as const) {
      if (!objectId) continue;
      await trx
        .delete(relationTuples)
        .where(and(eq(relationTuples.objectType, type), eq(relationTuples.objectId, objectId), sql`${relationTuples.relation} <> 'owner'`));
      const subjects =
        clean.mode === "everyone"
          ? [{ type: "tenant" as const, id: viewer.tenantId }, ...agents.map((a) => ({ type: "user" as const, id: a }))]
          : members.filter((m) => m !== p.createdBy).map((m) => ({ type: "user" as const, id: m }));
      if (subjects.length) {
        await trx
          .insert(relationTuples)
          .values(subjects.map((sub) => ({ id: newId("tup"), objectType: type, objectId, relation: "editor" as const, subjectType: sub.type, subjectId: sub.id, grantedBy: viewer.id })))
          .onConflictDoNothing();
      }
    }
  });
  await audit(viewer, "project.access", { module: "chat", objectType: "project", objectId: id, meta: { mode: clean.mode } });
}

/** Remove a project from every list (kept in the database, recoverable). */
export async function deleteProject(viewer: Viewer, id: string): Promise<void> {
  const [p] = await db.select({ createdBy: workProjects.createdBy }).from(workProjects).where(and(eq(workProjects.id, id), eq(workProjects.tenantId, viewer.tenantId))).limit(1);
  if (!p) throw new Error("No such project");
  if (!viewer.isAdmin && p.createdBy !== viewer.id) throw new Error("Only the person who started it, or an admin, can delete it");
  await db.update(workProjects).set({ deletedAt: new Date() }).where(eq(workProjects.id, id));
  await audit(viewer, "project.delete", { module: "chat", objectType: "project", objectId: id });
}

/* ------------------------------------------------ projects from topics */

/**
 * What a picked topic resolves to on the server: the project's title, the
 * snapshot that travels with it, and what its script starts with.
 *
 * Buttons send a pointer (`TopicRef`), never the content: a signal by its
 * brief's date and place, a topic or an idea by id, a hot-list row by its
 * platform and phrase. Everything shown later (why, hook, evidence and its
 * numbers) is read here from the stored rows, so a page cannot put words in
 * the writer's mouth that the research never said.
 */
export type ResolvedTopic = {
  title: string;
  source: ProjectSource;
  /** `work_projects.topic_id`: the backlog topic, or the idea. */
  projectTopicId: string | null;
  /** `scripts.topic_id`: only ever a real `topics` row. */
  scriptTopicId: string | null;
  mandatoryPoints: string[];
};

const hkToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" }).format(new Date());

/** The morning briefs of the last week, newest first, with their signals. */
async function recentDigests(tenantId: string, date?: string | null) {
  const rows = await db
    .select({ meta: chatMessages.meta, body: chatMessages.body })
    .from(chatMessages)
    .innerJoin(chatChannels, eq(chatChannels.id, chatMessages.channelId))
    .where(
      and(
        eq(chatChannels.tenantId, tenantId),
        isNull(chatMessages.deletedAt),
        date ? sql`(${chatMessages.meta} -> 'digest' ->> 'date') = ${date}` : sql`(${chatMessages.meta} -> 'digest' ->> 'date') is not null`,
      ),
    )
    .orderBy(desc(chatMessages.createdAt))
    .limit(date ? 1 : 7);
  return rows.map((r) => {
    const d = (r.meta as { digest?: { date?: unknown; signals?: unknown } } | null)?.digest;
    const signals = Array.isArray(d?.signals) ? (d!.signals as SignalLike[]).filter((x) => x && typeof x.title === "string") : [];
    return { date: typeof d?.date === "string" ? d.date : "", signals };
  });
}

/** A backlog topic with the headlines its chart collected, as a snapshot. */
export async function topicSource(tenantId: string, topicId: string, zh = true): Promise<ResolvedTopic | null> {
  const [topic] = await db.select().from(topics).where(and(eq(topics.id, topicId), eq(topics.tenantId, tenantId))).limit(1);
  if (!topic) return null;
  const [cached] = await db
    .select({ articles: seriesCache.articles })
    .from(seriesCache)
    .where(and(eq(seriesCache.query, topic.query), eq(seriesCache.window, "3m")))
    .limit(1);
  return {
    title: (zh && topic.nameLocal) || topic.name,
    source: fromTopicRow(topic, cached?.articles ?? []),
    projectTopicId: topic.id,
    scriptTopicId: topic.id,
    mandatoryPoints: topic.angles.slice(0, 5),
  };
}

/** Title a suggestion ("写《X》的脚本", "…：「问题」") by what is inside its quotes. */
function proposalTitle(text: string): string {
  const quoted = text.match(/《(.+?)》/)?.[1] ?? text.match(/「(.+?)」/)?.[1] ?? null;
  return (quoted ?? text.replace(/^(写|做|剪)(一条|一篇|一个)?/, "")).trim().slice(0, 80);
}

export async function resolveTopicRef(viewer: Viewer, ref: TopicRef): Promise<ResolvedTopic | null> {
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

  if (ref.kind === "signal") {
    /* By the brief's own date when the caller has it: an index alone points
       into whichever brief is newest, so an old card opened the wrong one. */
    const date = str(ref.date, 10) || null;
    const title = str(ref.title, 200);
    const briefs = await recentDigests(viewer.tenantId, date);
    for (const b of briefs) {
      if (!b.date) continue;
      const at = typeof ref.index === "number" && Number.isInteger(ref.index) ? b.signals[ref.index] : undefined;
      let index = at && (!title || at.title === title) ? (ref.index as number) : -1;
      if (index < 0 && title) index = b.signals.findIndex((x) => x.title === title);
      if (index < 0) continue;
      const sg = b.signals[index];
      return { title: sg.title.slice(0, 80), source: fromSignal(sg, b.date, index), projectTopicId: null, scriptTopicId: null, mandatoryPoints: [] };
    }
    /* A brief from before signals were stored names its topic only in its
       text; the title is all there is to carry. */
    if (title && !date) return { title: title.slice(0, 80), source: { kind: "digest", label: "晨报", key: `digest:${title.slice(0, 120)}` }, projectTopicId: null, scriptTopicId: null, mandatoryPoints: [] };
    return null;
  }

  if (ref.kind === "topic") {
    return str(ref.id, 64) ? topicSource(viewer.tenantId, str(ref.id, 64), zh) : null;
  }

  if (ref.kind === "idea") {
    const [row] = await db.select().from(ideas).where(and(eq(ideas.id, str(ref.id, 64)), eq(ideas.tenantId, viewer.tenantId))).limit(1);
    if (!row) return null;
    const source = fromIdea({ id: row.id, title: row.title, titles: row.titles, angle: row.angle, why: row.why, hook: row.hook, format: row.format, strength: row.strength, evidence: (row.evidence as SourceEvidence[]) ?? [] });
    /* An idea kept with "存进选题储备" is also a backlog topic, under its
       title (`backlogQueryOf`). The script is written from that topic, so
       the board moves it to Scripting and links the script, and neither the
       board nor the Script queue offers the same thing a second time. */
    const [kept] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(and(eq(topics.tenantId, viewer.tenantId), eq(topics.query, backlogQueryOf(row.title)), sql`${topics.status} <> 'rejected'`))
      .limit(1);
    if (kept) source.topicId = kept.id;
    return { title: row.title.slice(0, 80), source, projectTopicId: row.id, scriptTopicId: kept?.id ?? null, mandatoryPoints: [] };
  }

  if (ref.kind === "own") {
    const text = str(ref.text, 200);
    if (!text) return null;
    /* Today's own picks live in settings; one typed elsewhere is still the
       person's own topic, just without anybody's name on it. */
    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, `research:own-picks:${viewer.tenantId}`)).limit(1);
    const today = hkToday();
    const pick = (Array.isArray(row?.value) ? (row!.value as { text?: string; by?: string; date?: string }[]) : []).find((p) => p.text === text && p.date === today);
    return {
      title: text.slice(0, 80),
      source: { kind: "own", label: pick?.by ? `${pick.by}加的选题` : "自己定的题", key: `own:${pick?.date ?? "text"}:${text.slice(0, 120)}` },
      projectTopicId: null,
      scriptTopicId: null,
      mandatoryPoints: [],
    };
  }

  if (ref.kind === "hot") {
    const platform = str(ref.platform, 40);
    const phrase = str(ref.phrase, 300);
    if (!isPlatformKey(platform) || !phrase) return null;
    /* The stored lists only: never a live (billed) read from a button.
       The lists are shared by every studio, but 研究员's marks on them are
       not: the collector judges each row for its own studio (`HOT_TENANT`),
       citing that studio's videos, viewers and rivals, and
       `/api/research/hot` gives them to nobody else. So another studio's
       project starts from the row alone, with no "why" copied into its
       brief, its chat's description or its writer's facts. */
    const own = viewer.tenantId === HOT_TENANT;
    const snaps = await db
      .select({ rows: hotSnapshots.rows, judged: own ? hotSnapshots.judged : sql<null>`null` })
      .from(hotSnapshots)
      .where(eq(hotSnapshots.platform, platform))
      .orderBy(desc(hotSnapshots.fetchedAt))
      .limit(24);
    for (const snap of snaps) {
      const row = (snap.rows as HotRow[]).find((r) => r && r.phrase === phrase);
      if (!row) continue;
      const meta = PLATFORMS.find((p) => p.key === platform);
      const name = meta ? (zh ? meta.zh : meta.label) : platform;
      const why = own ? (snap.judged?.[phrase]?.why ?? null) : null;
      return { title: phrase.slice(0, 80), source: fromHotRow(row, platform, name, why), projectTopicId: null, scriptTopicId: null, mandatoryPoints: [] };
    }
    /* A row shown from a live read (the YouTube chart on the "live" tab) is
       in no stored list: the phrase is the topic, with no numbers claimed. */
    const meta = PLATFORMS.find((p) => p.key === platform);
    const name = meta ? (zh ? meta.zh : meta.label) : platform;
    return { title: phrase.slice(0, 80), source: { kind: "hot", label: `${name}热榜`, key: `hot:${platform}:${phrase.slice(0, 120)}`, evidence: [] }, projectTopicId: null, scriptTopicId: null, mandatoryPoints: [] };
  }

  if (ref.kind === "proposal") {
    const text = str(ref.text, 240);
    if (!text) return null;
    const title = proposalTitle(text);
    if (ref.source === "backlog") {
      const [t] = await db
        .select({ id: topics.id })
        .from(topics)
        .where(and(eq(topics.tenantId, viewer.tenantId), sql`(${topics.name} = ${title} or ${topics.nameLocal} = ${title})`))
        .limit(1);
      if (t) return topicSource(viewer.tenantId, t.id, zh);
    }
    const kind = ref.source === "audience" ? "audience" : ref.source === "backlog" ? "backlog" : "plan";
    return {
      title,
      source: { kind, label: kind === "audience" ? "观众提问" : kind === "backlog" ? "选题储备" : "今天的计划", key: `proposal:${kind}:${text.slice(0, 120)}`, why: kind === "audience" ? `观众在评论里问：「${title}」` : null },
      projectTopicId: null,
      scriptTopicId: null,
      mandatoryPoints: [],
    };
  }

  return null;
}

/**
 * The project already started from this topic, if any: by the topic or idea
 * id, or by the snapshot's key. Choosing the same thing twice opens the same
 * project rather than a second copy of it.
 *
 * Only a project this person may see: somebody else's private project on
 * the same topic is theirs, and handing its id back would start a draft in
 * (and send the person to) a project they cannot open.
 */
export async function projectForTopic(viewer: Viewer, by: { topicId?: string | null; key?: string | null; title?: string | null; kind?: string | null }) {
  const core = by.title ? titleCore(by.title) : "";
  const conds = [
    by.topicId ? eq(workProjects.topicId, by.topicId) : null,
    by.key ? sql`(${workProjects.source} ->> 'key') = ${by.key}` : null,
    /* Projects started before snapshots had keys (from a brief's signal or
       a pick) are found by their title and kind, so the same signal pressed
       again does not make a second one. By the title's words only: the live
       digest project is "X：Y" where its signal is "“X”：Y". */
    core.length >= 4 && by.kind
      ? sql`(left(regexp_replace(${workProjects.title}, ${TITLE_NOISE}, '', 'g'), 40) = ${core} and (${workProjects.source} ->> 'kind') = ${by.kind} and (${workProjects.source} ->> 'key') is null)`
      : null,
  ].filter((c): c is NonNullable<typeof c> => c !== null);
  if (!conds.length) return null;
  const [row] = await db
    .select({ id: workProjects.id, title: workProjects.title, scriptId: workProjects.scriptId, channelId: workProjects.channelId, source: workProjects.source })
    .from(workProjects)
    /* The alternatives in one bracket. Joined bare with " or " they sat
       beside the tenant, deleted and visibility tests under one "and"
       (drizzle's `and` does not bracket its parts), and a key or title
       match in any studio's project, deleted or private, came back. */
    .where(and(eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), visibleTo(viewer), sql`(${sql.join(conds.map((c) => sql`(${c})`), sql` or `)})`))
    .orderBy(workProjects.createdAt)
    .limit(1);
  return row ?? null;
}

/**
 * Mark a project's draft as being written (an ISO time) or no longer (null).
 * A jsonb merge, so nothing else in the snapshot is touched.
 */
export async function setProjectWriting(projectId: string, at: string | null): Promise<void> {
  const patch = JSON.stringify({ writing: at ? { at } : null });
  await db
    .update(workProjects)
    .set({ source: sql`coalesce(${workProjects.source}, '{}'::jsonb) || ${patch}::jsonb` })
    .where(eq(workProjects.id, projectId));
}

/** The live project a script belongs to, other than `exceptProjectId`. */
export async function otherProjectWithScript(tenantId: string, scriptId: string, exceptProjectId: string) {
  const [row] = await db
    .select({ id: workProjects.id, title: workProjects.title })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, tenantId), isNull(workProjects.deletedAt), eq(workProjects.scriptId, scriptId), sql`${workProjects.id} <> ${exceptProjectId}`))
    .limit(1);
  return row ?? null;
}

/** Scripts that belong to a live project, so pickers can leave them out. */
export async function scriptsInProjects(tenantId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ scriptId: workProjects.scriptId, id: workProjects.id })
    .from(workProjects)
    .where(and(eq(workProjects.tenantId, tenantId), isNull(workProjects.deletedAt), sql`${workProjects.scriptId} is not null`));
  return new Map(rows.map((r) => [r.scriptId as string, r.id]));
}

/** One project this person may see, with what starting work on it needs. */
export async function visibleProject(viewer: Viewer, id: string) {
  const [row] = await db
    .select({ id: workProjects.id, title: workProjects.title, brief: workProjects.brief, scriptId: workProjects.scriptId, channelId: workProjects.channelId, videoProjectId: workProjects.videoProjectId, source: workProjects.source, topicId: workProjects.topicId })
    .from(workProjects)
    .where(and(eq(workProjects.id, id), eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt), visibleTo(viewer)))
    .limit(1);
  return row ?? null;
}

/**
 * How many beats a script has, and whether it is locked.
 *
 * The subquery names the outer table itself: in a one-table select drizzle
 * writes columns unqualified, and an unqualified "id" inside the subquery
 * would be the beat's own id.
 */
export async function scriptState(tenantId: string, scriptId: string) {
  const [row] = await db
    .select({ locked: scripts.lockedVersion, beats: sql<number>`(select count(*)::int from script_beats b where b.script_id = "scripts"."id")` })
    .from(scripts)
    .where(and(eq(scripts.id, scriptId), eq(scripts.tenantId, tenantId), isNull(scripts.deletedAt)))
    .limit(1);
  return row ? { beats: Number(row.beats), locked: row.locked !== null } : null;
}

/**
 * The project chat's description, rebuilt after its topic changed: the
 * same rules `createWorkProject` writes, with the new topic's lines.
 */
export async function rewriteChannelTopic(projectId: string): Promise<void> {
  const [p] = await db
    .select({ title: workProjects.title, brief: workProjects.brief, source: workProjects.source, scriptId: workProjects.scriptId, videoProjectId: workProjects.videoProjectId, channelId: workProjects.channelId })
    .from(workProjects)
    .where(eq(workProjects.id, projectId))
    .limit(1);
  if (!p) return;
  const note = channelNote(p.source as ProjectSource | null, p.brief);
  const topic = [
    `这是项目《${p.title}》的对话，只谈这个项目。`,
    `脚本：${p.scriptId}（/script/${p.scriptId}）。视频项目：${p.videoProjectId}（/video?project=${p.videoProjectId}）。`,
    "写脚本就写进这个脚本；剪辑、找素材、渲染都用这个视频项目。不要新建别的。",
    note ? `选题：${note}` : "",
  ]
    .filter(Boolean)
    .join("");
  await db.update(chatChannels).set({ topic }).where(eq(chatChannels.id, p.channelId));
}

/**
 * `visibleTo` for queries outside this file that list projects (the Script
 * module's topics queue): the same rule the sidebar and the project page
 * use, so a private project never shows up in someone else's list.
 */
export function projectsVisibleTo(viewer: Viewer) {
  return visibleTo(viewer);
}
