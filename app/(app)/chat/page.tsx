import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import { AgentScreen, type ThreadMessage } from "@/components/canvas/AgentScreen";
import { AGENT_KEYS, type AgentKey } from "@/lib/agents/catalog";
import { conversationDetail } from "@/lib/chat/service";
import { agentHistoryFor, threadMessagesOf } from "@/lib/chat/thread";

export const metadata = { title: "聊天 · Chat" };

export default async function NewChatPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; agent?: string; fresh?: string }>;
}) {
  const viewer = await requireModule("chat");
  const { q, agent, fresh } = await searchParams;
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  /* `/chat?agent=script` — the sidebar's "AI 同事" list. The employee is
     tagged in the composer, which is exactly what typing "@编剧" would do, so
     the stream route routes it the same way and it can be deleted to ask the
     assistant instead. Anything that is not an employee is ignored. */
  const picked = typeof agent === "string" && (AGENT_KEYS as readonly string[]).includes(agent) ? (agent as AgentKey) : null;

  /*
   * An employee's page opens on what you have said to each other, not a
   * blank box: the newest of your conversations that employee answered in,
   * continuing in the same thread, with your other ones and what the
   * employee said lately in the channels beside it. `fresh` (the "新对话"
   * press) starts a new thread instead; a question handed over from another
   * screen (`q`) always does. With nothing yet, the empty state says what the
   * employee does and offers three things to ask.
   */
  const history = picked ? await agentHistoryFor(viewer, picked, null) : null;
  const openId = history && !fresh && !q ? (history.conversations[0]?.id ?? null) : null;
  const detail = openId ? await conversationDetail(viewer, openId) : null;
  const messages: ThreadMessage[] = detail ? threadMessagesOf(detail) : [];
  const lastModel = detail ? [...detail.messages].reverse().find((m) => m.model)?.model : null;

  return (
    <AgentScreen
      /* A new employee picked from the sidebar is a new screen, not an edit
         of the one on screen: keyed so the composer starts again with that
         tag, and so is the thread it opens. */
      key={`${picked ?? "host"}:${detail ? openId : fresh ? "fresh" : "new"}`}
      conversationId={detail ? openId : null}
      initialMessages={messages}
      locale={viewer.locale ?? "zh-CN"}
      model={lastModel ?? answeringModel()}
      initialPrompt={q}
      initialAgent={picked}
      history={history ? { ...history, currentId: detail ? openId : null } : null}
      now={new Date().toISOString()}
      me={{
        name: zh && viewer.nameLocal ? viewer.nameLocal : viewer.name,
        avatarUrl: viewer.avatarUrl,
      }}
    />
  );
}
