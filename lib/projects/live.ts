import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { workProjects } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { viewerById } from "@/lib/auth/viewer-by-id";
import { projectsVisibleTo } from "@/lib/projects/visible";
import { STALE_WORK_ERROR, renderPercent } from "@/lib/projects/service";
import { AUTO_CUT_DELAY_MS, isRunning, liveAutoCut, type LiveProject } from "@/lib/projects/live-types";

/**
 * Where every film this person can see is right now, in one query
 * (`LiveProject`, lib/projects/live-types.ts).
 *
 * Polled by every open page every five seconds while something runs, so it
 * is one statement: the project, its director row, its latest render, and
 * — the part that keeps it honest — whether the worker still holds a job
 * for either. A director row that says "running" with no queued or running
 * `video.direct` job behind it is a worker that died under it, and it is
 * reported as failed rather than as 正在剪辑 for ever. Same for a render
 * whose `video.export` job is gone.
 *
 * Without `ids` it returns only what is worth drawing: films being made,
 * auto-cuts armed, and films that landed or failed in the last few minutes
 * (the client keeps its own two-minute window for those). With `ids`, those
 * projects whatever their state, "idle" included.
 */
type Row = {
  id: string;
  title: string;
  video_project_id: string;
  channel_slug: string | null;
  auto_cut: { on?: unknown; dueAt?: unknown; armedBy?: unknown } | null;
  vp_updated_at: string | Date | null;
  d_state: string | null;
  d_step: string | null;
  d_error: string | null;
  d_started: string | null;
  d_finished: string | null;
  d_job: boolean;
  e_id: string | null;
  e_state: string | null;
  e_progress: number | string | null;
  e_file_id: string | null;
  e_proxy_file_id: string | null;
  e_aspect: string | null;
  e_duration_ms: number | null;
  e_error: string | null;
  e_created: string | Date | null;
  e_started: string | Date | null;
  e_finished: string | Date | null;
  e_job: boolean;
};

/** A director row queued this long ago with no job behind it is stale, not
 *  just ahead of its own enqueue (the row is written before the job). */
const ENQUEUE_GRACE_MS = 30_000;

const iso = (v: string | Date | null | undefined): string | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

export async function projectsLive(viewer: Viewer, options: { ids?: string[] } = {}): Promise<LiveProject[]> {
  return (await projectsLiveWithSpent(viewer, options)).projects;
}

/** An armed auto-cut that a later start used up (`liveAutoCut`), to clear. */
export type SpentArm = { id: string; dueAt: string };

/** `projectsLive`, plus the spent arms it read past, so the poll route can
 *  clear them from their rows after its response (`clearSpentArms`). */
export async function projectsLiveWithSpent(viewer: Viewer, options: { ids?: string[] } = {}): Promise<{ projects: LiveProject[]; spent: SpentArm[] }> {
  const ids = (options.ids ?? []).filter((id) => /^wp_[0-9a-z]{10,40}$/i.test(id)).slice(0, 40);
  const byIds = ids.length > 0;
  /* ISO text against ISO text: the director's clock is written by
     `toISOString`, so a lexical compare is a time compare and nothing has
     to be cast (a malformed value would otherwise throw the whole poll). */
  const recentIso = new Date(Date.now() - 3 * 60_000).toISOString();
  const { rows } = await db.execute<Row>(sql`
    select wp.id, wp.title, wp.video_project_id, c.slug as channel_slug,
           wp.source -> 'autoCut' as auto_cut,
           vp.updated_at as vp_updated_at,
           vp.director ->> 'state' as d_state,
           vp.director ->> 'step' as d_step,
           vp.director ->> 'error' as d_error,
           vp.director ->> 'startedAt' as d_started,
           vp.director ->> 'finishedAt' as d_finished,
           exists (select 1 from jobs j where j.type = 'video.direct' and j.status in ('queued','running') and j.payload ->> 'projectId' = vp.id) as d_job,
           e.id as e_id, e.state::text as e_state, e.progress as e_progress, e.file_id as e_file_id, e.proxy_file_id as e_proxy_file_id,
           e.aspect as e_aspect, e.duration_ms as e_duration_ms, e.error as e_error,
           e.created_at as e_created, e.started_at as e_started, e.finished_at as e_finished,
           exists (select 1 from jobs j where j.type = 'video.export' and j.status in ('queued','running') and j.payload ->> 'exportId' = e.id) as e_job
      from ${workProjects} wp
      join video_projects vp on vp.id = wp.video_project_id and vp.deleted_at is null
      left join chat_channels c on c.id = wp.channel_id
      left join lateral (
        select * from video_exports x where x.project_id = vp.id order by x.created_at desc limit 1
      ) e on true
     where wp.tenant_id = ${viewer.tenantId}
       and wp.deleted_at is null
       and wp.status <> 'archived'
       and ${projectsVisibleTo(viewer)}
       and ${
         byIds
           ? sql`wp.id in (${sql.join(
               ids.map((id) => sql`${id}`),
               sql`, `,
             )})`
           : sql`(
               vp.director ->> 'state' in ('queued', 'running')
               or exists (select 1 from jobs j where j.type = 'video.direct' and j.status in ('queued','running') and j.payload ->> 'projectId' = vp.id)
               or e.state in ('queued', 'rendering')
               or (e.state = 'failed' and exists (select 1 from jobs j where j.type = 'video.export' and j.status in ('queued','running') and j.payload ->> 'exportId' = e.id))
               or e.finished_at > now() - interval '3 minutes'
               or coalesce(vp.director ->> 'finishedAt', '') > ${recentIso}
               or (wp.source -> 'autoCut' ->> 'dueAt') is not null
             )`
       }
     order by wp.updated_at desc
     limit 40
  `);

  const now = Date.now();
  const out: LiveProject[] = [];
  const spent: SpentArm[] = [];
  for (const r of rows) {
    const arm = armOf(r);
    if (arm.spent && typeof r.auto_cut?.dueAt === "string") spent.push({ id: r.id, dueAt: r.auto_cut.dueAt });
    const p = resolve(r, now, arm.dueAt);
    if (p.state !== "idle" || byIds) out.push(p);
  }
  return { projects: out, spent };
}

/** The row's armed auto-cut, with one a later start used up read as none. */
function armOf(r: Row): { dueAt: string | null; spent: boolean } {
  const dStarted = r.d_started ? Date.parse(r.d_started) : 0;
  const eCreated = r.e_created ? new Date(r.e_created).getTime() : 0;
  const lastStart = Math.max(Number.isFinite(dStarted) ? dStarted : 0, Number.isFinite(eCreated) ? eCreated : 0);
  const a = liveAutoCut({ autoCut: r.auto_cut }, lastStart);
  return { dueAt: a.dueAt, spent: a.spent };
}

/** One row, read into the state every surface shows. `dueAt` is the armed
 *  auto-cut still standing (`armOf`), not the raw one. */
function resolve(r: Row, now: number, dueAt: string | null): LiveProject {
  const base: LiveProject = {
    id: r.id,
    title: r.title,
    videoProjectId: r.video_project_id,
    channelSlug: r.channel_slug,
    state: "idle",
    step: null,
    percent: null,
    error: null,
    exportId: r.e_id,
    fileId: null,
    proxyFileId: null,
    aspect: r.e_aspect,
    durationMs: null,
    startedAt: null,
    finishedAt: null,
    dueAt,
  };
  const pct = r.e_id ? renderPercent(Number(r.e_progress ?? 0)) : null;
  const directing = r.d_state === "queued" || r.d_state === "running";
  const rendering = r.e_state === "queued" || r.e_state === "rendering";
  const eCreated = r.e_created ? new Date(r.e_created).getTime() : 0;
  const vpUpdated = r.vp_updated_at ? new Date(r.vp_updated_at).getTime() : 0;

  if (directing) {
    /* Honest: the director row says it is at work, but is anybody? A queued
       row a moment old is ahead of its own enqueue; older than that with no
       job, or "running" with no job, is a worker that died under it. */
    const fresh = r.d_state === "queued" && now - vpUpdated < ENQUEUE_GRACE_MS;
    if (!r.d_job && !fresh) {
      return { ...base, state: "failed", error: STALE_WORK_ERROR, startedAt: r.d_started, finishedAt: new Date(vpUpdated || now).toISOString() };
    }
    const onRender = r.d_step === "render" && rendering;
    return {
      ...base,
      state: r.d_state === "queued" ? "queued" : "directing",
      step: r.d_step,
      percent: onRender ? pct : null,
      startedAt: r.d_started,
    };
  }
  if (rendering) {
    const fresh = r.e_state === "queued" && now - eCreated < ENQUEUE_GRACE_MS;
    /* A render the director started runs inside the director's own job
       (`renderExport` in lib/video/director.ts, no `video.export` job),
       so either job holds it. */
    if (!r.e_job && !r.d_job && !fresh) {
      return { ...base, state: "failed", error: STALE_WORK_ERROR, startedAt: iso(r.e_started), finishedAt: iso(r.e_started) ?? iso(r.e_created) };
    }
    return {
      ...base,
      state: r.e_state === "queued" ? "queued" : "rendering",
      step: "render",
      percent: r.e_state === "queued" ? null : pct,
      startedAt: iso(r.e_started),
    };
  }
  /* The last attempt failed, but the worker holds a job to try again (the
     queue's backoff between attempts): that is a film still being made, not
     a failed one. Said as a retry, so no "渲染没成功" toast, chip or chat line
     fires once per attempt — only when the attempts run out and no job is
     left behind it. */
  if (r.d_state === "failed" && r.d_job) {
    return { ...base, state: "queued", retrying: true, error: r.d_error, startedAt: r.d_started };
  }
  if (r.e_state === "failed" && r.e_job) {
    return { ...base, state: "queued", retrying: true, step: "render", error: r.e_error, startedAt: iso(r.e_started) };
  }
  if (base.dueAt) return { ...base, state: "armed" };

  /* Neither running: the newest outcome wins. A director that failed after
     the latest render was queued is the news; a render that finished after
     the director stopped is the film. */
  const dFinished = r.d_finished ? new Date(r.d_finished).getTime() : 0;
  const directorFailedLater = r.d_state === "failed" && dFinished > 0 && (!r.e_id || dFinished >= eCreated);
  if (directorFailedLater) return { ...base, state: "failed", error: r.d_error, startedAt: r.d_started, finishedAt: r.d_finished };
  if (r.e_state === "done" && r.e_file_id) {
    return {
      ...base,
      state: "done",
      percent: 100,
      fileId: r.e_file_id,
      proxyFileId: r.e_proxy_file_id,
      durationMs: r.e_duration_ms,
      startedAt: iso(r.e_started),
      finishedAt: iso(r.e_finished),
    };
  }
  if (r.e_state === "failed") return { ...base, state: "failed", error: r.e_error, startedAt: iso(r.e_started), finishedAt: iso(r.e_finished) ?? iso(r.e_created) };
  return base;
}

/* ------------------------------------------------------ the auto-cut */

/**
 * "传完自动开始剪", kept on the project (`work_projects.source.autoCut`):
 *
 *   { on, by, at }            the setting, and who set it;
 *   { dueAt, armedAt, armedBy }  armed: the last upload landed and the cut
 *                             starts at `dueAt` unless another lands first.
 *
 * A jsonb merge each time, so nothing else in the snapshot is touched.
 */
export async function setAutoCut(viewer: Viewer, projectId: string, on: boolean): Promise<void> {
  const patch = JSON.stringify(on ? { autoCut: { on: true, by: viewer.id, at: new Date().toISOString() } } : { autoCut: { on: false, by: viewer.id, at: new Date().toISOString() } });
  await db
    .update(workProjects)
    .set({ source: sql`coalesce(${workProjects.source}, '{}'::jsonb) || ${patch}::jsonb` })
    .where(sql`${workProjects.id} = ${projectId} and ${workProjects.tenantId} = ${viewer.tenantId}`);
}

/**
 * An upload landed: if the setting is on, the cut is due a minute from now.
 * Called once per file, so a batch of five moves the deadline five times
 * and fires once, a minute after the last. Returns when it is due, or null
 * when the setting is off.
 */
export async function armAutoCut(viewer: Viewer, projectId: string): Promise<string | null> {
  /* Never while a film is being made: a clip that lands mid-run is not
     what that run cuts, and a deadline set now would read as due the
     moment the run ends and start a second film unasked. The person can
     press 开始剪 again once this one is out. */
  const [live] = await projectsLive(viewer, { ids: [projectId] });
  if (live && isRunning(live)) return null;
  const armedAt = new Date().toISOString();
  const dueAt = new Date(Date.now() + AUTO_CUT_DELAY_MS).toISOString();
  const patch = JSON.stringify({ dueAt, armedAt, armedBy: viewer.id });
  const rows = await db
    .update(workProjects)
    .set({ source: sql`jsonb_set(${workProjects.source}, '{autoCut}', (${workProjects.source} -> 'autoCut') || ${patch}::jsonb)` })
    .where(sql`${workProjects.id} = ${projectId} and ${workProjects.tenantId} = ${viewer.tenantId} and (${workProjects.source} -> 'autoCut' ->> 'on') = 'true'`)
    .returning({ id: workProjects.id });
  return rows.length ? dueAt : null;
}

/** "取消": the armed cut does not fire. The setting itself stays as it was.
 *  Also what a start does (`startCutForProject`): the arm is used up. */
export async function disarmAutoCut(viewer: Viewer, projectId: string): Promise<void> {
  await db
    .update(workProjects)
    .set({ source: sql`${workProjects.source} #- '{autoCut,dueAt}' #- '{autoCut,armedAt}' #- '{autoCut,armedBy}'` })
    .where(sql`${workProjects.id} = ${projectId} and ${workProjects.tenantId} = ${viewer.tenantId}`);
}

/**
 * Arms a later start used up, cleared from their rows — each only if it
 * still holds the deadline that was read, so an arm set since is kept.
 * The live poll reads past them already (`liveAutoCut`); this keeps the
 * project page's countdown and the next poll's filter from finding them.
 */
export async function clearSpentArms(viewer: Viewer, spent: SpentArm[]): Promise<void> {
  for (const a of spent) {
    await db
      .update(workProjects)
      .set({ source: sql`${workProjects.source} #- '{autoCut,dueAt}' #- '{autoCut,armedAt}' #- '{autoCut,armedBy}'` })
      .where(sql`${workProjects.id} = ${a.id} and ${workProjects.tenantId} = ${viewer.tenantId} and (${workProjects.source} -> 'autoCut' ->> 'dueAt') = ${a.dueAt}`);
  }
}

/**
 * The armed cuts that are due, started.
 *
 * The poll that every open page makes (`/api/projects/live`) is what runs
 * this, after its response: there is no worker handler to add (the worker
 * runs the studio's live code), and a page of the person's is open while
 * they wait for their own upload anyway. The claim is one conditional
 * update on the exact `dueAt` seen, so two tabs polling at once start it
 * once; the one-go itself refuses a second start while the director runs.
 * It runs as the person who armed it (their edit right, their budget), as
 * the button would have.
 */
export async function fireDueAutoCuts(viewer: Viewer, live: LiveProject[]): Promise<void> {
  const now = Date.now();
  const due = live.filter((p) => p.state === "armed" && p.dueAt && new Date(p.dueAt).getTime() <= now);
  if (!due.length) return;
  const { startCutForProject } = await import("@/lib/projects/start-cut");
  for (const p of due) {
    const claimed = await db
      .update(workProjects)
      .set({ source: sql`${workProjects.source} #- '{autoCut,dueAt}' #- '{autoCut,armedAt}'` })
      .where(sql`${workProjects.id} = ${p.id} and ${workProjects.tenantId} = ${viewer.tenantId} and (${workProjects.source} -> 'autoCut' ->> 'dueAt') = ${p.dueAt}`)
      .returning({ id: workProjects.id, title: workProjects.title, channelId: workProjects.channelId, videoProjectId: workProjects.videoProjectId, source: workProjects.source });
    const wp = claimed[0];
    if (!wp?.videoProjectId) continue;
    const armedBy = (wp.source as { autoCut?: { armedBy?: unknown } } | null)?.autoCut?.armedBy;
    const who = (typeof armedBy === "string" && armedBy !== viewer.id ? await viewerById(armedBy).catch(() => null) : null) ?? viewer;
    try {
      await startCutForProject(who, { id: wp.id, title: wp.title, channelId: wp.channelId, videoProjectId: wp.videoProjectId }, { via: "auto" });
    } catch (err) {
      console.error("[live] the armed auto-cut could not start", err);
    }
  }
}
