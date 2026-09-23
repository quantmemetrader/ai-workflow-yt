import { requireModule } from "@/lib/auth/dal";
import { answeringModel } from "@/lib/ai/models";
import { AgentScreen } from "@/components/canvas/AgentScreen";

export const metadata = { title: "聊天 · Chat" };

export default async function NewChatPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const viewer = await requireModule("chat");
  const { q } = await searchParams;
  const zh = (viewer.locale ?? "zh-CN").startsWith("zh");

  return (
    <AgentScreen
      conversationId={null}
      initialMessages={[]}
      locale={viewer.locale ?? "zh-CN"}
      model={answeringModel()}
      initialPrompt={q}
      me={{
        name: zh && viewer.nameLocal ? viewer.nameLocal : viewer.name,
        avatarUrl: viewer.avatarUrl,
      }}
    />
  );
}
