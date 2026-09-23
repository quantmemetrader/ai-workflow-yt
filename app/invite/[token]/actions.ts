"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { acceptInvite } from "@/lib/invites/service";
import { createSession } from "@/lib/auth/session";

export type AcceptState = { error?: string };

/**
 * Create the account behind an invitation, and sign the person straight in.
 *
 * The token is claimed inside `acceptInvite`, in the statement that reads it,
 * so two tabs on the same link cannot both make an account.
 */
export async function acceptInviteAction(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "");
  const password = String(formData.get("password") ?? "");

  const result = await acceptInvite(token, { name, password });
  if ("error" in result) return { error: result.error };

  const h = await headers();
  await createSession(result.userId, {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: h.get("user-agent") ?? undefined,
  });

  redirect("/chat");
}
