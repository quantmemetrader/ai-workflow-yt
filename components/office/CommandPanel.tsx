"use client";

import * as React from "react";
import { ResearchAgentPanel } from "@/components/canvas/ResearchAgentPanel";
import { InlineAgentThread, useInlineAgent } from "@/components/shell/InlineAgent";
import { AgentHistory } from "@/components/shell/AgentHistory";
import { agentTag, type AgentKey } from "@/lib/agents/catalog";
import type { LookKey } from "@/components/office/art";

export type CommandPanelHandle = {
  /** Put this colleague in the composer ("@编剧 "), or the assistant for "host". */
  pick: (key: LookKey) => void;
  /** Send these words to this colleague now (the desk popover's 派任务). */
  say: (key: LookKey, text: string) => void;
};

/**
 * 指挥中心: the office's right side, the same agent panel Home uses (the
 * @ picker, the model chip, attachments, history), so a person can message
 * any colleague from here.
 *
 * Picking a colleague on the floor writes their tag at the front of the
 * composer, exactly what the panel's own picker does, so the panel's
 * "who answers" chip and placeholder follow it. The panel keeps its draft to
 * itself, so the tag goes in through the textarea's value setter and an
 * input event, which React treats as typing. (Office view, 2 Oct.)
 */
export const CommandPanel = React.forwardRef<CommandPanelHandle, { zh: boolean; model: string; onSpeaking?: (key: LookKey | null) => void }>(function CommandPanel({ zh, model, onSpeaking }, ref) {
  const agent = useInlineAgent({}, { key: "office", agent: null });
  const wrap = React.useRef<HTMLDivElement | null>(null);

  React.useImperativeHandle(
    ref,
    () => ({
      say(key, text) {
        const tag = key === "host" ? "" : agentTag(key as AgentKey);
        void agent.send(`${tag} ${text}`.trim());
      },
      pick(key) {
        const box = wrap.current?.querySelector("textarea");
        if (!box) return;
        const rest = box.value.replace(/^@\S+\s*/, "");
        const next = key === "host" ? rest : `${agentTag(key as AgentKey)} ${rest}`;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(box, next);
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.focus();
        box.setSelectionRange(next.length, next.length);
      },
    }),
    [agent],
  );

  /* Whoever is answering right now is at work on the floor too: that is a
     fact the page knows before the next refresh does. */
  const last = agent.messages[agent.messages.length - 1];
  const speaking: LookKey | null = last && last.role === "assistant" && last.status === "streaming" ? (last.speaker ?? "host") : null;
  React.useEffect(() => {
    onSpeaking?.(speaking);
  }, [speaking, onSpeaking]);

  return (
    <div ref={wrap} style={{ display: "contents" }}>
      <ResearchAgentPanel
        accent="#3a2f3d"
        zh={zh}
        scope={zh ? "指挥中心" : "Command centre"}
        note={zh ? "点办公室里的同事，或者在下面 @ 一位，直接交代。回答会写在这里。" : "Click a colleague in the office, or @ one below, and say what you need. Answers land here."}
        placeholder={zh ? "交代点什么…" : "Tell the team…"}
        model={model}
        attach
        onAsk={(prompt, files) => void agent.send(prompt, files)}
        tools={<AgentHistory zh={zh} current={agent.conversationId} onPick={(id) => void agent.load(id)} onNew={agent.reset} />}
        thread={<InlineAgentThread messages={agent.messages} notice={agent.notice} conversationId={agent.conversationId} zh={zh} />}
      />
    </div>
  );
});
