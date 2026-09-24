import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { postAsAgent } from "@/lib/agents";
import type { AgentKey } from "@/lib/agents/catalog";
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

async function say(job: Job, phase: "start" | "done" | "failed", text: string) {
  const who = SPEAKS[job.type];
  if (!who) return;
  try {
    await postAsAgent(job.tenantId, who, "production", text, {
      narration: { jobId: job.id, type: job.type, phase },
    });
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
  const href = typeof job.payload?.projectId === "string" ? `/video?project=${job.payload.projectId}` : null;
  const link = href ? ` [打开项目](${href})` : "";

  if (job.type === "video.export") {
    await say(job, "done", `${name}渲染好了，可以在导出里下载了。${link}`);
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
  await say(job, "done", `${name}整条做好了${bits.length ? `：${bits.join("，")}` : ""}。${link}`);
}

export async function narrateFailed(job: Job, err: unknown): Promise<void> {
  if (!SPEAKS[job.type]) return;
  const title = await projectTitle(job);
  const name = title ? `《${title}》` : "这条片";
  const why = (err instanceof Error ? err.message : String(err)).slice(0, 200);
  const what = job.type === "video.export" ? "渲染" : job.type === "video.autoedit" ? "粗剪" : "制作";
  await say(job, "failed", `${name}的${what}没成功：${why}\n我不会自己重试；改好了再让我来一次。`);
}
