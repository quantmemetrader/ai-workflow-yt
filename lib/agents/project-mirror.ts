import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { chatMembers, workProjects } from "@/lib/db/schema";
import { agentViewer } from "@/lib/agents";
import type { AgentKey } from "@/lib/agents/catalog";
import { postMessage } from "@/lib/chat/service";

/**
 * Work done for a project from somewhere else — a private chat with 文案 or
 * 剪辑师 — said in the project's own chat too, so the project shows what
 * happened to it. It used to read "项目对话 0" while the script had been
 * written and the video started in a private chat.
 */
export async function mirrorToProject(tenantId: string, projectId: string, agent: AgentKey, text: string, meta: Record<string, unknown> = {}): Promise<void> {
  const [wp] = await db
    .select({ id: workProjects.id, title: workProjects.title, channelId: workProjects.channelId })
    .from(workProjects)
    .where(and(eq(workProjects.id, projectId), eq(workProjects.tenantId, tenantId), isNull(workProjects.deletedAt)))
    .limit(1);
  if (!wp?.channelId) return;
  const speaker = await agentViewer(tenantId, agent);
  await db.insert(chatMembers).values({ channelId: wp.channelId, userId: speaker.id }).onConflictDoNothing();
  await postMessage(speaker, wp.channelId, text, { ...meta, agent, project: { id: wp.id, title: wp.title } });
}
