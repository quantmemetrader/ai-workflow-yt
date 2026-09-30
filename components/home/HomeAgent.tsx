"use client";

import { ResearchAgentPanel } from "@/components/canvas/ResearchAgentPanel";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { AgentHistory } from "@/components/shell/AgentHistory";

/** 首页's right side: your assistant, with the model picker (Ryan, 30 Sep: "home page right side too empty, add AI chat"). */
export function HomeAgent({ zh, model }: { zh: boolean; model: string }) {
  const agent = useInlineAgent({}, { key: "home", agent: null });
  return (
    <ResearchAgentPanel
      accent="#6d5bd0"
      zh={zh}
      scope={zh ? "你的助理" : "Your assistant"}
      note={zh ? "问任何事：查资料、看项目进度、派活给 AI 同事。" : "Ask anything: look things up, check projects, hand work to an AI colleague."}
      placeholder={zh ? "问你的助理…" : "Ask your assistant…"}
      model={model}
      onAsk={(prompt) => void agent.send(prompt)}
      tools={<AgentHistory zh={zh} current={agent.conversationId} onPick={(id) => void agent.load(id)} onNew={agent.reset} />}
      thread={<InlineAgentThread messages={agent.messages} notice={agent.notice} conversationId={agent.conversationId} zh={zh} />}
    />
  );
}
