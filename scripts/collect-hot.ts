/**
 * Every platform's hot list, read once and stored (`hot_snapshots`).
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/collect-hot.ts
 *
 * Run by pm2 on the hour (`aura-hot`). Pages and the morning brief read what
 * this stores and never call a platform themselves. About a dozen metered
 * TikHub requests a run.
 */
import { collectAll } from "@/lib/research/platforms";

async function main() {
  const t0 = Date.now();
  const out = await collectAll();
  for (const r of out) console.log(`[hot] ${r.platform.padEnd(12)} ${String(r.rows).padStart(3)} rows${r.note ? ` · ${r.note}` : ""}`);
  console.log(`[hot] done in ${Math.round((Date.now() - t0) / 1000)}s`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[hot] failed", err);
  process.exit(1);
});
