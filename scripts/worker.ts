/**
 * The job worker (spec §6).
 *
 * Claims one job at a time with SKIP LOCKED, runs it, records the outcome, and
 * sleeps when the queue is empty. Runs under pm2 beside the app; several
 * copies can run safely, which is the point of claiming this way.
 *
 *   pm2 logs aura-worker
 */
import { claim, fail, heartbeat, requeue, requeueStalled, succeed, type JobRow } from "../lib/jobs/queue";
import { refreshFeeds, refreshSeries, refreshTopic, syncSourceRegistry } from "../lib/research/ingest";
import {
  classifyComments,
  syncChannels,
  syncComments,
  syncCompetitors,
  syncDailyViews,
  syncPosts,
} from "../lib/social/ingest";
import type { Window } from "../lib/research/service";
import { sendPost } from "../lib/publish/dispatch";
import { isInterrupted, renderExport } from "../lib/video/render";
import { transcribeProject } from "../lib/video/transcribe";
import { speakTrack } from "../lib/video/voiceover";
import { makePoster } from "../lib/files/poster";
import { makePeaks } from "../lib/video/peaks";
import { autoEdit } from "../lib/video/autoedit";
import { direct } from "../lib/video/director";
import { refreshCreatorMemory } from "../lib/creator/service";
import { viewerById } from "../lib/auth/viewer-by-id";

const WORKER_ID = `${process.env.pm_id ?? "0"}@${process.pid}`;
const IDLE_MS = Number(process.env.WORKER_IDLE_MS ?? 3_000);

/**
 * How long one job may take before the worker gives up on it.
 *
 * Every fetch in lib/research/fetchers.ts carries its own timeout, but a
 * handler can still wedge — a rate-limit backoff that never ends, a socket
 * that neither answers nor closes. One handler is one worker, so a wedged job
 * stops every other job behind it, and `requeueStalled` would hand it to a
 * second worker *while this one is still inside it*. Shorter than the fifteen
 * minutes after which a job is considered abandoned, so this always gets there
 * first and records what happened.
 */
const JOB_TIMEOUT_MS = Number(process.env.WORKER_JOB_TIMEOUT_MS ?? 10 * 60_000);

/**
 * Some jobs are honestly longer than ten minutes.
 *
 * A render is FFmpeg re-encoding every cut of a master; a job that is failed
 * for taking eight minutes over a legitimate hour of work is a job that gets
 * retried for ever. The renderer has its own hour-long kill switch, so this
 * only has to be longer than that.
 */
const TIMEOUT_BY_TYPE: Record<string, number> = {
  "video.export": 70 * 60_000,
  // Transcribe, cut, design and render, end to end.
  "video.direct": 120 * 60_000,
  "video.transcribe": 45 * 60_000,
  "video.voiceover": 20 * 60_000,
  // A poster and peaks read over HTTP now, but a slow link on a big file
  // should not be a failure.
  "files.poster": 20 * 60_000,
  "video.peaks": 20 * 60_000,
};

type Handler = (job: JobRow) => Promise<unknown>;

const HANDLERS: Record<string, Handler> = {
  "research.series": (job) => {
    const { query, window } = job.payload as { query: string; window: Window };
    return refreshSeries(query, window ?? "3m");
  },
  "research.refreshTopic": (job) => {
    const { topicId } = job.payload as { topicId: string };
    return refreshTopic(topicId);
  },
  "research.refreshFeeds": () => refreshFeeds(),

  "social.syncChannels": () => syncChannels(),
  "social.syncPosts": () => syncPosts(),
  "social.syncDailyViews": () => syncDailyViews(),
  "social.syncComments": (job) => {
    const { limitPosts } = job.payload as { limitPosts?: number };
    return syncComments(limitPosts);
  },
  "social.classifyComments": (job) => {
    const { batchSize } = job.payload as { batchSize?: number };
    return classifyComments(batchSize);
  },
  "social.syncCompetitors": (job) => {
    const { limit } = job.payload as { limit?: number };
    return syncCompetitors(limit);
  },

  /* Sending a post to its channels. Nothing else in Publish touches a
   * platform, and this runs only after an approval record names a person. */
  "publish.send": (job) => {
    const { postId, targetId } = job.payload as { postId: string; targetId?: string };
    return sendPost(postId, targetId);
  },

  /* FFmpeg on this box. Minutes of CPU on a long master, so it never runs on
   * a request thread. */
  "video.export": (job) => {
    const { exportId } = job.payload as { exportId: string };
    return renderExport(exportId);
  },

  "files.poster": (job) => {
    const { fileId } = job.payload as { fileId: string };
    return makePoster(fileId);
  },

  /* The shape of a clip's sound, so a cut can be placed by eye rather than by
     typing a timecode and watching it again to check. */
  "video.peaks": (job) => {
    const { clipId } = job.payload as { clipId: string };
    return makePeaks(clipId);
  },

  /* Uploaded clips in, a cut video out: dead air removed from the measured
     word timings, the model's read of what matters, captions re-timed onto
     the result, graphics placed. A first pass to argue with. */
  "video.autoedit": async (job) => {
    const { projectId, language } = job.payload as { projectId: string; language: string };
    // Read now, not from the payload: permissions can have changed between
    // pressing the button and the worker reaching the job.
    const viewer = job.createdBy ? await viewerById(job.createdBy) : null;
    if (!viewer) throw new Error("The person who asked for this is no longer active");
    return autoEdit(viewer, projectId, { language });
  },

  "video.voiceover": (job) => {
    const { trackId } = job.payload as { trackId: string };
    return speakTrack(trackId);
  },

  /* The whole video from a brief. Runs as the person who asked, because it
     reads their files and spends their budget. */
  "video.direct": async (job) => {
    const { projectId } = job.payload as { projectId: string };
    const viewer = job.createdBy ? await viewerById(job.createdBy) : null;
    if (!viewer) throw new Error("The person who asked for this is no longer active");
    return direct(viewer, projectId, job.id);
  },

  /* The creator's own channel, mirrored, and the voice note rewritten. */
  "creator.sync": (job) => refreshCreatorMemory(job.tenantId),

  "video.transcribe": (job) => {
    const { projectId, language, diarize } = job.payload as {
      projectId: string;
      language: string;
      diarize?: boolean;
    };
    return transcribeProject(projectId, { language, diarize });
  },
};

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // Finish the job in hand, then exit: pm2 waits, and a half-written refresh
    // helps nobody.
    console.log(`[worker ${WORKER_ID}] ${signal}, finishing current job`);
    stopping = true;
  });
}

async function tick(): Promise<boolean> {
  const job = await claim(WORKER_ID);
  if (!job) return false;

  const handler = HANDLERS[job.type];
  const started = Date.now();

  if (!handler) {
    await fail(job, `No handler for job type "${job.type}"`);
    return true;
  }

  // A heartbeat on the job in hand: `locked_at` moves every thirty seconds
  // while it runs, so a job whose worker died hard (out of memory, SIGKILL)
  // is told apart from one that is simply long, and reclaimed in minutes
  // rather than left "rendering" on somebody's screen.
  const pulse = setInterval(() => void heartbeat(job.id).catch(() => {}), 30_000);
  try {
    const result = await withTimeout(handler(job), job.type);
    await succeed(job, result);
    console.log(`[worker] ${job.type} ok in ${Date.now() - started}ms`, JSON.stringify(result).slice(0, 200));
  } catch (err) {
    if (isInterrupted(err) || stopping) {
      // The worker was restarted under the job. Back in the queue as it was,
      // for the next worker to pick up; the attempt does not count.
      await requeue(job, "Worker restarted while the job ran");
      console.log(`[worker] ${job.type} interrupted after ${Date.now() - started}ms, requeued`);
    } else {
      await fail(job, err);
      console.error(`[worker] ${job.type} failed in ${Date.now() - started}ms:`, err instanceof Error ? err.message : err);
    }
  } finally {
    clearInterval(pulse);
  }

  return true;
}

async function main() {
  console.log(`[worker ${WORKER_ID}] up`);
  await syncSourceRegistry();

  let sinceSweep = Date.now();

  while (!stopping) {
    let worked = false;
    try {
      worked = await tick();
    } catch (err) {
      // A failure to even reach the queue: wait rather than spin.
      console.error("[worker] queue unreachable:", err instanceof Error ? err.message : err);
      await sleep(10_000);
    }

    // Re-queue anything a dead worker left holding: no heartbeat for three
    // minutes means the worker is gone, not busy.
    if (Date.now() - sinceSweep > 60_000) {
      sinceSweep = Date.now();
      const requeued = await requeueStalled(3).catch(() => 0);
      if (requeued) console.log(`[worker] re-queued ${requeued} stalled job(s)`);
    }

    if (!worked) await sleep(IDLE_MS);
  }

  console.log(`[worker ${WORKER_ID}] stopped`);
  process.exit(0);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Whichever finishes first. The handler is left to its own devices rather
 * than cancelled — nothing here can cancel it — but the worker stops waiting,
 * so the job is failed with a reason and the queue keeps moving. */
function withTimeout<T>(work: Promise<T>, type: string): Promise<T> {
  const limit = TIMEOUT_BY_TYPE[type] ?? JOB_TIMEOUT_MS;
  let timer: NodeJS.Timeout;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${type} did not finish within ${Math.round(limit / 1000)}s`)),
      limit,
    );
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer)) as Promise<T>;
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
