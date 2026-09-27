import { answerFilmOrigin } from "@/lib/agents/film-origin";
import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatMembers } from "@/lib/db/schema";
import { agentViewer, ensureAgentChannel, postAsAgent } from "@/lib/agents";
import type { AgentKey } from "@/lib/agents/catalog";
import { postMessage } from "@/lib/chat/service";
import { clock } from "@/lib/video/length";

/**
 * The employees say what they are doing, while they do it.
 *
 * A render used to be a spinner on one person's screen and a row in a queue
 * nobody opens. The rest of the studio saw nothing until the file appeared,
 * and #制作 was silent for the twenty minutes the work actually took — which
 * is the opposite of what "AI employees" should feel like. So the employee
 * whose job it is says so: 剪辑师 starts a render and says it has started,
 * finishes and says what came out, fails and says why.
 *
 * Only the jobs a person is waiting on, and only in the studio's own words.
 * The plumbing — posters, proxies, peaks, feed refreshes — stays quiet, or
 * the channel becomes a log file with avatars. Retried attempts do not say
 * "starting" twice.
 */
type Job = {
  id: string;
  tenantId: string;
  type: string;
  attempts: number;
  /** How many attempts the queue gives it (`JobRow.maxAttempts`); a failed
   *  attempt below this is retried after a backoff. */
  maxAttempts?: number;
  payload: Record<string, unknown> | null;
};

const SPEAKS: Record<string, AgentKey> = {
  "video.export": "video",
  "video.direct": "video",
  "video.autoedit": "video",
};

async function projectTitle(job: Job): Promise<string | null> {
  const payload = job.payload ?? {};
  try {
    if (typeof payload.exportId === "string") {
      const { rows } = await db.execute<{ title: string }>(sql`
        select p.title from video_exports e join video_projects p on p.id = e.project_id where e.id = ${payload.exportId} limit 1
      `);
      return rows[0]?.title ?? null;
    }
    if (typeof payload.projectId === "string") {
      const { rows } = await db.execute<{ title: string }>(sql`
        select title from video_projects where id = ${payload.projectId} limit 1
      `);
      return rows[0]?.title ?? null;
    }
  } catch {
    // A missing title is not a reason to say nothing.
  }
  return null;
}

/** The video project a job is about: named in its payload, or through its export. */
async function videoProjectOf(job: Job): Promise<string | null> {
  const payload = job.payload ?? {};
  if (typeof payload.projectId === "string") return payload.projectId;
  if (typeof payload.exportId !== "string") return null;
  try {
    const { rows } = await db.execute<{ project_id: string }>(sql`select project_id from video_exports where id = ${payload.exportId} limit 1`);
    return rows[0]?.project_id ?? null;
  } catch {
    return null;
  }
}

/**
 * A finished render, for the "渲染好了" line: what came out, and the ids the
 * chat's video card and the employees' `read_channel` name it by.
 */
type Rendered = { exportId: string; fileId: string | null; aspect: string; durationMs: number | null; sizeBytes: number | null };

async function renderOf(exportId: string | null | undefined): Promise<Rendered | null> {
  if (typeof exportId !== "string") return null;
  try {
    const { rows } = await db.execute<{ id: string; file_id: string | null; aspect: string; duration_ms: number | null; size_bytes: number | string | null }>(sql`
      select id, file_id, aspect, duration_ms, size_bytes from video_exports where id = ${exportId} and state = 'done' limit 1
    `);
    const r = rows[0];
    return r ? { exportId: r.id, fileId: r.file_id, aspect: r.aspect, durationMs: r.duration_ms, sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes) } : null;
  } catch {
    return null;
  }
}

/** The project page a video project belongs to, for "打开项目". */
async function workProjectOf(videoProjectId: string | null): Promise<string | null> {
  return (await workProjectRowOf(videoProjectId))?.id ?? null;
}

/** The project, with its own chat: where the film's outcome is said as well. */
async function workProjectRowOf(videoProjectId: string | null): Promise<{ id: string; title: string; channelId: string } | null> {
  if (!videoProjectId) return null;
  try {
    const { rows } = await db.execute<{ id: string; title: string; channel_id: string }>(
      sql`select id, title, channel_id from work_projects where video_project_id = ${videoProjectId} and deleted_at is null order by created_at desc limit 1`,
    );
    const r = rows[0];
    return r ? { id: r.id, title: r.title, channelId: r.channel_id } : null;
  } catch {
    return null;
  }
}

/** "9:16 · 2:31 · 48 MB" — what a render came out as, in the line. */
function renderFacts(r: Rendered): string {
  const mb = r.sizeBytes ? `${(r.sizeBytes / 1_048_576).toFixed(r.sizeBytes < 10 * 1_048_576 ? 1 : 0)} MB` : null;
  return [r.aspect, r.durationMs ? clock(r.durationMs) : null, mb].filter(Boolean).join(" · ");
}

async function say(job: Job, phase: "start" | "done" | "failed", text: string, rendered: Rendered | null = null) {
  const who = SPEAKS[job.type];
  if (!who) return;
  try {
    /* "开始渲染…" carries the job, so the chat draws a live chip under it
       (state and percent, `/api/chat/job`) and an "打开项目" button, instead
       of twenty minutes of the same sentence. "渲染好了" carries the render
       itself (`meta.render`: the export and its file), so the chat draws
       the video card under it — the poster that plays, 下载, 打开项目 —
       and an employee reading the channel can name the file. */
    const videoProjectId = await videoProjectOf(job);
    const meta = {
      narration: { jobId: job.id, type: job.type, phase },
      ...(videoProjectId ? { job: { videoProjectId } } : {}),
      ...(rendered ? { render: { exportId: rendered.exportId, fileId: rendered.fileId, aspect: rendered.aspect, durationMs: rendered.durationMs, sizeBytes: rendered.sizeBytes } } : {}),
    };
    await postAsAgent(job.tenantId, who, "production", text, meta);

    /*
     * And in the project's own chat, when the film is out or stopped.
     *
     * The person waiting for the film is in the project — its page, its
     * chat, Home's card of it — not in #制作. The 渲染好了 line with the
     * card, and the 没成功 line, go there too, so the film lands where it
     * was asked for; #制作 keeps the studio-wide record. The start line stays
     * in #制作 alone: the project's chat has 剪辑师's own "开始剪" and a live
     * row following the worker. Skipped when the project's chat is #制作
     * itself.
     */
    /* A failed attempt the queue will try again is not the outcome yet: the
       project's chat hears only the last one (the live row says "正在自动重试"
       meanwhile), or a clip that cannot be read posts "没成功" three times. */
    const final = phase !== "failed" || job.maxAttempts === undefined || job.attempts >= job.maxAttempts;
    if (phase !== "start" && final && videoProjectId) {
      await answerFilmOrigin(videoProjectId, text, rendered?.fileId ?? null).catch((err) => console.error("[narrate] could not answer the chat that asked", err));
    }
    if (phase !== "start" && final) {
      const wp = await workProjectRowOf(videoProjectId);
      if (wp) {
        const production = await ensureAgentChannel(job.tenantId, "production");
        if (wp.channelId !== production) {
          const editor = await agentViewer(job.tenantId, who);
          await db.insert(chatMembers).values({ channelId: wp.channelId, userId: editor.id }).onConflictDoNothing();
          await postMessage(editor, wp.channelId, text, { ...meta, agent: who, project: { id: wp.id, title: wp.title } });
        }
      }
    }
  } catch (err) {
    // Narration must never fail the job it is narrating.
    console.error("[narrate] could not post", err);
  }
}

export async function narrateStart(job: Job): Promise<void> {
  if (!SPEAKS[job.type] || job.attempts > 0) return;
  // The quick one does not announce itself; by the time anybody read the
  // line it would be done.
  if (job.type === "video.autoedit") return;
  const title = await projectTitle(job);
  const name = title ? `《${title}》` : "这条片";
  const aspect = typeof job.payload?.aspect === "string" ? `（${job.payload.aspect}）` : "";
  await say(
    job,
    "start",
    job.type === "video.export"
      ? `开始渲染${name}${aspect}，好了我在这里说一声。`
      : `开始做${name}：先转写，再粗剪，再配图形，最后渲染。中间有进展我会说。`,
  );
}

export async function narrateDone(job: Job, result: unknown): Promise<void> {
  if (!SPEAKS[job.type]) return;
  const title = await projectTitle(job);
  const name = title ? `《${title}》` : "这条片";
  const r = (result ?? {}) as Record<string, unknown>;
  /* The project's own page when it has one, else the editor: "打开项目"
     used to point at the editor alone, and an export job (which names only
     its export) had no link at all. */
  const videoProjectId = await videoProjectOf(job);
  const wp = await workProjectOf(videoProjectId);
  const href = wp ? `/projects/${wp}` : videoProjectId ? `/video?project=${videoProjectId}` : null;
  const link = href ? ` [打开项目](${href})` : "";

  if (job.type === "video.export") {
    /* What came out, and the card to watch and download it right here. */
    const rendered = await renderOf(typeof job.payload?.exportId === "string" ? job.payload.exportId : null);
    const facts = rendered ? renderFacts(rendered) : "";
    await say(job, "done", `${name}渲染好了${facts ? `（${facts}）` : ""}，下面可以直接看、下载。${link}`, rendered);
    return;
  }
  if (job.type === "video.autoedit") {
    const cuts = typeof r.cuts === "number" ? `${r.cuts} 段` : null;
    const length = typeof r.lengthMs === "number" ? clock(r.lengthMs) : null;
    const target = typeof r.targetMs === "number" ? clock(r.targetMs) : null;
    const note = typeof r.note === "string" && r.note ? `\n${r.note}` : "";
    await say(
      job,
      "done",
      `${name}的粗剪好了：${[cuts, length ? `成片 ${length}` : null, target ? `目标 ${target}` : null].filter(Boolean).join("，")}。看一眼，不对我再改。${link}${note}`,
    );
    return;
  }
  const bits = [
    typeof r.cuts === "number" ? `${r.cuts} 段` : null,
    typeof r.graphics === "number" ? `${r.graphics} 个图形` : null,
    typeof r.pictures === "number" && r.pictures ? `${r.pictures} 张配图` : null,
  ].filter(Boolean);
  /* The director rendered at the end, or was asked not to. Rendered: the
     card is under the line. Not rendered: say so, and where the button is —
     "整条做好了" with nothing to watch read as a video that never came. */
  const rendered = await renderOf(typeof r.exportId === "string" ? r.exportId : null);
  const tail = rendered ? `已渲染（${renderFacts(rendered)}），下面可以直接看、下载。` : "还没渲染：到项目页按「渲染 9:16」就出成片。";
  await say(job, "done", `${name}整条做好了${bits.length ? `：${bits.join("，")}` : ""}。${tail}${link}`, rendered);
}

export async function narrateFailed(job: Job, err: unknown): Promise<void> {
  if (!SPEAKS[job.type]) return;
  const title = await projectTitle(job);
  const name = title ? `《${title}》` : "这条片";
  const why = (err instanceof Error ? err.message : String(err)).slice(0, 200);
  const what = job.type === "video.export" ? "渲染" : job.type === "video.autoedit" ? "粗剪" : "制作";
  await say(job, "failed", `${name}的${what}没成功：${why}\n我不会自己重试；改好了再让我来一次。`);
}
