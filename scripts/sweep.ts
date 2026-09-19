/**
 * Daily housekeeping, run by pm2 rather than by a platform cron.
 *
 * Files past their 30-day recovery window lose their bytes as well as their
 * row — the window is a promise in both directions — and expired sessions go.
 * Runs once and exits; pm2 restarts it on a schedule (see ecosystem.config.cjs).
 */
import { pool } from "../lib/db/client";
import { purgeExpiredSessions } from "../lib/auth/session";
import { purgeDeleted } from "../lib/files/service";
import { audit } from "../lib/audit";

async function main() {
  const started = Date.now();
  const purgedFiles = await purgeDeleted(30);
  await purgeExpiredSessions();
  await audit(null, "cron.sweep", { meta: { purgedFiles }, tenantId: "system" });

  console.log(
    `[sweep] ${new Date().toISOString()} purged ${purgedFiles} file(s) in ${Date.now() - started}ms`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("[sweep] failed", err);
  process.exit(1);
});
