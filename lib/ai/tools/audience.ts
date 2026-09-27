import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatChannels, chatMembers, entitlements, users } from "@/lib/db/schema";
import { AGENT_LABELS, agentKeyFromEmail } from "@/lib/agents/catalog";
import type { ToolContext } from "./types";

/**
 * Whether this turn's answer may carry Legal's or Finance's records, and if
 * not, why.
 *
 * Both packs run as the viewer, and for 法务 and 财务 the viewer is the
 * employee, which holds its module. On that alone anybody in the studio could
 * read the contracts or the budget by asking 财务 in chat: the stream lets any
 * Chat holder talk to any employee, the same way a person without Video may
 * still ask 剪辑师 — who answers with its own tools, while the tools that pick
 * a project check it against the person who asked (`ToolContext.asker`). For a
 * video project that check is the project's access. For these two modules it
 * is the module itself, the test `lawyer()` and `finance()` make in the
 * screens' actions:
 *
 *   — somebody is behind the turn, and they hold the module. A chain an
 *     employee started on its own (the morning plan, a footage note) answers
 *     to nobody, and gets nothing;
 *   — and the answer reaches only people who hold it. The person's own
 *     conversation (`privateReply`) does. A channel does only when it is
 *     private and every person in it holds the module: a public channel is
 *     readable by the whole studio, whoever happens to have joined it.
 *
 * Null when the answer may go ahead; otherwise the sentence the model gets in
 * place of the records, saying what is missing and where to ask instead.
 */
export async function withheldFrom(ctx: ToolContext, module: "legal" | "finance"): Promise<string | null> {
  const employee = agentKeyFromEmail(ctx.viewer.email);
  const person = ctx.asker ?? (employee ? null : ctx.viewer);
  const label = module === "legal" ? "Legal (法务)" : "Finance (财务)";

  if (!person) {
    return `Nobody who holds the ${label} module asked for this, so its records are not read or changed on this turn. Say that a colleague with ${label} access has to ask.`;
  }
  if (!person.modules.includes(module)) {
    return `${person.nameLocal || person.name} does not hold the ${label} module, so its records are not theirs to see or change. Tell them so plainly, and that an administrator grants modules; do not guess at what is there.`;
  }
  // A person's own assistant, or an employee answering the person alone.
  if (!employee || ctx.privateReply) return null;

  if (ctx.channelId) {
    const [room] = await db
      .select({ isPrivate: chatChannels.isPrivate })
      .from(chatChannels)
      .where(and(eq(chatChannels.id, ctx.channelId), eq(chatChannels.tenantId, ctx.viewer.tenantId)))
      .limit(1);
    if (room?.isPrivate) {
      /* One person in the room without the module is enough to keep the
         records out; agents are left out, they hold what they were given. */
      const [outsider] = await db
        .select({ id: users.id })
        .from(chatMembers)
        .innerJoin(users, eq(users.id, chatMembers.userId))
        .leftJoin(entitlements, and(eq(entitlements.userId, users.id), eq(entitlements.module, module)))
        .where(
          and(
            eq(chatMembers.channelId, ctx.channelId),
            eq(users.isAgent, false),
            isNull(users.deletedAt),
            isNull(entitlements.userId),
          ),
        )
        .limit(1);
      if (!outsider) return null;
    }
  }

  const who = AGENT_LABELS[module].nameLocal;
  return `This answer is posted where people without ${label} access can read it, so its records stay out of it. Tell ${person.nameLocal || person.name} to ask ${who} directly — ${who} under "AI 同事" in Chat — where the answer is theirs alone.`;
}
