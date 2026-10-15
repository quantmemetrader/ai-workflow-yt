import "server-only";
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentRuns, files, jobs, videoExports, workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { sweepRuns } from "./runs";

/**
 * Every piece of work in flight, as one list (15 Oct: "a good-looking loading bar of how much is done and
 * how much time is left, for all the tasks — script, video, everything — with a small line about what it is
 * actually doing, for all agents").
 *
 * Two sources: the worker's jobs (drafts, cuts, renders, voices, pictures…) and the AI employees' turns
 * (`agent_runs`). Progress is the job's own when it reports one; otherwise it is estimated from how long
 * the same kind of work took here before, and marked as an estimate. Time left comes from both.
 */
export type WorkItem = {
  id: string;
  kind: "job" | "agent";
  /** AgentKey ("script", "video"…), "assistant", or null for plumbing nobody "is". */
  agent: string | null;
  /** What kind of work, in a word or two. */
  label: string;
  labelEn: string;
  /** What it is about: the project, the prompt, the chat. */
  title: string;
  /** The step it is on right now, in plain words. */
  stage: string;
  status: "queued" | "running" | "done" | "failed";
  /** 0–1. */
  progress: number;
  /** The progress is worked out from the usual duration, not reported by the work itself. */
  estimated: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** Milliseconds left, or null when it is past its usual time and there is no honest number. */
  etaMs: number | null;
  /** The usual total, for "通常约 2 分钟". */
  typicalMs: number | null;
  /** Jobs ahead of this one in the queue. */
  ahead: number;
  error: string | null;
  href: string | null;
};

type Kind = { agent: string | null; zh: string; en: string; stage: string; typical: number };
const KINDS: Record<string, Kind> = {
  "script.draft": { agent: "script", zh: "写初稿", en: "First draft", stage: "正在收集资料", typical: 150_000 },
  "video.direct": { agent: "video", zh: "剪辑成片", en: "Editing the video", stage: "正在剪辑", typical: 480_000 },
  "video.export": { agent: "video", zh: "渲染", en: "Rendering", stage: "正在渲染", typical: 180_000 },
  "video.autoedit": { agent: "video", zh: "自动粗剪", en: "Rough cut", stage: "正在粗剪", typical: 240_000 },
  "video.autoHost": { agent: "video", zh: "整条视频", en: "Whole video", stage: "正在配音", typical: 600_000 },
  "media.talkingHost": { agent: "video", zh: "主持人口播", en: "Talking host", stage: "正在对口型", typical: 240_000 },
  "media.generatePicture": { agent: "video", zh: "AI 生成图片", en: "AI picture", stage: "正在生成图片", typical: 130_000 },
  "media.generateVideo": { agent: "video", zh: "AI 动态镜头", en: "AI motion clip", stage: "正在生成镜头", typical: 180_000 },
  "media.importLink": { agent: null, zh: "导入链接素材", en: "Importing a link", stage: "正在下载", typical: 60_000 },
  "video.voiceover": { agent: "video", zh: "配音", en: "Voice-over", stage: "正在配音", typical: 40_000 },
  "video.transcribe": { agent: "video", zh: "转写字幕", en: "Transcribing", stage: "正在听写", typical: 90_000 },
  "video.capcut": { agent: "video", zh: "导出剪映草稿", en: "CapCut export", stage: "正在打包素材", typical: 120_000 },
  "video.cover": { agent: "video", zh: "做封面", en: "Covers", stage: "正在做封面", typical: 90_000 },
  "agent.publish-copy": { agent: "article", zh: "写发布文案", en: "Post copy", stage: "正在写文案", typical: 40_000 },
  "agent.footage": { agent: "planning", zh: "看素材出点子", en: "Reading the footage", stage: "正在看素材", typical: 40_000 },
  "agent.plan-followup": { agent: "planning", zh: "分派今日任务", en: "Handing out the plan", stage: "正在分派", typical: 60_000 },
  "publish.send": { agent: null, zh: "发布", en: "Publishing", stage: "正在发布", typical: 30_000 },
  "files.text": { agent: null, zh: "读取文件", en: "Reading a file", stage: "正在读取内容", typical: 20_000 },
};
export const TRACKED_TYPES = Object.keys(KINDS);

const AGENT_TITLES: Record<string, [string, string]> = {
  assistant: ["回答问题", "Answering"],
  research: ["查资料", "Research"],
  planning: ["策划", "Planning"],
  script: ["写稿", "Writing"],
  video: ["剪辑", "Editing"],
  article: ["写文章", "Article"],
  legal: ["法务", "Legal"],
  finance: ["财务", "Finance"],
};

const isAdmin = (v: Viewer) => v.role === "owner" || v.role === "admin";

function clip(s: unknown, n = 40): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, n) : "";
}

/** Time left: the work's own rate when it reports progress, the usual duration otherwise, both when there are both. */
function estimate(elapsed: number, typical: number | null, reported: number | null, milestone = false): { progress: number; estimated: boolean; etaMs: number | null } {
  const t = typical && typical > 0 ? typical : null;
  /* A job that only reports where it is (收集资料 0.05 → 写初稿 0.3 → 润色 0.82) sat at 30% for two minutes and its
     time left was worked out from the jump to 30% in the first seconds (15 Oct test: "约剩 1 分钟" for a 2 min 17 s draft).
     Its stages are a floor; between them the bar moves with the usual duration. */
  if (milestone && t) {
    const p = Math.min(0.95, Math.max(reported ?? 0, elapsed / t, 0.03));
    const left = t - elapsed;
    return { progress: p, estimated: true, etaMs: left > 3_000 ? Math.round(left) : null };
  }
  if (reported != null && reported > 0.02) {
    const byRate = (elapsed * (1 - reported)) / reported;
    const byUsual = t ? t - elapsed : null;
    const eta = byUsual != null && byUsual > 0 ? (byRate + byUsual) / 2 : byRate;
    return { progress: reported, estimated: false, etaMs: Math.max(3_000, Math.round(eta)) };
  }
  if (!t) return { progress: 0.05, estimated: true, etaMs: null };
  const p = Math.min(0.95, Math.max(0.03, elapsed / t));
  const left = t - elapsed;
  return { progress: p, estimated: true, etaMs: left > 3_000 ? Math.round(left) : null };
}

export async function listWork(viewer: Viewer, opts: { recentMinutes?: number; limit?: number } = {}): Promise<WorkItem[]> {
  const recent = new Date(Date.now() - (opts.recentMinutes ?? 10) * 60_000);
  const now = Date.now();
  void sweepRuns(viewer.tenantId);

  const mine = isAdmin(viewer) ? undefined : or(eq(jobs.createdBy, viewer.id), sql`${jobs.payload}->>'viewerId' = ${viewer.id}`);
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.tenantId, viewer.tenantId),
        inArray(jobs.type, TRACKED_TYPES),
        or(inArray(jobs.status, ["queued", "running"]), gt(jobs.finishedAt, recent)),
        mine,
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(opts.limit ?? 30);

  /* How long each kind usually takes here (median of the last month's successes). */
  const typical = new Map<string, number>();
  if (rows.length) {
    const t = await db
      .select({ type: jobs.type, ms: sql<number>`percentile_cont(0.5) within group (order by extract(epoch from (${jobs.finishedAt} - ${jobs.startedAt})) * 1000)` })
      .from(jobs)
      .where(and(eq(jobs.tenantId, viewer.tenantId), eq(jobs.status, "succeeded"), inArray(jobs.type, [...new Set(rows.map((r) => r.type))]), gt(jobs.finishedAt, new Date(now - 30 * 86_400_000))))
      .groupBy(jobs.type)
      .catch(() => [] as { type: string; ms: number }[]);
    for (const r of t) if (Number(r.ms) > 1000) typical.set(r.type, Number(r.ms));
  }

  /* What each job is about. */
  const payloadOf = (r: (typeof rows)[number]) => (r.payload ?? {}) as Record<string, unknown>;
  const exportIds = rows.map((r) => payloadOf(r).exportId).filter((x): x is string => typeof x === "string");
  const exportsById = new Map<string, { projectId: string; progress: number }>();
  if (exportIds.length) {
    for (const e of await db.select({ id: videoExports.id, projectId: videoExports.projectId, progress: videoExports.progress }).from(videoExports).where(inArray(videoExports.id, exportIds)))
      exportsById.set(e.id, { projectId: e.projectId, progress: e.progress });
  }
  const projectKeyOf = (r: (typeof rows)[number]): string | null => {
    const p = payloadOf(r);
    const input = (p.input ?? {}) as Record<string, unknown>;
    const ex = typeof p.exportId === "string" ? exportsById.get(p.exportId) : undefined;
    const v = p.projectId ?? input.projectId ?? (r.objectType === "project" ? r.objectId : null) ?? ex?.projectId ?? null;
    return typeof v === "string" ? v : null;
  };
  const keys = [...new Set(rows.map(projectKeyOf).filter((x): x is string => Boolean(x)))];
  const projects = keys.length
    ? await db
        .select({ id: workProjects.id, title: workProjects.title, videoProjectId: workProjects.videoProjectId })
        .from(workProjects)
        .where(and(eq(workProjects.tenantId, viewer.tenantId), or(inArray(workProjects.id, keys), inArray(workProjects.videoProjectId, keys))))
    : [];
  const projectOf = (k: string | null) => (k ? projects.find((p) => p.id === k || p.videoProjectId === k) ?? null : null);
  const fileIds = rows.filter((r) => r.type === "files.text").map((r) => payloadOf(r).fileId).filter((x): x is string => typeof x === "string");
  const fileNames = new Map<string, string>();
  if (fileIds.length) for (const f of await db.select({ id: files.id, name: files.name }).from(files).where(inArray(files.id, fileIds))) fileNames.set(f.id, f.name);

  const queued = rows.filter((r) => r.status === "queued").sort((a, b) => +a.createdAt - +b.createdAt);
  const items: WorkItem[] = rows.map((r) => {
    const k = KINDS[r.type];
    const p = payloadOf(r);
    const project = projectOf(projectKeyOf(r));
    const title =
      (project?.title ??
        (r.type === "files.text" ? fileNames.get(String(p.fileId)) ?? "文件" : "")) ||
      clip(p.prompt) ||
      clip(p.text) ||
      clip(((p.input ?? {}) as Record<string, unknown>).req && (((p.input as Record<string, unknown>).req as Record<string, unknown>).subject)) ||
      k.zh;
    const status: WorkItem["status"] = r.status === "queued" ? "queued" : r.status === "running" ? "running" : r.status === "succeeded" ? "done" : "failed";
    const started = r.startedAt ? +r.startedAt : null;
    const usual = typical.get(r.type) ?? k.typical;
    const ex = typeof p.exportId === "string" ? exportsById.get(p.exportId) : undefined;
    const reported = ex ? (ex.progress > 1 ? ex.progress / 100 : ex.progress) : r.progress > 0 ? r.progress : null;
    let progress = 0;
    let estimated = false;
    let etaMs: number | null = null;
    let ahead = 0;
    if (status === "running" && started) ({ progress, estimated, etaMs } = estimate(now - started, usual, reported, !ex && Boolean(r.stage)));
    else if (status === "queued") {
      ahead = queued.findIndex((q) => q.id === r.id);
      etaMs = usual * (1 + Math.max(0, ahead));
    } else if (status === "done") progress = 1;
    const href = project ? (r.type === "script.draft" ? `/projects/${project.id}/script` : r.type.startsWith("video.") || r.type.startsWith("agent.") ? `/projects/${project.id}/edit` : `/projects/${project.id}`) : r.type.startsWith("media.") ? "/studio" : r.type === "files.text" ? "/files" : null;
    return {
      id: r.id,
      kind: "job",
      agent: k.agent,
      label: k.zh,
      labelEn: k.en,
      title,
      stage: status === "queued" ? (r.attempts > 0 ? `上次没成功，等着重试（第 ${r.attempts + 1} 次）${r.error ? `：${String(r.error).slice(0, 40)}` : ""}` : ahead > 0 ? `排队中，前面还有 ${ahead} 个` : "排队中，马上开始") : status === "done" ? "完成" : status === "failed" ? "没做成" : r.stage || k.stage,
      status,
      progress,
      estimated,
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      etaMs,
      typicalMs: usual,
      ahead,
      error: status === "failed" ? (r.error ?? "").slice(0, 200) || null : null,
      href,
    };
  });

  /* The AI employees' own turns. */
  const runs = await db
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.tenantId, viewer.tenantId),
        or(eq(agentRuns.status, "running"), gt(agentRuns.finishedAt, new Date(now - 3 * 60_000))),
        isAdmin(viewer) ? undefined : eq(agentRuns.userId, viewer.id),
      ),
    )
    .orderBy(desc(agentRuns.startedAt))
    .limit(20)
    .catch(() => [] as (typeof agentRuns.$inferSelect)[]);
  const usualRun = new Map<string, number>();
  if (runs.length) {
    const t = await db
      .select({ agent: agentRuns.agent, ms: sql<number>`percentile_cont(0.5) within group (order by extract(epoch from (${agentRuns.finishedAt} - ${agentRuns.startedAt})) * 1000)` })
      .from(agentRuns)
      .where(and(eq(agentRuns.tenantId, viewer.tenantId), eq(agentRuns.status, "done"), gt(agentRuns.startedAt, new Date(now - 14 * 86_400_000))))
      .groupBy(agentRuns.agent)
      .catch(() => [] as { agent: string; ms: number }[]);
    for (const r of t) if (Number(r.ms) > 2000) usualRun.set(r.agent, Number(r.ms));
  }
  for (const r of runs) {
    const status: WorkItem["status"] = r.status === "running" ? "running" : r.status === "done" ? "done" : "failed";
    const usual = usualRun.get(r.agent) ?? 25_000;
    const e = status === "running" ? estimate(now - +r.startedAt, usual, null) : { progress: status === "done" ? 1 : 0, estimated: false, etaMs: null };
    const names = AGENT_TITLES[r.agent] ?? AGENT_TITLES.assistant;
    items.push({
      id: r.id,
      kind: "agent",
      agent: r.agent,
      label: names[0],
      labelEn: names[1],
      title: r.title || names[0],
      stage: status === "running" ? `${r.stage || "正在思考"}${r.steps ? ` · 第 ${r.steps} 步` : ""}` : status === "done" ? "已回答" : r.status === "stopped" ? "已停止" : "没答完",
      status,
      progress: e.progress,
      estimated: e.estimated,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      etaMs: e.etaMs,
      typicalMs: usual,
      ahead: 0,
      error: null,
      href: r.href,
    });
  }

  const order = { running: 0, queued: 1, failed: 2, done: 3 } as const;
  return items.sort((a, b) => order[a.status] - order[b.status] || +(b.startedAt ? new Date(b.startedAt) : 0) - +(a.startedAt ? new Date(a.startedAt) : 0));
}

/** The same list as plain lines, for an employee asked "做好了吗 / 开始了吗" (the `work_status` tool). */
export async function workStatusText(viewer: Viewer): Promise<string> {
  const all = await listWork(viewer, { recentMinutes: 24 * 60, limit: 40 });
  if (!all.length) return "Nothing is running, queued or finished in the last 24 hours for this person. If something was promised earlier, it was never started: say so plainly and offer to start it now.";
  const min = (ms: number | null) => (ms == null ? "past its usual time" : ms < 60_000 ? `about ${Math.max(5, Math.round(ms / 1000))} s left` : `about ${Math.round(ms / 60_000)} min left`);
  return [
    "Work in the last 24 hours (newest first). Only what is listed here exists; anything not here was never started.",
    ...all.map((w) => {
      const pct = Math.round(w.progress * 100);
      const state = w.status === "running" ? `running ${pct}%${w.estimated ? " (estimated)" : ""}, ${min(w.etaMs)}, now: ${w.stage}` : w.status === "queued" ? `queued (${w.ahead} ahead)` : w.status === "done" ? `finished ${w.finishedAt?.slice(11, 16) ?? ""} UTC` : `FAILED: ${w.error ?? w.stage}`;
      return `- ${w.label} · ${w.title} · ${state}${w.href ? ` · ${w.href}` : ""}`;
    }),
  ].join("\n");
}
