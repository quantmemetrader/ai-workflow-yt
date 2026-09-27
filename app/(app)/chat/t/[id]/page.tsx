import { AGENT_KEYS, type AgentKey } from "@/lib/agents/catalog";
import { notFound } from "next/navigation";
import { requireModule } from "@/lib/auth/dal";
import { conversationDetail, listConversations } from "@/lib/chat/service";
import { answeringModel } from "@/lib/ai/models";
import { AgentScreen } from "@/components/canvas/AgentScreen";
import { agentHistoryFor, threadMessagesOf } from "@/lib/chat/thread";

export default async function ConversationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ agent?: string }> }) {
  const { id } = await params;
  const { agent } = await searchParams;
  const viewer = await requireModule("chat");

  // A conversation belongs to one person; someone else's id is a 404, not a 403.
  const detail = await conversationDetail(viewer, id);
  if (!detail) notFound();

  const messages = await threadMessagesOf(viewer, detail);
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  const lastModel = [...detail.messages].reverse().find((m) => m.model)?.model;
  /* Picking the thread up again continues with whoever answered last — the
     composer starts with their tag, which one × takes back off. */
  const lastSpeaker = [...messages].reverse().find((m) => m.role === "assistant")?.speaker ?? null;
  /* A thread an employee answered in is one of that employee's: the page
     shows the person's other threads with them, and what they said lately
     in the channels, the same as `/chat?agent=…` does. */
  /* An employee's page only when it was opened as one (`?agent=`, from the
     employee's list or their 新对话): opened as your own assistant's chat
     ("你的助理"), it stays the assistant's, whoever answered last — it used
     to turn into 剪辑师's page, and its 新对话 into a new editor chat. */
  const asked = typeof agent === "string" && (AGENT_KEYS as readonly string[]).includes(agent) ? (agent as AgentKey) : null;
  const history = asked ? await agentHistoryFor(viewer, asked, id) : null;
  const recent = asked ? null : (await listConversations(viewer, 15)).map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString() }));

  return (
    <AgentScreen
      conversationId={id}
      initialMessages={messages}
      locale={viewer.locale ?? "zh-CN"}
      model={lastModel ?? answeringModel()}
      initialAgent={asked ? lastSpeaker : null}
      history={history}
      recent={recent}
      /* The composer's paperclip goes through /api/files/presign, which
         refuses anybody without the Files module. */
      canAttach={viewer.modules.includes("files")}
      now={new Date().toISOString()}
      me={{
        id: viewer.id,
        name: zh && viewer.nameLocal ? viewer.nameLocal : viewer.name,
        avatarUrl: viewer.avatarUrl,
      }}
    />
  );
}
