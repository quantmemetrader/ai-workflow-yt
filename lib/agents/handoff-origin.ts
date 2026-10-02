import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentMessages, conversations, settings } from "@/lib/db/schema";
import { newId } from "@/lib/ids";
import type { AgentKey } from "./catalog";

/**
 * Which private chat handed a piece of work on, so the colleague's answer is
 * shown there too.
 *
 * "帮我请策划落实" in somebody's own assistant chat posts the hand-off in
 * #制作 (or the project's chat), and 策划 answers *there*. The person who
 * asked, looking at their assistant chat, saw a promise and never an answer
 * (Avon, 2 Oct: "一直收不到回应"). `assign_task` notes the conversation here;
 * when the colleague's reply is posted, the same words are written into that
 * conversation as the colleague, then the note is forgotten. The same idea
 * as `film-origin.ts`, for any hand-off.
 */
const key = (messageId: string) => `chat:handoff-origin:${messageId}`;
const TTL_MS = 6 * 60 * 60_000;

export async function rememberHandoffOrigin(messageId: string, conversationId: string): Promise<void> {
  const value = { conversationId, at: new Date().toISOString() };
  await db.insert(settings).values({ key: key(messageId), value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/** Write a colleague's reply into the chat that handed the work on, once. */
export async function answerHandoffOrigin(messageId: string, speaker: AgentKey, text: string, where: string | null): Promise<void> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key(messageId))).limit(1);
  const v = row?.value as { conversationId?: string; at?: string } | undefined;
  if (!v?.conversationId || !v.at || Date.now() - Date.parse(v.at) > TTL_MS) return;
  const [convo] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, v.conversationId)).limit(1);
  await db.delete(settings).where(eq(settings.key, key(messageId)));
  if (!convo) return;
  const body = where ? `${text}\n\n（回复自 ${where}）` : text;
  await db.insert(agentMessages).values({ id: newId("am"), conversationId: convo.id, role: "assistant", content: body, status: "complete", module: "chat", speaker });
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, convo.id));
}
