/**
 * Every platform's hot list, read once and stored (`hot_snapshots`).
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/collect-hot.ts [--force]
 *
 * Run by pm2 on the hour (`aura-hot`). Pages and the morning brief read what
 * this stores and never call a platform themselves. Each list is marked
 * business / tech / other as it is stored (`lib/research/relevance.ts`).
 *
 * Metered TikHub requests: up to ten a run, and fewer most hours. A list
 * stored under half an hour ago is skipped, so a restart loop or a second
 * run by hand does not buy the same lists again, and the three 抖音 creator
 * billboards (24-hour and 7-day rankings) are read every third hour. `--force`
 * reads everything regardless.
 */
import { collectAll } from "@/lib/research/platforms";

const FORCE = process.argv.includes("--force");

async function main() {
  const t0 = Date.now();
  const out = await collectAll({ force: FORCE });
  for (const r of out) {
    console.log(
      r.skipped
        ? `[hot] ${r.platform.padEnd(12)}   - skipped, ${r.skipped}`
        : `[hot] ${r.platform.padEnd(12)} ${String(r.rows).padStart(3)} rows${r.note ? ` · ${r.note}` : ""}`,
    );
  }
  console.log(`[hot] done in ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[hot] failed", err);
  process.exit(1);
});
