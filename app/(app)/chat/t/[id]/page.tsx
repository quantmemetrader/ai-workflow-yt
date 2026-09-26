import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { conversationDetail } from "@/lib/chat/service";
import { answeringModel } from "@/lib/ai/models";
import { AgentScreen } from "@/components/canvas/AgentScreen";
import { agentHistoryFor, threadMessagesOf } from "@/lib/chat/thread";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireModule("chat");

  // A conversation belongs to one person; someone else's id is a 404, not a 403.
  const detail = await conversationDetail(viewer, id);
  if (!detail) notFound();

  const messages = threadMessagesOf(detail);
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const lastModel = [...detail.messages].reverse().find((m) => m.model)?.model;
  /* Picking the thread up again continues with whoever answered last — the
     composer starts with their tag, which one × takes back off. */
  const lastSpeaker = [...messages].reverse().find((m) => m.role === "assistant")?.speaker ?? null;
  /* A thread an employee answered in is one of that employee's: the page
     shows the person's other threads with them, and what they said lately
     in the channels, the same as `/chat?agent=…` does. */
  const history = lastSpeaker ? await agentHistoryFor(viewer, lastSpeaker, id) : null;

  return (
    <AgentScreen
      conversationId={id}
      initialMessages={messages}
      locale={viewer.locale ?? "zh-CN"}
      model={lastModel ?? answeringModel()}
      initialAgent={lastSpeaker}
      history={history}
      now={new Date().toISOString()}
      me={{
        name: zh && viewer.nameLocal ? viewer.nameLocal : viewer.name,
        avatarUrl: viewer.avatarUrl,
      }}
    />
  );
}
