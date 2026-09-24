import "server-only";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, scripts, timelineItems, videoClips, videoExports, videoProjects, workProjects } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import type { Viewer } from "@/lib/auth/types";
import { createScript } from "@/lib/script/service";
import { createProject as createVideoProject } from "@/lib/video/service";
import { channelThread, createChannel } from "@/lib/chat/service";
import { agentKeyFromEmail, type AgentKey } from "@/lib/agents/catalog";
import { audit } from "@/lib/audit";
import { share } from "@/lib/authz/rebac";

export type WorkProjectRow = {
  id: string;
  title: string;
  status: string;
  mode: string;
  updatedAt: string;
  scriptId: string | null;
  videoProjectId: string | null;
  channelSlug: string | null;
};

/**
 * Start a project: its chat, its script and its video project, together.
 *
 * All three exist from the first moment so every employee knows where to
 * put its work: the chat's description names the script and the video
 * project, and the channel description is read with every question.
 */
export async function createWorkProject(
  viewer: Viewer,
  input: { title: string; brief?: string | null; mode?: string; source?: { kind: string; label?: string; url?: string | null; evidence?: unknown[] } | null },
): Promise<{ id: string; channelSlug: string }> {
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 80) || "新项目";
  const id = newId("wp");
  const scriptId = await createScript(viewer, { title, angle: input.brief ?? null });
  const videoProjectId = await createVideoProject(viewer, title, scriptId);
  const topic = [
    `这是项目《${title}》的对话，只谈这个项目。`,
    `脚本：${scriptId}（/script/${scriptId}）。视频项目：${videoProjectId}（/video?project=${videoProjectId}）。`,
    "写脚本就写进这个脚本；剪辑、找素材、渲染都用这个视频项目。不要新建别的。",
    input.brief ? `起因：${input.brief.slice(0, 200)}` : "",
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
    channelId: channel.id,
    scriptId,
    videoProjectId,
    createdBy: viewer.id,
  });
  await audit(viewer, "project.create", { module: "chat", objectType: "project", objectId: id, meta: { title, mode: input.mode ?? "full" } });
  return { id, channelSlug: channel.slug ?? "" };
}

export async function listWorkProjects(viewer: Viewer, limit = 40): Promise<WorkProjectRow[]> {
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
    })
    .from(workProjects)
    .leftJoin(chatChannels, eq(chatChannels.id, workProjects.channelId))
    .where(and(eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt)))
    .orderBy(desc(sql`greatest(${workProjects.updatedAt}, coalesce(${chatChannels.lastMessageAt}, ${workProjects.updatedAt}))`))
    .limit(limit);
  return rows.map((r) => ({ ...r, updatedAt: (r.lastMessageAt && r.lastMessageAt > r.updatedAt ? r.lastMessageAt : r.updatedAt).toISOString() }));
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
  source: { kind: string; label?: string; url?: string | null } | null;
  createdAt: string;
  channel: { id: string; slug: string; name: string };
  script: { id: string; title: string; status: string; version: number } | null;
  video: { id: string; title: string; clips: number; items: number } | null;
  render: { fileId: string | null; state: string; progress: number; at: string } | null;
  steps: ProjectStep[];
  messages: { id: string; author: string; agent: AgentKey | null; body: string; at: string; actions: import("@/lib/agents/cards").CardAction[]; done: import("@/lib/agents/cards").CardDone | null }[];
};

export async function workProjectDetail(viewer: Viewer, id: string, zh: boolean): Promise<ProjectDetail | null> {
  const [p] = await db
    .select()
    .from(workProjects)
    .where(and(eq(workProjects.id, id), eq(workProjects.tenantId, viewer.tenantId), isNull(workProjects.deletedAt)))
    .limit(1);
  if (!p) return null;
  const [ch] = await db.select({ id: chatChannels.id, slug: chatChannels.slug, name: chatChannels.name }).from(chatChannels).where(eq(chatChannels.id, p.channelId)).limit(1);
  if (!ch?.slug) return null;

  const [script] = p.scriptId
    ? await db.select({ id: scripts.id, title: scripts.title, status: scripts.status, version: scripts.version }).from(scripts).where(and(eq(scripts.id, p.scriptId), isNull(scripts.deletedAt))).limit(1)
    : [];
  const [video] = p.videoProjectId
    ? await db.select({ id: videoProjects.id, title: videoProjects.title }).from(videoProjects).where(and(eq(videoProjects.id, p.videoProjectId), isNull(videoProjects.deletedAt))).limit(1)
    : [];
  const [[clips], [items], [render], thread] = await Promise.all([
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
    channelThread(viewer, ch.slug, 80),
  ]);

  const t = (a: string, b: string) => (zh ? a : b);
  const direct = p.mode.startsWith("direct:") ? (p.mode.slice(7) as AgentKey) : null;
  const skip = (key: ProjectStep["key"]) =>
    direct === "video" ? key === "script" || key === "clips" : direct === "article" ? key !== "deliver" && key !== "topic" : false;

  const scriptState: StepState = !script
    ? "todo"
    : script.status === "locked"
      ? "done"
      : script.status === "awaiting_approval"
        ? "you"
        : script.status === "drafting"
          ? "running"
          : "todo";
  const rendered = render?.state === "done" && render.fileId;
  const rendering = render && (render.state === "queued" || render.state === "rendering");
  const steps: ProjectStep[] = [
    { key: "topic", label: t("选题", "Topic"), owner: "research", state: "done", line: p.source?.label ?? t("你定的题", "Your topic") },
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
              ? t(`第 ${script!.version} 版草稿`, `Draft v${script!.version}`)
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
      state: p.status === "done" ? "done" : rendered ? "you" : "todo",
      line: p.status === "done" ? t("已交付", "Delivered") : rendered ? t("看成片，满意就交付", "Watch it; deliver when happy") : t("剪完之后", "After the edit"),
    },
  ];

  return {
    id: p.id,
    title: p.title,
    brief: p.brief,
    status: p.status,
    mode: p.mode,
    source: (p.source as ProjectDetail["source"]) ?? null,
    createdAt: p.createdAt.toISOString(),
    channel: { id: ch.id, slug: ch.slug, name: ch.name },
    script: script ?? null,
    video: video ? { id: video.id, title: video.title, clips: clips.n, items: items.n } : null,
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
    })),
  };
}

export async function setProjectStatus(viewer: Viewer, id: string, status: "active" | "done" | "archived") {
  await db.update(workProjects).set({ status, updatedAt: new Date() }).where(and(eq(workProjects.id, id), eq(workProjects.tenantId, viewer.tenantId)));
}

export async function touchProjects(ids: string[]) {
  if (ids.length) await db.update(workProjects).set({ updatedAt: new Date() }).where(inArray(workProjects.id, ids));
}
