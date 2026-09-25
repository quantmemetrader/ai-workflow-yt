/**
 * Mark the newest stored list of every platform business / tech / other.
 *
 * Lists collected before `lib/research/relevance.ts` existed have
 * `relevance: null`, which every screen reads as "not sorted, show it all" —
 * so until the next hourly collection the Research page would look exactly
 * as noisy as before. This marks the newest snapshot of each platform once,
 * the same way the collector now does, so the filter works the moment the
 * change is deployed.
 *
 * Reads the database and asks the utility model; never calls a platform, so
 * nothing here is billed by TikHub. Writes only `hot_snapshots.relevance` on
 * those newest rows. Safe to run again: a row that already has marks is
 * skipped unless `--redo`.
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/backfill-relevance.ts [--redo] [--dry] [--show]
 *
 *   --redo  mark rows that already have marks again
 *   --dry   print, do not write
 *   --show  print every row with its mark, for checking the classifier by eye
 */
import { and, desc, eq, gte } from "drizzle-orm";
import { db, pool } from "@/lib/db/client";
import { hotSnapshots } from "@/lib/db/schema";
import { PLATFORMS, type HotRow, type RelevanceMap } from "@/lib/research/platform-catalog";
import { channelFocus, classifyHot } from "@/lib/research/relevance";

const TENANT = process.env.TENANT_ID ?? "tnt_aurafarmers";
const REDO = process.argv.includes("--redo");
const DRY = process.argv.includes("--dry");
const SHOW = process.argv.includes("--show");

async function main() {
  const pillars = await channelFocus(TENANT);
  console.log(`[relevance] channel subjects: ${pillars.join(" / ")}`);
  /* Marks made on one list are reused on the next, as in a collection run:
     the same video sits on several 抖音 lists. */
  const seen: RelevanceMap = {};
  let cost = 0;
  let calls = 0;

  for (const p of PLATFORMS) {
    if (p.unavailable) continue;
    const [row] = await db
      .select({ id: hotSnapshots.id, rows: hotSnapshots.rows, relevance: hotSnapshots.relevance, fetchedAt: hotSnapshots.fetchedAt })
      .from(hotSnapshots)
      .where(and(eq(hotSnapshots.platform, p.key), gte(hotSnapshots.fetchedAt, new Date(Date.now() - 7 * 86_400_000))))
      .orderBy(desc(hotSnapshots.fetchedAt))
      .limit(1);
    const rows = (Array.isArray(row?.rows) ? row.rows : []) as HotRow[];
    const stored = (row?.relevance ?? null) as RelevanceMap | null;
    if (!row || !rows.length) {
      console.log(`[relevance] ${p.key.padEnd(12)} nothing stored`);
      continue;
    }
    if (stored && !REDO) {
      console.log(`[relevance] ${p.key.padEnd(12)} already marked; --redo to mark again`);
      Object.assign(seen, stored);
      continue;
    }

    const t0 = Date.now();
    const { relevance, counts } = await classifyHot(p.key, rows, {
      prev: REDO ? seen : { ...seen, ...(stored ?? {}) },
      pillars,
      onUsage: (res) => {
        cost += res.costMicros;
        calls++;
      },
    });
    if (!relevance) {
      console.log(`[relevance] ${p.key.padEnd(12)} the classifier failed; left unmarked (shown whole)`);
      continue;
    }
    Object.assign(seen, relevance);
    const onBeat = rows.filter((r) => {
      const m = relevance[r.phrase];
      return m && m.t !== "other" && m.s >= 2;
    }).length;
    console.log(
      `[relevance] ${p.key.padEnd(12)} ${String(onBeat).padStart(3)} / ${String(rows.length).padStart(3)} on the beat · ${counts.rules} rule, ${counts.reused} reused, ${counts.model} model${counts.missing ? `, ${counts.missing} unmarked` : ""} · ${Math.round((Date.now() - t0) / 1000)}s`,
    );
    if (SHOW) {
      rows.forEach((r, i) => {
        const m = relevance[r.phrase];
        const label = m ? `${m.t.padEnd(5)} ${m.s}${m.tag ? ` ${m.tag}` : ""}` : "(none)";
        console.log(`    ${String(i + 1).padStart(2)}  ${label.padEnd(14)} ${r.phrase.replace(/\s+/g, " ").slice(0, 60)}`);
      });
    }
    if (!DRY) await db.update(hotSnapshots).set({ relevance }).where(eq(hotSnapshots.id, row.id));
  }

  console.log(`[relevance] ${calls} model calls, about $${(cost / 1e6).toFixed(4)}${DRY ? " (dry run, nothing written)" : ""}`);
}

main()
  .catch((err) => {
    console.error("[relevance] failed", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
