import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { trustedDevices } from "@/lib/db/schema";
import { env } from "@/lib/env";

/**
 * The bit of the sign-in that sits *between* the password and the session.
 *
 * Two small pieces of state, and both of them are deliberately not a session:
 *
 *   — **The challenge.** Somebody who has typed the right password but not yet
 *     the right code is not signed in, so there is no session row to hang this
 *     on. It is a short-lived signed cookie carrying the user id and an
 *     expiry — nothing else, nothing secret, and unusable a minute later. It
 *     is signed rather than stored so a half-finished sign-in leaves nothing
 *     behind in the database for somebody to find.
 *   — **The trusted browser.** "Trust this browser for 30 days" is a row whose
 *     id is the sha-256 of the cookie, exactly like a session: the raw token
 *     never reaches the database. Trust is per enrolment — turning 2FA off or
 *     re-enrolling deletes every row, because the thing being trusted is "this
 *     browser has already proved *that* authenticator".
 */

export const CHALLENGE_COOKIE = "af_2fa";
export const TRUST_COOKIE = "af_trust";

/** Five minutes is long enough to fetch a phone and short enough that a
 * half-finished sign-in on a shared machine is not still open at lunch. */
const CHALLENGE_TTL_MS = 5 * 60_000;
const TRUST_TTL_DAYS = 30;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/* --------------------------------------------------------- the challenge */

function sign(payload: string): string {
  return createHmac("sha256", env.sessionSecret).update(payload).digest("base64url");
}

export async function startChallenge(userId: string) {
  const payload = `${userId}.${Date.now() + CHALLENGE_TTL_MS}`;
  const jar = await cookies();
  jar.set(CHALLENGE_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: Math.ceil(CHALLENGE_TTL_MS / 1000),
  });
}

/** The user id this browser is halfway through signing in as, or null. */
export async function readChallenge(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(CHALLENGE_COOKIE)?.value;
  if (!raw) return null;

  const cut = raw.lastIndexOf(".");
  if (cut < 0) return null;
  const payload = raw.slice(0, cut);
  const mac = raw.slice(cut + 1);

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  const [userId, expiresAt] = payload.split(".");
  if (!userId || !expiresAt) return null;
  if (Number(expiresAt) < Date.now()) return null;
  return userId;
}

export async function endChallenge() {
  const jar = await cookies();
  jar.delete(CHALLENGE_COOKIE);
}

/* ---------------------------------------------------- the trusted browser */

export async function trustThisBrowser(userId: string, meta: { ip?: string; userAgent?: string } = {}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TRUST_TTL_DAYS * 86_400_000);

  await db.insert(trustedDevices).values({
    id: hash(token),
    userId,
    label: describe(meta.userAgent),
    ip: meta.ip,
    expiresAt,
  });

  const jar = await cookies();
  jar.set(TRUST_COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/**
 * Is this browser already trusted for this person?
 *
 * Scoped to the user id, so a trust cookie from one account cannot skip the
 * second factor on another — which is what would happen on a shared machine
 * if this only checked that the row existed.
 */
export async function browserIsTrusted(userId: string): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(TRUST_COOKIE)?.value;
  if (!token) return false;

  const [row] = await db
    .select({ id: trustedDevices.id })
    .from(trustedDevices)
    .where(
      and(
        eq(trustedDevices.id, hash(token)),
        eq(trustedDevices.userId, userId),
        gt(trustedDevices.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!row) return false;

  await db
    .update(trustedDevices)
    .set({ lastSeenAt: new Date() })
    .where(eq(trustedDevices.id, row.id))
    .catch(() => {});
  return true;
}

export async function listTrustedDevices(userId: string) {
  return db
    .select()
    .from(trustedDevices)
    .where(and(eq(trustedDevices.userId, userId), gt(trustedDevices.expiresAt, new Date())))
    .orderBy(sql`${trustedDevices.lastSeenAt} desc`);
}

/** Used when 2FA is turned off or re-enrolled, and by "forget every browser". */
export async function forgetTrustedDevices(userId: string) {
  await db.delete(trustedDevices).where(eq(trustedDevices.userId, userId));
  const jar = await cookies();
  jar.delete(TRUST_COOKIE);
}

export async function forgetTrustedDevice(userId: string, id: string) {
  await db.delete(trustedDevices).where(and(eq(trustedDevices.id, id), eq(trustedDevices.userId, userId)));
}

export async function purgeExpiredTrust() {
  await db.delete(trustedDevices).where(lt(trustedDevices.expiresAt, new Date()));
}

/** "Chrome on macOS" — enough to recognise a row, not a fingerprint. */
function describe(userAgent?: string): string | null {
  if (!userAgent) return null;
  const browser =
    /Edg\//.test(userAgent) ? "Edge"
    : /OPR\//.test(userAgent) ? "Opera"
    : /Chrome\//.test(userAgent) ? "Chrome"
    : /Firefox\//.test(userAgent) ? "Firefox"
    : /Safari\//.test(userAgent) ? "Safari"
    : "a browser";
  const os =
    /iPhone|iPad/.test(userAgent) ? "iOS"
    : /Android/.test(userAgent) ? "Android"
    : /Mac OS X/.test(userAgent) ? "macOS"
    : /Windows/.test(userAgent) ? "Windows"
    : /Linux/.test(userAgent) ? "Linux"
    : null;
  return os ? `${browser} on ${os}` : browser;
}
