import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, lt, ne } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import { env } from "@/lib/env";

export const SESSION_COOKIE = "af_session";
const TTL_DAYS = 30;

/** The cookie holds a random token; the database holds only its hash, so a
 * leaked database row cannot be replayed as a login. */
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/** The row id for a cookie value. Exported so the DAL can resolve a session in
 * the same query that loads the person. */
export const sessionId = hash;

export async function createSession(userId: string, meta: { ip?: string; userAgent?: string } = {}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000);

  await db.insert(sessions).values({
    id: hash(token),
    userId,
    expiresAt,
    ip: meta.ip,
    userAgent: meta.userAgent?.slice(0, 400),
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    // Secure cookies are dropped by the browser over plain HTTP. While the
    // deployment is reachable by IP and port with no TLS, this has to be off
    // or signing in silently fails. Set COOKIE_SECURE=true the moment a
    // certificate is in front of it — passwords and session tokens cross the
    // network in the clear until then.
    secure: env.cookieSecure,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

/** Refreshes "last seen", at most once an hour per session. Called after the
 * response is on its way, never in the middle of rendering one. */
export async function touchSession(token: string, userId: string) {
  const now = new Date();
  await Promise.all([
    db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, hash(token))),
    db.update(users).set({ lastActiveAt: now }).where(eq(users.id, userId)),
  ]).catch(() => {});
}

export async function destroySession() {
  const token = await readSessionToken();
  if (token) await db.delete(sessions).where(eq(sessions.id, hash(token)));
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/** Housekeeping, called from the cron job. */
export async function purgeExpiredSessions() {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

/** Signs out everywhere else. Used when a password changes: the one thing a
 * person expects from that is that whoever else was in gets thrown out. */
export async function destroyOtherSessions(userId: string, keepToken: string | null) {
  const keep = keepToken ? hash(keepToken) : "";
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), keep ? ne(sessions.id, keep) : undefined));
}
