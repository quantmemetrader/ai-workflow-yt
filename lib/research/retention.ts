import "server-only";
import { lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { hotSnapshots } from "@/lib/db/schema";

/**
 * Hot lists older than two weeks go.
 *
 * `hot_snapshots` grows by a row per list per hour — the platforms' own
 * charts (`platforms.ts`), the beat feeds and their "beat_run" marks
 * (`beat-feeds.ts`), the "now" collections, and the "search:" cache
 * (`platform-search.ts`) — and had reached 23 MB in a month with nobody able
 * to see past the fortnight. Nothing reads further back than the Ideas
 * check, which measures a topic against the last fourteen days of lists
 * (`lib/ideas/check.ts`, DAYS). Everything else wants the newest row, or a
 * week of them (the Research page, the relevance backfill), 36 hours (the
 * ideas pool), a day (the "now" rows), six hours (the search cache) or three
 * (the beat feeds' age guard).
 *
 * The two guards that read a platform's newest row whatever its age
 * (`newestAt`, `lastRun`) find nothing for a platform not collected in two
 * weeks and treat it as new, which is what it is.
 *
 * Called by the nightly sweep (scripts/sweep.ts). Returns the rows removed.
 */
export async function purgeOldHotSnapshots(olderThanDays = 14): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const gone = await db.delete(hotSnapshots).where(lt(hotSnapshots.fetchedAt, cutoff));
  return gone.rowCount ?? 0;
}
