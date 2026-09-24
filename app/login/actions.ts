"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { NO_SUCH_USER_HASH, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";
import { checkLoginThrottle, clearLoginThrottle } from "@/lib/auth/throttle";
import { browserIsTrusted, endChallenge, readChallenge, startChallenge, trustThisBrowser } from "@/lib/auth/second-factor";
import { matchRecovery, open as openSecret, verifyCode } from "@/lib/auth/totp";
import { audit } from "@/lib/audit";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE } from "@/lib/i18n";

export type LoginState = { error?: string };

/**
 * Sign in. Deliberately uniform on failure: a wrong password and an unknown
 * address give the same message and take the same time, so the form cannot be
 * used to find out who works here.
 */
export async function signIn(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  // Bound both before they reach scrypt: an unbounded password field is a way
  // to make the server spend a lot of CPU for the price of one request.
  if (!email || !password || email.length > 320 || password.length > 1024) {
    return { error: "That email and password do not match." };
  }

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim();

  // Checked before the lookup and before scrypt: a throttle that runs after
  // the expensive part still lets an attacker spend the server's CPU.
  const verdict = await checkLoginThrottle(email, ip);
  if (!verdict.allowed) {
    return { error: `Too many attempts. Try again in ${verdict.retryAfterMinutes} minutes.` };
  }

  // Addresses are unique per *tenant*, not globally (users_tenant_email_idx),
  // so this can legitimately match more than one account. There is nowhere on
  // this form to say which studio you meant, so an ambiguous address is
  // refused rather than resolved by whichever row the planner returned first.
  let matches: (typeof users.$inferSelect)[];
  try {
    matches = await db.select().from(users).where(and(eq(users.email, email))).limit(2);
  } catch (err) {
    // Never silence: an unreachable database is the platform's fault and the
    // person needs to know it is not their password.
    console.error("[auth] lookup failed", err);
    return { error: "Sign-in is unavailable right now. Try again in a moment." };
  }
  const user = matches.length === 1 ? matches[0] : undefined;

  // An unknown address must cost the same as a known one, so it is verified
  // against a hash that no password matches rather than skipping scrypt.
  const ok = await verifyPassword(password, user?.passwordHash || NO_SUCH_USER_HASH);

  if (!user || !ok || user.deletedAt) {
    // The throttle counts these rows, so the address and the caller's IP both
    // have to be on them; `audit` reads the IP from the request headers.
    await audit(null, "auth.fail", { meta: { email } });
    return { error: "That email and password do not match." };
  }
  // Only an active account may sign in. `invited` means the password has been
  // set but an admin has not turned the account on; it must not become active
  // just because someone reached the form.
  if (user.status !== "active") {
    return { error: "Your account is not active. Ask an admin." };
  }
  // An AI employee has no password to begin with; this holds even if somebody
  // gives it one. Same words as a wrong password — it is not a login.
  if (user.isAgent) {
    await audit(null, "auth.fail", { meta: { email, agent: true } });
    return { error: "That email and password do not match." };
  }

  /* Two-step verification, if this person has finished enrolling and this
     browser has not already been trusted. The password is right — but a
     session is not created here, because a session is what "signed in" means.
     What this browser gets instead is a five-minute signed challenge that
     names the account and nothing else. */
  if (user.totpConfirmedAt && !(await browserIsTrusted(user.id))) {
    await clearLoginThrottle(email);
    await startChallenge(user.id);
    await audit({ id: user.id, tenantId: user.tenantId }, "auth.2fa.challenge");
    redirect("/login/verify");
  }

  // Whatever session this browser arrived holding is finished with. The cookie
  // is replaced either way, but the old row would otherwise stay valid for its
  // full 30 days for anyone else who has that token.
  await destroySession();

  await createSession(user.id, {
    ip,
    userAgent: h.get("user-agent") ?? undefined,
  });

  /* So the sign-in screen speaks this person's language next time. Not
     httpOnly: the login screen is a client component and reads it there. */
  (await cookies()).set(LANG_COOKIE, user.locale ?? "zh-CN", {
    maxAge: LANG_COOKIE_MAX_AGE,
    sameSite: "lax",
    path: "/",
  });
  // Records the visit only. Signing in must never change account state: the
  // old version wrote status = 'active' here, which let a sign-in promote an
  // account an admin had not switched on.
  await db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, user.id));
  await clearLoginThrottle(email);
  await audit({ id: user.id, tenantId: user.tenantId }, "auth.login");

  redirect("/home");
}

/* ------------------------------------------------------- the second step */

export type VerifyState = { error?: string };

/**
 * The 6-digit code, or a recovery code.
 *
 * Throttled on the same counter the password is, keyed by the account: six
 * digits is 1,000,000 guesses, and without a limit that is an afternoon's
 * work. A code that verifies is spent — the step it came from is written to
 * the row, so the same code typed again on another browser is refused.
 */
export async function verifySecondFactor(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const userId = await readChallenge();
  if (!userId) return { error: "That took too long. Sign in again." };

  const typed = String(formData.get("code") ?? "").trim();
  const trust = formData.get("trust") === "on";
  if (!typed || typed.length > 64) return { error: "That code is not right." };

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim();

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.deletedAt || user.status !== "active" || user.isAgent || !user.totpConfirmedAt) {
    await endChallenge();
    return { error: "Sign in again." };
  }

  const verdict = await checkLoginThrottle(user.email, ip);
  if (!verdict.allowed) {
    return { error: `Too many attempts. Try again in ${verdict.retryAfterMinutes} minutes.` };
  }

  const secret = openSecret(user.totpSecret);
  const digits = typed.replace(/\D/g, "");

  let usedRecovery = false;
  let step: number | null = null;

  if (secret && digits.length === 6) {
    step = verifyCode(secret, digits, { usedStep: user.totpLastStep ?? null });
  }

  if (step === null) {
    /* A recovery code, then. Each one works once: the hash that matched is
       removed before the session is created, so a code read off a photo of
       the printout is already spent by the time anyone else tries it. */
    const stored = user.totpRecovery ?? [];
    const hit = stored.length ? matchRecovery(typed, stored) : null;
    if (!hit) {
      await audit({ id: user.id, tenantId: user.tenantId }, "auth.2fa.fail");
      return { error: "That code is not right." };
    }
    await db
      .update(users)
      .set({ totpRecovery: stored.filter((s) => s !== hit) })
      .where(eq(users.id, user.id));
    usedRecovery = true;
  } else {
    await db.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
  }

  await destroySession();
  await endChallenge();
  await createSession(user.id, { ip, userAgent: h.get("user-agent") ?? undefined });

  /* A recovery code means the authenticator was not to hand, which is the
     one case where remembering the browser is a bad idea. */
  if (trust && !usedRecovery) {
    await trustThisBrowser(user.id, { ip, userAgent: h.get("user-agent") ?? undefined });
  }

  await db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, user.id));
  await clearLoginThrottle(user.email);
  await audit({ id: user.id, tenantId: user.tenantId }, "auth.login", {
    meta: { secondFactor: usedRecovery ? "recovery" : "totp", trusted: trust && !usedRecovery },
  });

  redirect("/home");
}

/** "Back" on the code screen: the half-finished sign-in is dropped. */
export async function cancelSecondFactor() {
  await endChallenge();
  redirect("/login");
}

export async function signOut() {
  await destroySession();
  redirect("/login");
}
