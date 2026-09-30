/**
 * The Planning agent's morning to-dos, posted into #研究日报 right after the
 * Research agent's digest.
 *
 * The client's ask, in his words: *"every mornig 8am HKT research agent will
 * send a message on yesterday's trend"* and *"polanning agent will send out to
 * dos"*. So this is the second half of the morning: 研究员 says what happened,
 * 策划 says what the studio should do about it today, and every item that an
 * AI employee could start carries a button that starts it.
 *
 * It reads the digest that was just posted rather than the research again —
 * the two should agree, and two independent reads of the same data at eight in
 * the morning is how they stop agreeing.
 *
 * Buttons are the ordinary card kind (`lib/agents/cards.ts`): pressing one
 * posts a line *as the person who pressed it*, which tags the colleague and
 * starts them off. Nothing here assigns work by itself; the studio still
 * chooses, in one press instead of a sentence.
 *
 * Run by pm2 at 00:05 UTC (08:05 in Hong Kong), five minutes behind the digest.
 *
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/plan.ts [--force] [--dry]
 */
import { pool } from "../lib/db/client";
import { runPlan } from "../lib/agents/plan-run";

runPlan({ tenant: process.env.TENANT_ID ?? "tnt_aurafarmers", force: process.argv.includes("--force"), dry: process.argv.includes("--dry") })
  .catch((err) => {
    console.error("[plan] failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
