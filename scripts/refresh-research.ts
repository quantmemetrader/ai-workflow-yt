/**
 * Queues a refresh for every topic that has gone stale, and for the source
 * feeds. Run by pm2 on a schedule; safe to run by hand.
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/refresh-research.ts
 */
import { pool } from "../lib/db/client";
import { enqueue } from "../lib/jobs/queue";
import { staleTopics, syncSourceRegistry } from "../lib/research/ingest";

const TENANT = process.env.TENANT_ID ?? "tnt_aurafarmers";

async function main() {
  await syncSourceRegistry();

  const stale = await staleTopics(TENANT);

  // Queued together rather than one at a time: fifty topics in sequence is a
  // hundred and fifty round trips to Singapore for work the queue does anyway.
  await Promise.all([
    ...stale.map((topic) =>
      enqueue({
        tenantId: TENANT,
        type: "research.refreshTopic",
        module: "research",
        payload: { topicId: topic.id },
        objectType: "topic",
        objectId: topic.id,
        dedupeKey: `topic:${topic.id}`,
      }),
    ),
    enqueue({
      tenantId: TENANT,
      type: "research.refreshFeeds",
      module: "research",
      dedupeKey: "feeds",
    }),
  ]);

  console.log(`queued ${stale.length} topic refresh(es) and the source feeds`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
