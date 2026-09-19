"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { destroyOtherSessions, readSessionToken } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import type { Locale } from "@/lib/i18n";

const ALLOWED: Locale[] = ["zh-CN", "zh-HK", "en"];

export async function setLocaleAction(locale: Locale) {
  const viewer = await getViewer();
  if (!viewer) return { error: "Not signed in" };
  if (!ALLOWED.includes(locale)) return { error: "Unknown language" };

  await db.update(users).set({ locale }).where(eq(users.id, viewer.id));
  revalidatePath("/", "layout");
  return {};
}

export type PasswordState = { error?: string; ok?: boolean };

/**
 * Changes the signed-in person's own password.
 *
 * Three rules, all of them the reason this exists rather than a script:
 *   — the current password is required, so an unlocked screen is not a
 *     takeover;
 *   — every *other* session is destroyed, because a password change is what
 *     someone does when they think a session is not theirs any more;
 *   — this one stays, so changing it does not sign you out of the tab you are
 *     sitting in.
 */
export async function changePasswordAction(
  _prev: PasswordState,
  formData: FormData,
): Promise<PasswordState> {
  const viewer = await getViewer();
  if (!viewer) return { error: "Not signed in" };

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");

  if (next.length < 12) return { error: "Use at least 12 characters." };
  if (next.length > 1024) return { error: "That password is too long." };
  if (next === current) return { error: "That is the password you already have." };

  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, viewer.id))
    .limit(1);

  if (!(await verifyPassword(current, row?.passwordHash ?? null))) {
    return { error: "That is not your current password." };
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(users.id, viewer.id));

  const token = await readSessionToken();
  await destroyOtherSessions(viewer.id, token);

  await audit(viewer, "auth.password.change");
  revalidatePath("/settings");
  return { ok: true };
}
