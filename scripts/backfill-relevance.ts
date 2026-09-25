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
 * nothing here is billed by TikHub. Writes only `hot_snapshots.relevance`
 * (and with `--summary`, `hot_snapshots.summary`) on those newest rows. Safe
 * to run again: a row that already has marks is not marked again unless
 * `--redo`.
 *
 *   node --env-file=.env.local --dns-result-order=ipv4first --conditions=react-server --import tsx scripts/backfill-relevance.ts [--redo] [--summary] [--dry] [--show]
 *
 *   --redo     mark rows that already have marks again
 *   --summary  also rewrite the researcher's line about the rows on the beat
 *   --dry      print, do not write
 *   --show     print every row with its mark, for checking the classifier by eye
 */
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { db, pool } from "@/lib/db/client";
import { hotSnapshots } from "@/lib/db/schema";
import { PLATFORMS, onFocus, type HotRow, type RelevanceMap } from "@/lib/research/platform-catalog";
import { channelFocus, classifyHot } from "@/lib/research/relevance";
import { summarizeHot } from "@/lib/research/summary";

const TENANT = process.env.TENANT_ID ?? "tnt_aurafarmers";
const REDO = process.argv.includes("--redo");
const DRY = process.argv.includes("--dry");
const SHOW = process.argv.includes("--show");
const SUMMARY = process.argv.includes("--summary");

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
    /* The platform's last marked list, as the collector reuses it: a list
       collected by the old code after an earlier backfill is mostly the same
       rows, and they keep the marks they had. Not with --redo, whose point
       is to ask again. */
    const [lastMarked] = REDO
      ? []
      : await db
          .select({ relevance: hotSnapshots.relevance })
          .from(hotSnapshots)
          .where(and(eq(hotSnapshots.platform, p.key), isNotNull(hotSnapshots.relevance), gte(hotSnapshots.fetchedAt, new Date(Date.now() - 7 * 86_400_000))))
          .orderBy(desc(hotSnapshots.fetchedAt))
          .limit(1);
    let relevance: RelevanceMap | null = stored;
    if (stored && !REDO) {
      console.log(`[relevance] ${p.key.padEnd(12)} already marked; --redo to mark again`);
    } else {
      const t0 = Date.now();
      const res = await classifyHot(p.key, rows, {
        prev: REDO ? seen : { ...seen, ...((lastMarked?.relevance ?? {}) as RelevanceMap), ...(stored ?? {}) },
        pillars,
        onUsage: (use) => {
          cost += use.costMicros;
          calls++;
        },
      });
      if (!res.relevance) {
        console.log(`[relevance] ${p.key.padEnd(12)} the classifier failed; left unmarked (shown whole)`);
        continue;
      }
      relevance = res.relevance;
      const marks = relevance;
      const onBeat = rows.filter((r) => onFocus(marks[r.phrase])).length;
      const { counts } = res;
      console.log(
        `[relevance] ${p.key.padEnd(12)} ${String(onBeat).padStart(3)} / ${String(rows.length).padStart(3)} on the beat · ${counts.rules} rule, ${counts.reused} reused, ${counts.model} model${counts.missing ? `, ${counts.missing} unmarked` : ""} · ${Math.round((Date.now() - t0) / 1000)}s`,
      );
      if (SHOW) {
        rows.forEach((r, i) => {
          const m = marks[r.phrase];
          const label = m ? `${m.t.padEnd(5)} ${m.s}${m.tag ? ` ${m.tag}` : ""}` : "(none)";
          console.log(`    ${String(i + 1).padStart(2)}  ${label.padEnd(14)} ${r.phrase.replace(/\s+/g, " ").slice(0, 60)}`);
        });
      }
      if (!DRY) await db.update(hotSnapshots).set({ relevance }).where(eq(hotSnapshots.id, row.id));
    }
    Object.assign(seen, relevance ?? {});

    /* The researcher's line on the list was written about the whole list,
       concerts and all. With --summary it is written again about the rows on
       the beat, as the collector now does, so the tabs do not keep the old
       line until each list is next collected (up to three hours for the
       抖音 billboards). One small model call per list, none for a list with
       nothing on the beat. */
    if (SUMMARY && relevance) {
      const summary = await summarizeHot(p.key, rows, relevance);
      console.log(`[relevance] ${p.key.padEnd(12)} summary: ${summary ?? "(no model answered; left as it was)"}`);
      if (summary && !DRY) await db.update(hotSnapshots).set({ summary }).where(eq(hotSnapshots.id, row.id));
    }
  }

  console.log(`[relevance] ${calls} classifier calls, about $${(cost / 1e6).toFixed(4)}${SUMMARY ? " (summaries not counted)" : ""}${DRY ? " (dry run, nothing written)" : ""}`);
}

main()
  .catch((err) => {
    console.error("[relevance] failed", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
