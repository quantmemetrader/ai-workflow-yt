/**
 * Mirror the creator's own channel and rewrite the voice note.
 *
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx scripts/creator-sync.ts --now
 *
 * Without `--now` it queues the job for the worker, which is what the daily
 * cron does. With it, the work runs here, which is what you want when
 * checking the YouTube key by hand.
 */
import { pool } from "../lib/db/client";
import { enqueue } from "../lib/jobs/queue";
import { refreshCreatorMemory } from "../lib/creator/service";

const TENANT = process.env.TENANT_ID ?? "tnt_aurafarmers";

async function main() {
  if (process.argv.includes("--now")) {
    console.log(await refreshCreatorMemory(TENANT));
    return;
  }
  await enqueue({ tenantId: TENANT, type: "creator.sync", module: "research", dedupeKey: "creator.sync", priority: 1 });
  console.log("queued creator.sync");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
