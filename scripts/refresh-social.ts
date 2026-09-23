/**
 * Queues one round of the social sync: channels, posts and their numbers,
 * comments, then the reading of the comments.
 *
 * Run by pm2 on a schedule; safe to run by hand, and safe to run twice —
 * every write in `lib/social/ingest.ts` is an upsert on the platform's own id.
 *
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx scripts/refresh-social.ts
 *
 * `--now` runs the work in this process instead of queueing it, which is what
 * you want when checking a credential by hand.
 */
import { pool } from "../lib/db/client";
import { enqueue } from "../lib/jobs/queue";
import { syncAll } from "../lib/social/ingest";
import { env } from "../lib/env";

const TENANT = process.env.TENANT_ID ?? "tnt_aurafarmers";

async function main() {
  if (!env.zernio.configured) {
    console.log("ZERNIO_API_KEY is not set — nothing to sync.");
    return;
  }

  if (process.argv.includes("--now")) {
    console.log(await syncAll());
    return;
  }

  // In order: a post needs its channel, a comment needs its post, and the
  // reading needs the comment. The queue runs one job at a time per worker,
  // and the dedupe keys stop a slow round from stacking on the next one.
  for (const type of [
    "social.syncChannels",
    "social.syncPosts",
    "social.syncComments",
    // Somebody else's channels, through TikHub. The one thing Zernio cannot
    // see, and the reason the outside-world key exists.
    "social.syncCompetitors",
    "social.classifyComments",
  ] as const) {
    await enqueue({ tenantId: TENANT, type, module: "research", dedupeKey: type });
  }

  // Views per day is one request per video, so it runs once a day rather than
  // hourly. `--daily` is what the daily cron passes.
  if (process.argv.includes("--daily")) {
    await enqueue({ tenantId: TENANT, type: "social.syncDailyViews", module: "research", dedupeKey: "social.syncDailyViews" });
    // The creator's own uploads, and the voice note the assistant carries.
    await enqueue({ tenantId: TENANT, type: "creator.sync", module: "research", dedupeKey: "creator.sync", priority: 1 });
  }

  console.log("queued the social sync");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
