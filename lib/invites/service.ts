import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditLog, entitlements, invites, users, type Module } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/dal";
import { hashPassword } from "@/lib/auth/password";
import { audit } from "@/lib/audit";
import { newId } from "@/lib/ids";

/**
 * Inviting somebody to the studio.
 *
 * The `invites` table has existed since the first migration and nothing ever
 * wrote to it: people were created by running `npm run db:add-user` over SSH,
 * which means only whoever holds the box can add anybody, and the studio's own
 * owner cannot.
 *
 * The link carries a random token; the row holds only its hash, exactly as a
 * session does, so a leaked database row cannot be replayed as an invitation.
 *
 * There is no mail provider configured on this deployment, so nothing is sent.
 * The link is handed back to the person who made the invitation, to pass on
 * however they normally would. Saying so plainly is the point: an invitation
 * that silently goes nowhere is worse than one you have to copy.
 */
const TTL_DAYS = 14;

/** Thrown inside the accept transaction when the link was claimed first. */
class AlreadyUsed extends Error {}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export type InviteRow = {
  id: string;
  email: string;
  name: string | null;
  role: "owner" | "admin" | "member" | "guest";
  modules: Module[];
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
};

/** Who may invite. Adding a colleague is not a thing a guest does. */
export function canInvite(viewer: Viewer): boolean {
  return viewer.role === "owner" || viewer.role === "admin";
}

export async function createInvite(
  viewer: Viewer,
  input: { email: string; name?: string | null; role?: InviteRow["role"]; modules: Module[] },
): Promise<{ invite: InviteRow; token: string }> {
  if (!canInvite(viewer)) throw new Error("Only an owner or an administrator can invite people");

  const email = input.email.trim().toLowerCase();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("That does not look like an email address");
  }

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, viewer.tenantId), eq(users.email, email), isNull(users.deletedAt)))
    .limit(1);
  if (existing) throw new Error("Somebody with that address is already in the studio");

  const role = input.role ?? "member";
  if (role === "owner") throw new Error("A studio has one owner, and it is not handed over by invitation");

  const token = randomBytes(32).toString("base64url");
  const id = newId("inv");
  const expiresAt = new Date(Date.now() + TTL_DAYS * 86_400_000);

  // One live invitation per address: re-inviting replaces the old link rather
  // than leaving two doors open.
  await db
    .delete(invites)
    .where(and(eq(invites.tenantId, viewer.tenantId), eq(invites.email, email), isNull(invites.acceptedAt)));

  const [row] = await db
    .insert(invites)
    .values({
      id,
      tenantId: viewer.tenantId,
      email,
      name: input.name?.trim() || null,
      role,
      modules: input.modules,
      tokenHash: tokenHash(token),
      invitedBy: viewer.id,
      expiresAt,
    })
    .returning();

  await audit(viewer, "admin.invite.create", {
    objectType: "invite",
    objectId: id,
    meta: { email, role, modules: input.modules },
  });

  return {
    invite: {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      modules: row.modules,
      expiresAt: row.expiresAt,
      acceptedAt: row.acceptedAt,
      createdAt: row.createdAt,
    },
    token,
  };
}

export async function listInvites(viewer: Viewer): Promise<InviteRow[]> {
  if (!canInvite(viewer)) return [];
  const rows = await db
    .select()
    .from(invites)
    .where(eq(invites.tenantId, viewer.tenantId))
    .orderBy(desc(invites.createdAt))
    .limit(50);
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    modules: r.modules,
    expiresAt: r.expiresAt,
    acceptedAt: r.acceptedAt,
    createdAt: r.createdAt,
  }));
}

export async function revokeInvite(viewer: Viewer, inviteId: string): Promise<void> {
  if (!canInvite(viewer)) throw new Error("Not allowed");
  await db
    .delete(invites)
    .where(and(eq(invites.id, inviteId), eq(invites.tenantId, viewer.tenantId), isNull(invites.acceptedAt)));
  await audit(viewer, "admin.invite.revoke", { objectType: "invite", objectId: inviteId });
}

/** The invitation behind a link, if it is still good. No viewer: this is read
 * by somebody who does not have an account yet. */
export async function inviteByToken(token: string) {
  if (!token || token.length > 200) return null;
  const [row] = await db
    .select()
    .from(invites)
    .where(eq(invites.tokenHash, tokenHash(token)))
    .limit(1);
  if (!row) return null;
  if (row.acceptedAt) return null;
  if (row.expiresAt.getTime() < Date.now()) return null;
  return row;
}

/**
 * Turn an invitation into an account.
 *
 * The token is claimed in the same statement that reads it (`accepted_at is
 * null` in the where clause), so two browsers opening the same link cannot
 * both create an account.
 */
export async function acceptInvite(
  token: string,
  input: { name: string; password: string },
): Promise<{ userId: string } | { error: string }> {
  const invite = await inviteByToken(token);
  if (!invite) return { error: "That invitation has been used already, or it has expired." };

  const name = input.name.trim();
  if (!name || name.length > 120) return { error: "Please give the name you want to be known by." };
  if (input.password.length < 10) return { error: "A password needs at least 10 characters." };
  if (input.password.length > 1024) return { error: "That password is too long." };

  const userId = newId("usr");
  const passwordHash = await hashPassword(input.password);

  /*
   * One transaction. The claim and the account are made together, so a link
   * is never spent on an account that was not made: an insert refused by the
   * database (an address already on a soft-deleted account, say) rolls the
   * claim back and the person sees a message instead of a dead invitation.
   */
  try {
    await db.transaction(async (trx) => {
      const claimed = await trx
        .update(invites)
        .set({ acceptedAt: new Date() })
        .where(and(eq(invites.id, invite.id), isNull(invites.acceptedAt)))
        .returning({ id: invites.id });
      if (!claimed.length) throw new AlreadyUsed();

      await trx.insert(users).values({
        id: userId,
        tenantId: invite.tenantId,
        email: invite.email,
        // The name the person typed, not the one the inviter guessed at: the
        // form offers the guess as a default and this is the correction.
        name,
        role: invite.role,
        status: "active",
        passwordHash,
      });

      if (invite.modules.length) {
        await trx
          .insert(entitlements)
          .values(invite.modules.map((m) => ({ userId, module: m, grantedBy: invite.invitedBy })))
          .onConflictDoNothing();
      }

      // No viewer exists for the person being created, so this is written
      // against the new account itself rather than through `audit`.
      await trx.insert(auditLog).values({
        id: newId("aud"),
        tenantId: invite.tenantId,
        actorId: userId,
        action: "admin.invite.accept",
        objectType: "invite",
        objectId: invite.id,
      });
    });
  } catch (err) {
    if (err instanceof AlreadyUsed) return { error: "That invitation has been used already." };
    console.error("[invites] accept failed", err);
    return { error: "The account could not be created. Ask whoever invited you to send a fresh link." };
  }

  return { userId };
}
