"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getViewer } from "@/lib/auth/dal";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { destroyOtherSessions, readSessionToken } from "@/lib/auth/session";
import { forgetTrustedDevice, forgetTrustedDevices } from "@/lib/auth/second-factor";
import {
  hashRecovery,
  newRecoveryCodes,
  newSecret,
  open as openSecret,
  otpauthUrl,
  seal,
  verifyCode,
} from "@/lib/auth/totp";
import QRCode from "qrcode";
import {
  AUTOMATION_KEYS,
  setAutomation,
  type Automation,
  type AutomationKey,
} from "@/lib/automations/service";
import { audit } from "@/lib/audit";
import { isCatalogAvatar } from "@/lib/avatars/catalog";
import { deleteObject } from "@/lib/storage/r2";
import { env } from "@/lib/env";
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, type Locale } from "@/lib/i18n";
import { cookies } from "next/headers";

const ALLOWED: Locale[] = ["zh-CN", "en"];

/**
 * Turning one of the AI employees' standing jobs on or off, moving its time,
 * or handing it to a different colleague.
 *
 * Owner or admin only, re-checked here: a server action is a public endpoint
 * whatever the page around it looked like. The service validates the values
 * themselves, so a bad hour from a stale tab falls back to the default rather
 * than scheduling something at twenty-five o'clock.
 */
export async function setAutomationAction(key: AutomationKey, patch: Partial<Automation>) {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };
  if (viewer.role !== "owner" && viewer.role !== "admin") return { error: say(viewer, "你没有权限做这件事", "Not allowed") };
  if (!AUTOMATION_KEYS.includes(key)) return { error: say(viewer, "没有这项自动任务", "No such automation") };

  try {
    const saved = await setAutomation(viewer, key, patch ?? {});
    revalidatePath("/settings");
    return { automation: saved };
  } catch (err) {
    return { error: err instanceof Error ? err.message : say(viewer, "没能保存，请再试一次", "Could not save that") };
  }
}

export async function setLocaleAction(locale: Locale) {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };
  if (!ALLOWED.includes(locale)) return { error: say(viewer, "不支持这种语言", "Unknown language") };

  await db.update(users).set({ locale }).where(eq(users.id, viewer.id));
  /* And on the sign-in screen, which has no session to read it from. */
  (await cookies()).set(LANG_COOKIE, locale, {
    maxAge: LANG_COOKIE_MAX_AGE,
    /* Secure exactly when the session cookie is. */
    secure: env.cookieSecure,
    sameSite: "lax",
    path: "/",
  });
  revalidatePath("/", "layout");
  return {};
}

/** A refusal in the person's own language: Simplified Chinese unless they
 * chose English (QA, 3 Oct: these reached the Chinese screen in English). */
function say(viewer: { locale?: string | null }, zh: string, en: string): string {
  return (viewer.locale ?? "zh-CN").startsWith("zh") ? zh : en;
}

/* ------------------------------------------------------------- your own */

export type ProfileState = { error?: string; ok?: boolean };

/**
 * Your own name, as colleagues see it.
 *
 * Only ever your own: there is no user id in the arguments, so this cannot be
 * used to rename somebody else. An admin renaming a colleague is a different
 * action, in Admin, and it is audited as one.
 *
 * The Chinese name is kept separate rather than replacing the other: the
 * studio works in both, and screens pick by locale.
 */
export async function updateProfileAction(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };

  const name = String(formData.get("name") ?? "").trim();
  const nameLocal = String(formData.get("nameLocal") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();

  if (!name) return { error: say(viewer, "请填写同事能看到的名字。", "You need a name people can see.") };
  if (name.length > 120 || nameLocal.length > 120 || title.length > 120) {
    return { error: say(viewer, "名字太长了。", "That is longer than a name needs to be.") };
  }

  await db
    .update(users)
    .set({ name, nameLocal: nameLocal || null, title: title || null })
    .where(eq(users.id, viewer.id));

  await audit(viewer, "user.profile.change", { meta: { name } });
  revalidatePath("/", "layout");
  return { ok: true };
}

export type AvatarResult = { avatarUrl: string | null; error?: undefined } | { error: string };

/**
 * Your own picture, from the chooser: one of the catalog's, or `null` to go
 * back to the default your id picks (`lib/avatars/default.ts`). An uploaded
 * photo goes through `POST /api/avatar` instead, which stores the file.
 *
 * Only ever your own, like the name above: there is no user id in the
 * arguments. And only a picture on offer — a value off the wire is checked
 * against the catalog, so this cannot point everybody's screens at an
 * arbitrary URL (a tracking pixel, a colleague's photo route).
 *
 * A photo it replaces is deleted from storage and its key cleared. The photo
 * route serves whatever key the row holds, so leaving it would keep handing
 * colleagues the face this person just took down. The saved value is the
 * catalog file's path, so a new choice is a new URL and shows on the next
 * render without any cache to wait out.
 */
export async function setAvatarAction(choice: string | null): Promise<AvatarResult> {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };
  if (choice !== null && !isCatalogAvatar(choice)) {
    return { error: say(viewer, "只能从提供的头像里选。", "That is not one of the pictures on offer.") };
  }

  const [before] = await db
    .select({ key: users.avatarKey })
    .from(users)
    .where(eq(users.id, viewer.id))
    .limit(1);

  await db.update(users).set({ avatarUrl: choice, avatarKey: null }).where(eq(users.id, viewer.id));
  if (before?.key) await deleteObject(before.key).catch(() => {});

  await audit(viewer, "user.avatar.change", { meta: { choice: choice ?? "default" } });
  revalidatePath("/", "layout");
  return { avatarUrl: choice };
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
  if (!viewer) return { error: "请先登录" };

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");

  if (next.length < 12) return { error: say(viewer, "新密码至少要 12 个字符。", "Use at least 12 characters.") };
  if (next.length > 1024) return { error: say(viewer, "密码太长了。", "That password is too long.") };
  if (next === current) return { error: say(viewer, "新密码不能和当前密码相同。", "That is the password you already have.") };

  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, viewer.id))
    .limit(1);

  if (!(await verifyPassword(current, row?.passwordHash ?? null))) {
    return { error: say(viewer, "当前密码不正确。", "That is not your current password.") };
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

/* ---------------------------------------------- two-step verification */

/**
 * Turning on two-step verification, in three steps that cannot be skipped.
 *
 *   1. `beginTotpAction` writes a sealed secret and hands back the QR. The
 *      account is *not* protected yet — `totpConfirmedAt` is still null — so
 *      somebody who scans the code and then closes the laptop is not locked
 *      out of their own account tomorrow.
 *   2. `confirmTotpAction` takes one code from the app. Only a code the app
 *      actually produced turns it on, which is what proves the QR was really
 *      scanned rather than dismissed.
 *   3. The recovery codes are shown once, at confirmation, and never again.
 *      They are stored hashed; nobody, including an admin, can read them back.
 *
 * Turning it off asks for the password, because "the screen was unlocked" is
 * exactly the situation a second factor exists for.
 */
export type TotpBeginState = {
  error?: string;
  secret?: string;
  otpauth?: string;
  qrSvg?: string;
};

export async function beginTotpAction(): Promise<TotpBeginState> {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };

  const secret = newSecret();
  await db
    .update(users)
    .set({ totpSecret: seal(secret), totpConfirmedAt: null, totpLastStep: null })
    .where(eq(users.id, viewer.id));

  const otpauth = otpauthUrl(secret, viewer.email);
  // Rendered on the server: the seed never has to reach an image service, and
  // the page works with no script of its own.
  const qrSvg = await QRCode.toString(otpauth, { type: "svg", margin: 0, width: 184 });

  await audit(viewer, "auth.2fa.begin");
  return { secret, otpauth, qrSvg };
}

export type TotpConfirmState = { error?: string; codes?: string[] };

export async function confirmTotpAction(
  _prev: TotpConfirmState,
  formData: FormData,
): Promise<TotpConfirmState> {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };

  const typed = String(formData.get("code") ?? "").replace(/\D/g, "");
  if (typed.length !== 6) return { error: say(viewer, "请输入验证器应用里的 6 位验证码。", "Enter the 6-digit code from the app.") };

  const [row] = await db
    .select({ secret: users.totpSecret, confirmedAt: users.totpConfirmedAt })
    .from(users)
    .where(eq(users.id, viewer.id))
    .limit(1);

  const secret = openSecret(row?.secret ?? null);
  if (!secret) return { error: say(viewer, "这次设置已过期，请重新开始。", "Start again — that setup has expired.") };
  if (row?.confirmedAt) return { error: say(viewer, "两步验证已经开启。", "Two-step verification is already on.") };

  const step = verifyCode(secret, typed);
  if (step === null) return { error: say(viewer, "验证码不正确，请检查手机的时间是否准确。", "That code is not right. Check the clock on your phone.") };

  const codes = newRecoveryCodes();
  await db
    .update(users)
    .set({
      totpConfirmedAt: new Date(),
      totpLastStep: step,
      totpRecovery: codes.map(hashRecovery),
    })
    .where(eq(users.id, viewer.id));

  /* A browser trusted against an older enrolment must not skip the new one. */
  await forgetTrustedDevices(viewer.id);

  await audit(viewer, "auth.2fa.enable");
  revalidatePath("/settings");
  return { codes };
}

export type TotpOffState = { error?: string; ok?: boolean };

export async function disableTotpAction(_prev: TotpOffState, formData: FormData): Promise<TotpOffState> {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };

  const password = String(formData.get("password") ?? "");
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, viewer.id))
    .limit(1);
  if (!(await verifyPassword(password, row?.passwordHash ?? null))) {
    return { error: say(viewer, "密码不正确。", "That is not your password.") };
  }

  await db
    .update(users)
    .set({ totpSecret: null, totpConfirmedAt: null, totpLastStep: null, totpRecovery: null })
    .where(eq(users.id, viewer.id));
  await forgetTrustedDevices(viewer.id);

  await audit(viewer, "auth.2fa.disable");
  revalidatePath("/settings");
  return { ok: true };
}

/** A fresh set. The old ones stop working the moment these are shown. */
export async function newRecoveryCodesAction(): Promise<{ error?: string; codes?: string[] }> {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };

  const [row] = await db
    .select({ confirmedAt: users.totpConfirmedAt })
    .from(users)
    .where(eq(users.id, viewer.id))
    .limit(1);
  if (!row?.confirmedAt) return { error: say(viewer, "两步验证还没有开启。", "Two-step verification is not on.") };

  const codes = newRecoveryCodes();
  await db.update(users).set({ totpRecovery: codes.map(hashRecovery) }).where(eq(users.id, viewer.id));
  await audit(viewer, "auth.2fa.recovery.reissue");
  revalidatePath("/settings");
  return { codes };
}

export async function forgetDeviceAction(id: string) {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };
  if (typeof id !== "string" || id.length > 128) return { error: say(viewer, "你没有权限做这件事", "Not allowed") };
  await forgetTrustedDevice(viewer.id, id);
  await audit(viewer, "auth.2fa.device.forget", { meta: { id: id.slice(0, 12) } });
  revalidatePath("/settings");
  return {};
}

export async function forgetAllDevicesAction() {
  const viewer = await getViewer();
  if (!viewer) return { error: "请先登录" };
  await forgetTrustedDevices(viewer.id);
  await audit(viewer, "auth.2fa.device.forget-all");
  revalidatePath("/settings");
  return {};
}
