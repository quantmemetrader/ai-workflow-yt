import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { conversationDetail } from "@/lib/chat/service";
import { answeringModel } from "@/lib/ai/models";
import { AgentScreen, type ThreadMessage } from "@/components/canvas/AgentScreen";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireModule("chat");

  // A conversation belongs to one person; someone else's id is a 404, not a 403.
  const detail = await conversationDetail(viewer, id);
  if (!detail) notFound();

  const messages: ThreadMessage[] = detail.messages
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

  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const lastModel = [...detail.messages].reverse().find((m) => m.model)?.model;

  return (
    <AgentScreen
      conversationId={id}
      initialMessages={messages}
      locale={viewer.locale ?? "zh-CN"}
      model={lastModel ?? answeringModel()}
      me={{
        name: zh && viewer.nameLocal ? viewer.nameLocal : viewer.name,
        avatarUrl: viewer.avatarUrl,
      }}
    />
  );
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
