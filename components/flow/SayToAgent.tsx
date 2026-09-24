"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import { startProposalAction } from "@/app/(app)/home/actions";

/**
 * A line to one colleague about one step, typed where the step is drawn.
 *
 * "Should be able to comment here directly or work directly here." It posts
 * to #制作 as the person, tagging the step's owner and naming the step, the
 * same door as typing `@编剧 …` in the channel (`startProposalAction`).
 */
export function SayToAgent({
  agent,
  about,
  zh,
  onDone,
  autoFocus = true,
  compact = false,
}: {
  agent: AgentKey;
  /** The step this is about, prefixed to the line so the colleague knows. */
  about?: string;
  zh: boolean;
  onDone?: () => void;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const name = zh ? AGENT_LABELS[agent].nameLocal : AGENT_LABELS[agent].name;

  async function send() {
    const line = text.trim();
    if (!line || sending) return;
    setSending(true);
    setError(null);
    /* A fetch-free server action, but a short one: it posts and returns;
       the colleague's answer is dispatched after the response. */
    const res = await startProposalAction(agent, about ? `${zh ? "关于「" : "About “"}${about}${zh ? "」：" : "”: "}${line}` : line);
    setSending(false);
    if ("error" in res && res.error) {
      setError(res.error);
      return;
    }
    setText("");
    setSent(true);
    router.refresh();
    onDone?.();
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: compact ? 4 : 6, border: "1px solid #e2e2e2", borderRadius: 10, background: "#fff", boxShadow: "0 4px 14px rgba(0,0,0,0.06)" }}
      >
        <AgentIcon agent={agent} size={22} radius={6} />
        <input
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onDone?.();
          }}
          placeholder={zh ? `跟${name}说…` : `Tell ${name}…`}
          style={{ flexGrow: 1, minWidth: 0, height: 28, border: 0, outline: "none", background: "transparent", fontFamily: "inherit", fontSize: 12.5, letterSpacing: "inherit", color: "#171717" }}
        />
        <button
          type="submit"
          disabled={!text.trim() || sending}
          style={{ height: 28, padding: "0 11px", borderRadius: 8, border: 0, background: text.trim() ? "#171717" : "#ededed", color: text.trim() ? "#fff" : "#999", fontFamily: "inherit", fontSize: 12, fontWeight: 500, cursor: text.trim() ? "pointer" : "default", opacity: sending ? 0.6 : 1, flexShrink: 0 }}
        >
          {zh ? "发送" : "Send"}
        </button>
      </form>
      {error ? <span style={{ fontSize: 11.5, color: "#e03636" }}>{error}</span> : sent ? <span style={{ fontSize: 11.5, color: "#278f5e" }}>{zh ? `已发到 #制作，${name}会回复` : `Sent to #制作; ${name} will answer`}</span> : null}
    </div>
  );
}
