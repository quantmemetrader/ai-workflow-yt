/**
 * Daily housekeeping, run by pm2 rather than by a platform cron.
 *
 * Files past their 30-day recovery window lose their bytes as well as their
 * row — the window is a promise in both directions — expired sessions go, and
 * the two tables that grow by the hour are cut back to what anything still
 * reads: hot lists older than two weeks, and finished jobs with their events
 * (`lib/research/retention.ts`, `lib/jobs/retention.ts` say which and why).
 * Runs once and exits; pm2 restarts it on a schedule (see ecosystem.config.cjs).
 */
import { pool } from "../lib/db/client";
import { purgeExpiredSessions } from "../lib/auth/session";
import { purgeExpiredTrust } from "../lib/auth/second-factor";
import { purgeDeleted } from "../lib/files/service";
import { purgeUnfinished } from "../lib/files/abandon";
import { purgeOldHotSnapshots } from "../lib/research/retention";
import { purgeFinishedJobs } from "../lib/jobs/retention";
import { audit } from "../lib/audit";

async function main() {
  const started = Date.now();
  const purgedFiles = await purgeDeleted(30);
  // Rows whose upload never arrived and whose browser never said so.
  const purgedUnfinished = await purgeUnfinished(24);
  await purgeExpiredSessions();
  // Expired "trust this browser" rows: dead weight, and a row that still
  // names a browser after its 30 days are up reads as access that is not there.
  await purgeExpiredTrust();
  // Hot lists past the fortnight the Ideas check reads, and finished jobs —
  // succeeded after two weeks, failed after two months, never one still queued
  // or running — with their events.
  const purgedSnapshots = await purgeOldHotSnapshots(14);
  const purgedJobs = await purgeFinishedJobs({ succeededDays: 14, failedDays: 60 });
  await audit(null, "cron.sweep", {
    meta: {
      purgedFiles,
      purgedUnfinished,
      purgedSnapshots,
      purgedJobs: purgedJobs.jobs,
      purgedJobEvents: purgedJobs.events,
    },
    tenantId: "system",
  });

  console.log(
    `[sweep] ${new Date().toISOString()} purged ${purgedFiles} file(s), ${purgedUnfinished} unfinished upload(s), ${purgedSnapshots} hot list(s), ${purgedJobs.jobs} job(s) with ${purgedJobs.events} event(s) in ${Date.now() - started}ms`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("[sweep] failed", err);
  process.exit(1);
});
