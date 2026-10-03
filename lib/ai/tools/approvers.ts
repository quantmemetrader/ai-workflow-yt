import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { entitlements, users } from "@/lib/db/schema";
import type { Viewer } from "@/lib/auth/types";
import { agentKeyFromEmail } from "@/lib/agents/catalog";
import { dmChannelWith, postMessage } from "@/lib/chat/service";
import type { ToolContext } from "./types";

/**
 * Who may be asked to approve a script or an article, from whatever the model
 * wrote: an id, a name, a Chinese name, an email.
 *
 * Only people — never an AI employee — who are active in this studio and hold
 * the Script module (Article rides on it), and never the one asking: the
 * screens refuse an agent or the requester as approver, so these tools do too.
 */
export type Approver = { id: string; name: string };

export async function resolveApprover(
  viewer: Viewer,
  wanted: string,
  exclude: string[],
): Promise<{ ok: Approver } | { error: string }> {
  const rows = await db
    .select({ id: users.id, name: users.name, nameLocal: users.nameLocal, email: users.email })
    .from(users)
    .innerJoin(entitlements, and(eq(entitlements.userId, users.id), eq(entitlements.module, "script")))
    .where(and(eq(users.tenantId, viewer.tenantId), eq(users.status, "active"), eq(users.isAgent, false), inArray(users.role, ["owner", "admin", "member"])))
    .orderBy(asc(users.name));
  const people = rows.filter((r) => !exclude.includes(r.id));
  const label = (r: (typeof rows)[number]) => (r.nameLocal && r.nameLocal !== r.name ? `${r.nameLocal} (${r.name})` : r.name);
  const choices = people.slice(0, 20).map((r) => `- ${label(r)} (id: ${r.id})`).join("\n");
  if (!wanted) {
    return { error: people.length ? `Say who should approve it. People who can:\n${choices}` : "Nobody else in the studio holds the Script module, so nobody can be asked to approve." };
  }
  const w = wanted.replace(/^@/, "").trim().toLowerCase();
  const exact = people.filter((r) => r.id === wanted || r.name.toLowerCase() === w || (r.nameLocal ?? "").toLowerCase() === w || r.email.toLowerCase() === w);
  const loose = exact.length
    ? exact
    : people.filter((r) => r.name.toLowerCase().includes(w) || (r.nameLocal ?? "").toLowerCase().includes(w) || (w.length >= 2 && w.includes((r.nameLocal || r.name).toLowerCase())));
  if (loose.length === 1) return { ok: { id: loose[0].id, name: loose[0].nameLocal || loose[0].name } };
  if (loose.length > 1) return { error: `"${wanted}" could be more than one person:\n${loose.slice(0, 10).map((r) => `- ${label(r)} (id: ${r.id})`).join("\n")}\nAsk which one, or pass the id.` };
  if (rows.some((r) => exclude.includes(r.id) && (r.id === wanted || r.name.toLowerCase() === w || (r.nameLocal ?? "").toLowerCase() === w))) {
    return { error: "The one writing or asking cannot be the approver: somebody else has to approve it. Nothing was sent." };
  }
  return { error: `Nobody called "${wanted}" can approve (only people in this studio with the Script module can).${people.length ? ` People who can:\n${choices}` : ""}` };
}

/** The person behind the turn, never an employee: who decides, publishes or takes down. */
export function personOf(ctx: ToolContext): Viewer | null {
  return ctx.asker ?? (agentKeyFromEmail(ctx.viewer.email) ? null : ctx.viewer);
}

export const NO_PERSON =
  "Only a person can do this, and nobody is behind this turn (it was started by a colleague, not by a person). Nothing was done. Say that the person concerned has to ask, or do it on the page.";

/** A direct message, best effort: the record is the approval, not the note about it. */
export async function tellPerson(from: Viewer, userId: string, body: string, meta?: Record<string, unknown>): Promise<boolean> {
  if (userId === from.id) return false;
  try {
    const dm = await dmChannelWith(from, userId);
    if (!dm) return false;
    await postMessage(from, dm.channel.id, body, meta);
    return true;
  } catch (err) {
    console.error("[tools] could not send the note", err);
    return false;
  }
}

export const nameOf = (v: Viewer) => v.nameLocal || v.name;
