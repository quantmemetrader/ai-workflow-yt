"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { NO_SUCH_USER_HASH, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";
import { checkLoginThrottle, clearLoginThrottle } from "@/lib/auth/throttle";
import { audit } from "@/lib/audit";

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

  // Whatever session this browser arrived holding is finished with. The cookie
  // is replaced either way, but the old row would otherwise stay valid for its
  // full 30 days for anyone else who has that token.
  await destroySession();

  await createSession(user.id, {
    ip,
    userAgent: h.get("user-agent") ?? undefined,
  });
  // Records the visit only. Signing in must never change account state: the
  // old version wrote status = 'active' here, which let a sign-in promote an
  // account an admin had not switched on.
  await db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, user.id));
  await clearLoginThrottle(email);
  await audit({ id: user.id, tenantId: user.tenantId }, "auth.login");

  redirect("/chat");
}

export async function signOut() {
  await destroySession();
  redirect("/login");
}
