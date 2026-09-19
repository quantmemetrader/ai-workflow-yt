import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";

/**
 * Sign-in throttling.
 *
 * Without it the form is unthrottled credential-stuffing surface: an attacker
 * with a list of studio addresses can try passwords as fast as the network
 * allows, and scrypt's cost protects the stored hashes but does nothing about
 * the attempt rate.
 *
 * The counter is the audit log, which already records every failure with the
 * address tried and the caller's IP. That matters for correctness here: four
 * app instances run behind pm2, so an in-process counter would let an attacker
 * have four times the budget and would reset on every deploy. The database is
 * the only thing all four agree on.
 *
 * Two independent limits, because they stop different attacks:
 *   — per address: someone hammering one account;
 *   — per IP: someone spraying one password across many accounts.
 *
 * Both are deliberately generous. A person who has genuinely forgotten their
 * password should be told to wait, not locked out for the day, and until there
 * is a password-reset flow a lockout has no way back.
 */
const WINDOW_MINUTES = 15;
const MAX_PER_EMAIL = 8;
const MAX_PER_IP = 30;

export type ThrottleVerdict = { allowed: true } | { allowed: false; retryAfterMinutes: number };

export async function checkLoginThrottle(email: string, ip?: string): Promise<ThrottleVerdict> {
  try {
    const { rows } = await db.execute<{ by_email: number; by_ip: number }>(sql`
      select
        count(*) filter (where ${auditLog.meta}->>'email' = ${email})::int as by_email,
        count(*) filter (where ${ip ? sql`${auditLog.ip} = ${ip}` : sql`false`})::int as by_ip
      from ${auditLog}
      where ${auditLog.action} = 'auth.fail'
        and ${auditLog.at} > now() - ${`${WINDOW_MINUTES} minutes`}::interval
    `);

    const byEmail = Number(rows[0]?.by_email ?? 0);
    const byIp = Number(rows[0]?.by_ip ?? 0);

    if (byEmail >= MAX_PER_EMAIL || byIp >= MAX_PER_IP) {
      return { allowed: false, retryAfterMinutes: WINDOW_MINUTES };
    }
    return { allowed: true };
  } catch (err) {
    // A throttle that cannot reach the database must not become a lockout:
    // failing closed here would take sign-in down with the audit table.
    console.error("[throttle] check failed, allowing", err);
    return { allowed: true };
  }
}

/** Cleared after a successful sign-in, so one bad evening does not follow
 * someone around for the rest of the window. */
export async function clearLoginThrottle(email: string) {
  await db
    .delete(auditLog)
    .where(sql`${auditLog.action} = 'auth.fail' and ${auditLog.meta}->>'email' = ${email}`)
    .catch(() => {});
}
