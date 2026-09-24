"use client";

import * as React from "react";
import Link from "next/link";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AGENT_COLORS, AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import type { CardAction, CardDone } from "@/lib/agents/cards";

/**
 * One line back from the team channel, under the prompt box.
 *
 * You say something; a colleague answers in #制作. The home screen used to
 * show nothing (so it looked dead) and then the whole thread (so it looked
 * like a dump). This is the middle: the last thing an employee said, in one
 * line, with the press that opens the rest — and "answering…" while the
 * answer is on its way.
 */
export type ThreadMessage = {
  id: string;
  author: string;
  agent: AgentKey | null;
  body: string;
  at: string;
  actions: CardAction[];
  done: CardDone | null;
};

export function Echo({
  zh,
  channelName,
  channelSlug,
  messages,
  sentAt,
  waiting,
}: {
  zh: boolean;
  channelName: string;
  channelSlug: string;
  messages: ThreadMessage[];
  sentAt: string | null;
  waiting: boolean;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const href = `/chat/c/${encodeURIComponent(channelSlug)}`;
  /* The newest answer from an employee — after what you sent, if you sent. */
  const last = [...messages].reverse().find((m) => m.agent && (!sentAt || m.at > sentAt)) ?? null;

  if (!waiting && !last) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        marginTop: 10,
        padding: "8px 12px",
        border: "1px solid #ededed",
        borderRadius: 11,
        background: "#fafafa",
        minWidth: 0,
      }}
    >
      {waiting ? (
        <>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: "#278f5e", animation: "auraPulse 1.6s ease-in-out infinite", flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: "#525252" }}>{t(`已发到 #${channelName}，同事正在回复…`, `Sent to #${channelName}; a colleague is answering…`)}</span>
        </>
      ) : last ? (
        <>
          <AgentIcon agent={last.agent!} size={18} radius={5} />
          <span style={{ fontSize: 12.5, fontWeight: 600, color: AGENT_COLORS[last.agent!], whiteSpace: "nowrap" }}>
            {zh ? AGENT_LABELS[last.agent!].nameLocal : AGENT_LABELS[last.agent!].name}
          </span>
          <span style={{ fontSize: 12.5, color: "#525252", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {gist(last.body, 120)}
          </span>
        </>
      ) : null}
      <span style={{ flexGrow: 1 }} />
      <Link href={href} style={{ fontSize: 12, color: "#171717", textDecoration: "none", whiteSpace: "nowrap", fontWeight: 500 }}>
        {t("打开 #", "Open #")}
        {channelName} →
      </Link>
    </div>
  );
}

function gist(body: string, max: number): string {
  const text = body
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*[-•]\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).replace(/[，,、；;：:\s]+$/, "")}…` : text;
}
