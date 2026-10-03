import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { agentKeyFromEmail } from "@/lib/agents/catalog";
import type { ToolContext } from "./types";

/**
 * Who a tool acts for when it touches somebody's own things.
 *
 * An employee runs as itself, and an employee may reach far more than the
 * person who asked it (`ToolContext.asker`). Moving, sharing or deleting a
 * person's files, or starting a project they will own, is done as that
 * person and through the same checks their own screen makes. With no person
 * behind the turn (a chain an employee started on its own) there is nobody
 * to act for, and the tool refuses.
 */
export function personOf(ctx: ToolContext): Viewer | null {
  if (ctx.asker) return ctx.asker;
  return agentKeyFromEmail(ctx.viewer.email) ? null : ctx.viewer;
}

export const NO_PERSON =
  "Nobody asked for this in this turn, so there is nobody to act for: this changes a person's own things and is only done when a person asks. Nothing was changed.";

export type Colleague = { id: string; name: string; email: string; isAgent: boolean };

/**
 * A colleague in this studio from whatever the model wrote: an email, a
 * name, a Chinese name, an @-tag. Exact matches first, then a unique partial
 * one; more than one partial match is returned as a list so the model can
 * ask which one rather than guess.
 */
export async function findColleague(
  viewer: Viewer,
  raw: string,
  opts: { people?: boolean } = {},
): Promise<{ one: Colleague } | { many: Colleague[] } | { none: true }> {
  const wanted = raw.trim().replace(/^@/, "").toLowerCase();
  if (!wanted) return { none: true };
  const rows = await db
    .select({ id: users.id, name: users.name, nameLocal: users.nameLocal, email: users.email, isAgent: users.isAgent, status: users.status })
    .from(users)
    .where(and(eq(users.tenantId, viewer.tenantId), isNull(users.deletedAt)));
  const live = rows.filter((u) => (u.isAgent || u.status === "active") && (!opts.people || !u.isAgent));
  const shape = (u: (typeof live)[number]): Colleague => ({ id: u.id, name: u.nameLocal || u.name, email: u.email, isAgent: u.isAgent });
  const exact = live.filter(
    (u) => u.email.toLowerCase() === wanted || u.name.toLowerCase() === wanted || (u.nameLocal ?? "").toLowerCase() === wanted,
  );
  if (exact.length === 1) return { one: shape(exact[0]) };
  if (exact.length > 1) return { many: exact.map(shape) };
  const partial = live.filter(
    (u) =>
      u.name.toLowerCase().includes(wanted) ||
      (u.nameLocal ?? "").toLowerCase().includes(wanted) ||
      u.email.toLowerCase().split("@")[0] === wanted,
  );
  if (partial.length === 1) return { one: shape(partial[0]) };
  if (partial.length > 1) return { many: partial.slice(0, 8).map(shape) };
  return { none: true };
}

/** The answer when a name matched nobody, or several people. */
export function colleagueRefusal(raw: string, found: { many: Colleague[] } | { none: true }): string {
  if ("many" in found) {
    return `"${raw}" could be any of: ${found.many.map((c) => `${c.name} (${c.email})`).join(", ")}. Ask which one; nothing was changed.`;
  }
  return `Nobody in this studio is called "${raw}". Nothing was changed.`;
}
