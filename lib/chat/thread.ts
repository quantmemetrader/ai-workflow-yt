import "server-only";
import type { Viewer } from "@/lib/auth/types";
import { AGENT_KEYS, type AgentKey } from "@/lib/agents/catalog";
import { agentChannelLines, conversationDetail, conversationsWithAgent } from "@/lib/chat/service";
import type { AgentHistory, ThreadMessage } from "@/components/canvas/AgentScreen";

/**
 * A person's conversation as the agent screen draws it, shared by the
 * thread page (`/chat/t/[id]`) and an employee's page (`/chat?agent=…`),
 * which opens the newest thread that employee answered in.
 */
export function threadMessagesOf(detail: NonNullable<Awaited<ReturnType<typeof conversationDetail>>>): ThreadMessage[] {
  return detail.messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      status: m.status as ThreadMessage["status"],
      error: m.error,
      model: m.model,
      costMicros: Number(m.costMicros ?? 0),
      withheld: m.withheld,
      /* Who answered, as stored by the stream route. Without it a reloaded
         thread drew every employee's answer as the host's. */
      speaker: asAgentKey(m.speaker),
      createdAt: m.createdAt.toISOString(),
      citations: detail.citations
        .filter((c) => c.messageId === m.id)
        .map((c) => ({
          fileId: c.fileId,
          name: c.name,
          kind: c.kind,
          folder: c.folder,
          relation: c.relation,
        })),
      tools: detail.toolCalls
        .filter((c) => c.messageId === m.id)
        .map((c) => ({
          id: c.id,
          name: c.name,
          status: c.status,
          durationMs: c.durationMs,
          summary: summarise(c.name, c.args as Record<string, unknown>, c.durationMs),
        })),
    }));
}

/**
 * Everything an employee's page shows around the conversation: this
 * person's other threads with that employee, and what the employee said
 * lately in the channels this person can read. `currentId` is the thread
 * on screen, if any.
 */
export async function agentHistoryFor(viewer: Viewer, agent: AgentKey, currentId: string | null): Promise<AgentHistory> {
  const [conversations, lines] = await Promise.all([conversationsWithAgent(viewer, agent, 12), agentChannelLines(viewer, agent, 6)]);
  return { agent, currentId, conversations, lines };
}

/** A stored speaker, if it still names an employee. */
export function asAgentKey(value: string | null): AgentKey | null {
  return value && (AGENT_KEYS as readonly string[]).includes(value) ? (value as AgentKey) : null;
}

/** The one-line trace the artboard shows beside a tool chip. */
function summarise(name: string, args: Record<string, unknown>, ms: number | null): string {
  const secs = ms ? ` · ${(ms / 1000).toFixed(1)} s` : "";
  switch (name) {
    case "search_files":
      return `Searched files for “${args.query ?? ""}”${secs}`;
    case "read_file":
      return `Read a document${secs}`;
    case "list_recent_files":
      return `Listed recent files${secs}`;
    case "create_document":
      return `Wrote “${args.title ?? "a document"}”${secs}`;
    case "check_ai_spend":
      return `Checked AI spend${secs}`;
    default:
      return name + secs;
  }
}
