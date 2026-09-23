"use client";

import { ResearchAgentPanel } from "@/components/canvas/ResearchAgentPanel";
import { InlineAgentThread, useInlineAgent, type AgentContext } from "@/components/shell/InlineAgent";

/**
 * The agent, on a screen that has no other client wiring.
 *
 * Every module that already had an agent built the same four things by hand:
 * a `useInlineAgent`, a `ResearchAgentPanel`, an `InlineAgentThread` inside
 * it, and an `onAsk`. A server-rendered page cannot do any of that, which is
 * why Search and Settings — pages a person is quite likely to have a question
 * about — were the ones with no agent on them.
 *
 * This is those four things in a component a server page can drop in.
 */
export function AgentDock({
  zh,
  model,
  scope,
  note,
  placeholder,
  corner,
  dock = false,
  context = {},
}: {
  zh: boolean;
  model: string;
  /** What the agent is looking at, in the pill under the tab strip. */
  scope: string;
  /** One line of plain fact about this screen. */
  note: string;
  placeholder: string;
  corner?: string;
  /** Fill the space given rather than claiming a column of its own. */
  dock?: boolean;
  /** What is open on the screen this dock sits on, so the agent can act on it. */
  context?: AgentContext;
}) {
  const agent = useInlineAgent(context);

  return (
    <ResearchAgentPanel
      accent="#007be0"
      zh={zh}
      dock={dock}
      corner={corner}
      scope={scope}
      note={note}
      placeholder={placeholder}
      model={model}
      onAsk={(prompt) => void agent.send(prompt)}
      thread={
        <InlineAgentThread
          messages={agent.messages}
          notice={agent.notice}
          conversationId={agent.conversationId}
          zh={zh}
        />
      }
    />
  );
}
