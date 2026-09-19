/**
 * The job worker (spec §6).
 *
 * Claims one job at a time with SKIP LOCKED, runs it, records the outcome, and
 * sleeps when the queue is empty. Runs under pm2 beside the app; several
 * copies can run safely, which is the point of claiming this way.
 *
 *   pm2 logs aura-worker
 */
import { claim, fail, requeueStalled, succeed, type JobRow } from "../lib/jobs/queue";
import { refreshFeeds, refreshSeries, refreshTopic, syncSourceRegistry } from "../lib/research/ingest";
import { classifyComments, syncChannels, syncComments, syncDailyViews, syncPosts } from "../lib/social/ingest";
import type { Window } from "../lib/research/service";

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

  try {
    const result = await withTimeout(handler(job), job.type);
    await succeed(job, result);
    console.log(`[worker] ${job.type} ok in ${Date.now() - started}ms`, JSON.stringify(result).slice(0, 200));
  } catch (err) {
    await fail(job, err);
    console.error(`[worker] ${job.type} failed in ${Date.now() - started}ms:`, err instanceof Error ? err.message : err);
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

    // Re-queue anything a dead worker left holding.
    if (Date.now() - sinceSweep > 300_000) {
      sinceSweep = Date.now();
      const requeued = await requeueStalled().catch(() => 0);
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
  let timer: NodeJS.Timeout;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${type} did not finish within ${Math.round(JOB_TIMEOUT_MS / 1000)}s`)),
      JOB_TIMEOUT_MS,
    );
  });
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer)) as Promise<T>;
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
