import { timingSafeEqual } from "node:crypto";
import { purgeExpiredSessions } from "@/lib/auth/session";
import { purgeDeleted } from "@/lib/files/service";
import { audit } from "@/lib/audit";

/**
 * Housekeeping, once a day.
 *
 * Expired sessions go, and files past their 30-day recovery window lose their
 * bytes as well as their row — the window is a promise in both directions, so
 * "deleted" has to eventually mean deleted.
 *
 * Vercel signs cron requests with CRON_SECRET; anything else is refused, so
 * the route cannot be used to force a purge from outside. The check fails
 * closed when CRON_SECRET is unset — it used to skip the check entirely, which
 * left an unauthenticated endpoint that permanently destroys every file past
 * its recovery window and signs everyone out. The pm2 deployment runs the
 * sweep from `aura-sweep`, not from this route, so an unset secret costs
 * nothing there.
 */
export const maxDuration = 300;

/** Length-independent so the comparison itself says nothing about the secret. */
function secretMatches(header: string | null, secret: string): boolean {
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !secretMatches(request.headers.get("authorization"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const purgedFiles = await purgeDeleted(30);
  await purgeExpiredSessions();

  await audit(null, "cron.sweep", { meta: { purgedFiles }, tenantId: "system" });

  return Response.json({ ok: true, purgedFiles });
}
