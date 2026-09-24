"use client";

import * as React from "react";
import Link from "next/link";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { Markdown } from "@/components/ui/Markdown";
import { AGENT_COLORS, AGENT_LABELS, parseAgentMentions, type AgentKey } from "@/lib/agents/catalog";
import type { CardAction, CardDone } from "@/lib/agents/cards";

/**
 * The last few things said in the team channel, on the home screen.
 *
 * You say something in the box above; the employee you tagged answers in
 * #制作 a few seconds later. Without this the home screen swallowed the
 * question and showed nothing back — "I tagged the research agent and
 * nothing happened" — while the answer sat one page away. So the channel's
 * tail is here, with the same buttons, and it refreshes while an answer is
 * on its way.
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

export function TeamThread({
  zh,
  channelName,
  channelSlug,
  messages,
  waiting,
  pressing,
  onPress,
}: {
  zh: boolean;
  channelName: string;
  channelSlug: string;
  messages: ThreadMessage[];
  /** Something was just sent and the answer has not arrived. */
  waiting: boolean;
  pressing: string | null;
  onPress: (messageId: string, actionId: string) => void;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const href = `/chat/c/${encodeURIComponent(channelSlug)}`;

  return (
    <section style={{ border: "1px solid #ededed", borderRadius: 14, background: "#ffffff", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 16px", borderBottom: "1px solid #f3f3f3" }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{t(`刚才在 #${channelName}`, `Just now in #${channelName}`)}</span>
        {waiting ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#278f5e" }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, background: "#278f5e", animation: "auraPulse 1.6s ease-in-out infinite" }} />
            {t("同事正在回复…", "A colleague is answering…")}
          </span>
        ) : (
          <span style={{ fontSize: 11.5, color: "#999999" }}>{t("同事在这里回你", "Where the team answers you")}</span>
        )}
        <span style={{ flexGrow: 1 }} />
        <Link href={href} style={{ fontSize: 12, color: "#525252", textDecoration: "none" }}>
          {t("打开频道 →", "Open the channel →")}
        </Link>
      </div>

      {messages.length === 0 ? (
        <p style={{ margin: 0, padding: "14px 16px", fontSize: 12.5, color: "#999999" }}>
          {t("还没有人说话。上面说一句，@ 一位同事。", "Nothing yet. Say something above and @ a colleague.")}
        </p>
      ) : (
        messages.map((m, i) => {
          const tags = parseAgentMentions(m.body);
          return (
            <div
              key={m.id}
              style={{ display: "flex", gap: 10, padding: "11px 16px", borderTop: i === 0 ? 0 : "1px solid #f3f3f3" }}
            >
              {m.agent ? (
                <AgentIcon agent={m.agent} size={26} radius={8} />
              ) : (
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: "#e2e2e2",
                    color: "#525252",
                    fontSize: 11,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {m.author.slice(0, 1).toUpperCase()}
                </span>
              )}
              <div style={{ minWidth: 0, flexGrow: 1 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: m.agent ? AGENT_COLORS[m.agent] : "#171717" }}>{m.author}</span>
                  {m.agent ? (
                    <span style={{ fontSize: 11, color: "#999999" }}>{zh ? AGENT_LABELS[m.agent].title : AGENT_LABELS[m.agent].titleEn}</span>
                  ) : null}
                  <span style={{ fontSize: 11, color: "#c7c7c7" }}>{clock(m.at)}</span>
                </div>
                <div style={{ marginTop: 3, fontSize: 13, lineHeight: 1.6, color: "#2b343d" }}>
                  <Markdown text={m.body} />
                </div>
                {tags.length ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "#999999" }}>{t("交给", "Over to")}</span>
                    {tags.map((k) => (
                      <span
                        key={k}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          height: 22,
                          padding: "0 8px",
                          borderRadius: 7,
                          border: "1px solid #e2e2e2",
                          fontSize: 11,
                          color: "#171717",
                        }}
                      >
                        <AgentIcon agent={k} size={12} radius={4} />
                        {zh ? AGENT_LABELS[k].nameLocal : AGENT_LABELS[k].name}
                      </span>
                    ))}
                  </div>
                ) : null}
                {m.actions.length ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 9, flexWrap: "wrap" }}>
                    {m.done ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 999, background: "#e4faeb", color: "#1f7a4d", fontSize: 11.5, fontWeight: 500 }}>
                        ✓ {zh ? `${m.done.by} 选了「${m.actions.find((a) => a.id === m.done?.actionId)?.label ?? "…"}」` : `${m.done.by} chose “${m.actions.find((a) => a.id === m.done?.actionId)?.labelEn ?? "…"}”`}
                      </span>
                    ) : (
                      m.actions.map((a, j) =>
                        a.kind === "open" ? (
                          <Link key={a.id} href={a.href ?? "#"} style={btn(false)}>
                            {zh ? a.label : a.labelEn}
                          </Link>
                        ) : (
                          <button
                            key={a.id}
                            type="button"
                            disabled={pressing !== null}
                            onClick={() => onPress(m.id, a.id)}
                            style={{ ...btn(j === 0), cursor: "pointer", opacity: pressing === m.id + a.id ? 0.55 : 1 }}
                          >
                            {zh ? a.label : a.labelEn}
                          </button>
                        ),
                      )
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}

function btn(primary: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    height: 27,
    padding: "0 11px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
    fontFamily: "inherit",
    letterSpacing: "inherit",
    textDecoration: "none",
    border: `1px solid ${primary ? "#171717" : "#e2e2e2"}`,
    background: primary ? "#171717" : "#ffffff",
    color: primary ? "#ffffff" : "#383838",
  };
}

function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Hong_Kong", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}
