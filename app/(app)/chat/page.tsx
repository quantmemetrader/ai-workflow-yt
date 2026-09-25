import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import { AgentScreen } from "@/components/canvas/AgentScreen";
import { AGENT_KEYS, type AgentKey } from "@/lib/agents/catalog";

export const metadata = { title: "聊天 · Chat" };

export default async function NewChatPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; agent?: string }>;
}) {
  const viewer = await requireModule("chat");
  const { q, agent } = await searchParams;
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");
  /* `/chat?agent=script` — the sidebar's "AI 同事" list. The employee is
     tagged in the composer, which is exactly what typing "@编剧" would do, so
     the stream route routes it the same way and it can be deleted to ask the
     assistant instead. Anything that is not an employee is ignored. */
  const picked = typeof agent === "string" && (AGENT_KEYS as readonly string[]).includes(agent) ? (agent as AgentKey) : null;

  return (
    <AgentScreen
      /* A new employee picked from the sidebar is a new draft, not an edit of
         the one on screen: keyed so the composer starts again with that tag. */
      key={picked ?? "host"}
      conversationId={null}
      initialMessages={[]}
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
      initialPrompt={q}
      initialAgent={picked}
      now={new Date().toISOString()}
      me={{
        name: zh && viewer.nameLocal ? viewer.nameLocal : viewer.name,
        avatarUrl: viewer.avatarUrl,
      }}
    />
  );
}
