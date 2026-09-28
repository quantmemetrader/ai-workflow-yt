"use client";

import * as React from "react";
import Link from "next/link";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AgentTyping } from "@/components/agents/AgentTyping";
import { SayToAgent } from "@/components/flow/SayToAgent";
import { AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";

export type TeamMember = {
  key: AgentKey;
  status: "working" | "waiting" | "idle";
  /** What it is doing, or the last thing it said. */
  line: string | null;
  /** When that was, ISO. */
  at: string | null;
};

/**
 * The AI colleagues, each with its face, what it is doing, and the presses a
 * person uses with a colleague: 派任务 (give it work, right here), 聊天
 * (its own chat), and on the team page 训练 (its instructions and examples).
 *
 * The studio thinks of these as colleagues — the whole product is "AI
 * employees" (the owner, 28 Sep: they said a hundred times they want the
 * agents) — so they stay in plain sight on Home and on their own page.
 */
export function TeamBoard({ team, zh, full = false }: { team: TeamMember[]; zh: boolean; full?: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [giveTo, setGiveTo] = React.useState<AgentKey | null>(null);
  const [sent, setSent] = React.useState<Partial<Record<AgentKey, number>>>({});
  const name = (k: AgentKey) => (zh ? AGENT_LABELS[k].nameLocal : AGENT_LABELS[k].nameEn);
  const hint = (k: AgentKey) => (zh ? AGENT_LABELS[k].hint : AGENT_LABELS[k].hintEn);

  return (
    <div style={{ display: "grid", gridTemplateColumns: full ? "repeat(auto-fill, minmax(300px, 1fr))" : "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
      {team.map((a) => {
        const on = giveTo === a.key;
        const typing = Boolean(sent[a.key]) && a.status !== "idle";
        return (
          <div key={a.key} style={{ display: "flex", flexDirection: "column", gap: 10, padding: full ? "16px 16px 14px" : "12px 12px 10px", borderRadius: 12, border: `1px solid ${on ? "#c9c8c2" : "#ecebe7"}`, background: "#fff", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <AgentIcon agent={a.key} size={full ? 40 : 34} radius={full ? 11 : 9} />
              <div style={{ minWidth: 0, flexGrow: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <span style={{ fontSize: full ? 15 : 14, fontWeight: 600, color: "#171717" }}>{name(a.key)}</span>
                  <Status status={a.status} zh={zh} />
                </div>
                <div style={{ fontSize: 12, color: "#8a8a8a", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{hint(a.key)}</div>
              </div>
            </div>
            <div title={a.line ?? undefined} style={{ fontSize: 12.5, lineHeight: 1.55, color: a.line ? "#4a4a4a" : "#b5b5b1", minHeight: full ? 40 : 20, display: "-webkit-box", WebkitLineClamp: full ? 2 : 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {typing ? <AgentTyping agent={a.key} zh={zh} face={false} size="sm" /> : a.line ? clean(a.line) : t("还没开始干活", "Nothing yet")}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" onClick={() => setGiveTo(on ? null : a.key)} aria-expanded={on} style={btn(true, on)}>
                {on ? t("收起", "Close") : t("派任务", "Assign")}
              </button>
              <Link prefetch={false} href={`/chat?agent=${a.key}`} style={btn(false)}>
                {t("聊天", "Chat")}
              </Link>
              {full ? (
                <Link prefetch={false} href={`/train/${a.key}`} style={btn(false)}>
                  {t("训练", "Train")}
                </Link>
              ) : null}
            </div>
            {on ? (
              <SayToAgent
                agent={a.key}
                zh={zh}
                onDone={() => {
                  setGiveTo(null);
                  setSent((m) => ({ ...m, [a.key]: Date.now() }));
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function clean(line: string): string {
  return line
    .replace(/[*_#>`]+/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .slice(0, 160);
}

function Status({ status, zh }: { status: TeamMember["status"]; zh: boolean }) {
  const [label, color, bg] =
    status === "working" ? [zh ? "工作中" : "Working", "#0b7a63", "#e3f4ee"] : status === "waiting" ? [zh ? "等你" : "Waiting on you", "#a35f00", "#fbf0dc"] : [zh ? "空闲" : "Free", "#8a8a8a", "#f3f3f1"];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 500, color, background: bg, borderRadius: 999, padding: "0 7px", lineHeight: "18px", whiteSpace: "nowrap" }}>
      {status === "working" ? <span style={{ width: 5, height: 5, borderRadius: 3, background: color, animation: "auraPulse 1.4s ease-in-out infinite" }} /> : null}
      {label}
    </span>
  );
}

function btn(primary: boolean, on = false): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    height: 30,
    padding: "0 12px",
    borderRadius: 8,
    fontSize: 12.5,
    fontWeight: 600,
    fontFamily: "inherit",
    textDecoration: "none",
    cursor: "pointer",
    border: `1px solid ${primary ? (on ? "#d6d5d0" : "#171717") : "#dcdbd6"}`,
    background: primary ? (on ? "#f5f5f3" : "#171717") : "#fff",
    color: primary ? (on ? "#333" : "#fff") : "#333",
  };
}
