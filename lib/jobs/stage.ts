import { AsyncLocalStorage } from "node:async_hooks";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { jobs } from "@/lib/db/schema";

/**
 * What the job in hand is doing, said from anywhere inside it (15 Oct: "a loading bar for every task, with
 * a small line about what it is actually doing"). The worker runs each job inside `runInJob`; any code
 * under it calls `jobStage("正在润色", 0.8)` without being handed the job.
 */
const store = new AsyncLocalStorage<{ jobId: string }>();

export function runInJob<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ jobId }, fn);
}

/** The current job's step in a few plain words, and optionally how far along it is (0–1). Outside a job it does nothing. */
export function jobStage(stage: string, fraction?: number): void {
  const at = store.getStore();
  if (!at) return;
  const set: { stage: string; progress?: number } = { stage: stage.slice(0, 80) };
  if (typeof fraction === "number" && Number.isFinite(fraction)) set.progress = Math.max(0, Math.min(1, fraction));
  void db.update(jobs).set(set).where(eq(jobs.id, at.jobId)).catch(() => {});
}
