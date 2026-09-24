"use client";

import * as React from "react";
import Link from "next/link";
import { AgentMark } from "@/components/chat/MentionMenu";
import type { AgentKey } from "@/lib/agents/catalog";

type Line = { agent: string; text: string; live: boolean; href: string; at: string };

/**
 * The line in the top bar that says what the team is doing.
 *
 * One line, rotating, on every page: a render at 62%, what 研究员 said this
 * morning, 编剧 answering three minutes ago. It is how a page about invoices
 * still feels like part of a studio where five employees are at work — and
 * a green dot when one of them actually is.
 *
 * Polled every twenty seconds; goes quiet, not blank, when nothing has
 * happened for hours.
 */
export function Pulse({ zh }: { zh: boolean }) {
  const [lines, setLines] = React.useState<Line[]>([]);
  const [i, setI] = React.useState(0);

  React.useEffect(() => {
    let stop = false;
    async function poll() {
      if (stop || document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/pulse", { cache: "no-store" });
        if (!res.ok) return;
        const { lines: next } = (await res.json()) as { lines: Line[] };
        setLines(next ?? []);
      } catch {
        // A dropped poll is not worth a word; the next one runs.
      }
    }
    void poll();
    const id = setInterval(poll, 20_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  React.useEffect(() => {
    if (lines.length < 2) return;
    const id = setInterval(() => setI((n) => (n + 1) % lines.length), 6_000);
    return () => clearInterval(id);
  }, [lines.length]);

  if (!lines.length) return null;
  const line = lines[i % lines.length];
  const anyLive = lines.some((l) => l.live);

  return (
    <Link
      href={line.href}
      title={zh ? "同事们在做什么 · 点开看" : "What the team is doing"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        minWidth: 0,
        maxWidth: 380,
        height: 24,
        padding: "0 9px 0 6px",
        borderRadius: 999,
        border: "1px solid #ededed",
        background: "#ffffff",
        color: "#525252",
        fontSize: 11.5,
        textDecoration: "none",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          flexShrink: 0,
          background: line.live ? "#278f5e" : anyLive ? "#a7dcbf" : "#d9d9d9",
          boxShadow: line.live ? "0 0 0 3px rgba(39,143,94,0.15)" : "none",
        }}
      />
      <AgentMark agent={line.agent as AgentKey} size={14} radius={4} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
        {line.text}
      </span>
      {!line.live ? <span style={{ color: "#b3b3b3", flexShrink: 0 }}>{ago(line.at, zh)}</span> : null}
    </Link>
  );
}

function ago(iso: string, zh: boolean): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return zh ? "刚刚" : "now";
  if (mins < 60) return zh ? `${mins} 分钟前` : `${mins}m`;
  const h = Math.round(mins / 60);
  return zh ? `${h} 小时前` : `${h}h`;
}
