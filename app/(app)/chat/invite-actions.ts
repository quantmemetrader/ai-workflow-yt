"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getViewer } from "@/lib/auth/dal";
import { MODULES, type Module } from "@/lib/db/schema";
import { canInvite, createInvite, revokeInvite } from "@/lib/invites/service";
import { env } from "@/lib/env";
import { emailConfigured, inviteEmail, sendEmail } from "@/lib/email/send";

/**
 * Inviting a colleague, from the product rather than from a shell.
 *
 * Every one of these re-reads the viewer and re-checks the right to invite: a
 * server action is a public endpoint whatever the screen around it looked
 * like, and this one creates accounts.
 */
/**
 * The address the person is using right now, for the link they will pass on.
 *
 * `APP_URL` on the box was the bare IP and port, so every invitation copied
 * from Settings pointed there rather than at the studio's own domain. The
 * request already knows the host it was made on; the env is only the
 * fallback for a call with no host header.
 */
async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return env.appUrl.replace(/\/$/, "");
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function isModule(v: unknown): v is Module {
  return typeof v === "string" && (MODULES as readonly string[]).includes(v);
}

export type InviteResult =
  | { ok: false; error: string }
  | { ok: true; id: string; email: string; role: "admin" | "member" | "guest"; expiresAt: string; link: string; emailed: boolean; emailError: string | null };

export async function inviteAction(input: {
  email: string;
  name?: string;
  role?: string;
  modules?: string[];
}): Promise<InviteResult> {
  const viewer = await getViewer();
  if (!viewer || !canInvite(viewer)) {
    return { ok: false, error: "只有所有者或管理员可以邀请成员" };
  }

  const role =
    input.role === "admin" || input.role === "member" || input.role === "guest" ? input.role : "member";
  const modules = (input.modules ?? []).filter(isModule);
  if (!modules.length) return { ok: false, error: "至少选一个对方可以打开的模块" };

  try {
    const { invite, token } = await createInvite(viewer, {
      email: String(input.email ?? ""),
      name: input.name,
      role,
      modules,
    });
    revalidatePath("/settings");
    /*
     * No mail provider is configured on this deployment, so nothing is sent.
     * The link goes back to whoever made the invitation, to pass on however
     * they normally would. An invitation that silently goes nowhere would be
     * worse than one you have to copy.
     */
    const link = `${await origin()}/invite/${token}`;
    /* Emailed when the deployment has a mail service; the link comes back either way. */
    let emailed = false;
    let emailError: string | null = null;
    if (emailConfigured()) {
      const mail = inviteEmail({ to: invite.email, inviter: viewer.nameLocal || viewer.name, link, expires: invite.expiresAt.toISOString().slice(0, 10) });
      const sent = await sendEmail({ to: invite.email, ...mail });
      emailed = sent.ok;
      emailError = sent.ok ? null : sent.error;
    }
    return { ok: true, id: invite.id, email: invite.email, role, expiresAt: invite.expiresAt.toISOString(), link, emailed, emailError };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "没能创建邀请，稍后再试",
    };
  }
}

export async function revokeInviteAction(inviteId: string) {
  const viewer = await getViewer();
  if (!viewer || !canInvite(viewer)) return { error: "Not allowed" };
  if (typeof inviteId !== "string" || !inviteId || inviteId.length > 64) return { error: "Not allowed" };
  try {
    await revokeInvite(viewer, inviteId);
    revalidatePath("/settings");
    return {};
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Could not revoke that invitation" };
  }
}
