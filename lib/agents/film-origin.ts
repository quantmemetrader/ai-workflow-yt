import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentMessages, conversations, settings } from "@/lib/db/schema";
import { newId } from "@/lib/ids";

/**
 * Which private chat asked for a film, so the film is answered there.
 *
 * "@剪辑师 make this video" from a private chat started the film, and the
 * "渲染好了" line with its card went to #制作 and the project's channel only —
 * the chat it was asked in said nothing ("you are not even showing the video
 * in chat"). make_video notes the conversation here; the worker's done/failed
 * narration posts the same line, with the card, into it, then forgets it.
 */
const key = (videoProjectId: string) => `chat:film-origin:${videoProjectId}`;
const TTL_MS = 3 * 60 * 60_000;

export async function rememberFilmOrigin(videoProjectId: string, conversationId: string): Promise<void> {
  const value = { conversationId, at: new Date().toISOString() };
  await db.insert(settings).values({ key: key(videoProjectId), value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/** Post a finished (or failed) film's line into the chat that asked for it, once. */
export async function answerFilmOrigin(videoProjectId: string, text: string, fileId: string | null): Promise<void> {
  const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key(videoProjectId))).limit(1);
  const v = row?.value as { conversationId?: string; at?: string } | undefined;
  if (!v?.conversationId || !v.at || Date.now() - Date.parse(v.at) > TTL_MS) return;
  const [convo] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, v.conversationId)).limit(1);
  await db.delete(settings).where(eq(settings.key, key(videoProjectId)));
  if (!convo) return;
  /* The download link carries the file id, which is what draws the video
     card under the line when the thread is read (`videoRefsOf`). */
  const body = fileId ? `${text}\n\n[下载成片](/api/files/${fileId}/download?download=1)` : text;
  await db.insert(agentMessages).values({ id: newId("am"), conversationId: convo.id, role: "assistant", content: body, status: "complete", module: "video", speaker: "video" });
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, convo.id));
}
