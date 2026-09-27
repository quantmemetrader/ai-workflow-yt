"use client";

import { useEffect, useRef, useState } from "react";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AgentName } from "@/components/ui/Tr";
import { Icon } from "@/components/ui/Icon";
import { AGENT_KEYS, AGENT_LABELS, AGENT_TINTS, type AgentKey } from "@/lib/agents/catalog";

/**
 * Who answers, as one chip that opens a list: your assistant and every
 * employee, each with its face and what it does. It was a row of faces, one
 * per employee, and seven of them no longer fitted beside the formatting
 * buttons ("can have a dropdown here, all agents are not fitting").
 */
export function AnswerPicker({ answering, zh, onPick, soft }: { answering: AgentKey | null; zh: boolean; onPick: (k: AgentKey | null) => void; soft: (hex: string, a: number) => string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const pick = (k: AgentKey | null) => {
    setOpen(false);
    onPick(k);
  };
  const rows: (AgentKey | null)[] = [null, ...AGENT_KEYS];

  return (
    <span ref={root} style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <button
        type="button"
        className="answer"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={zh ? "选择谁来回答" : "Choose who answers"}
        style={{ background: answering ? soft(AGENT_TINTS[answering], 0.5) : "#f4f4f5", border: 0, cursor: "pointer", fontFamily: "inherit" }}
      >
        <AgentIcon agent={answering} size={20} radius={5} />
        {zh ? "回答：" : "Answering: "}
        <b>{answering ? <AgentName agent={answering} zh={zh} /> : zh ? "你的助理" : "Your agent"}</b>
        <span aria-hidden style={{ fontSize: 10, color: "#8a8a8a", marginLeft: 2 }}>{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <span
          role="listbox"
          aria-label={zh ? "谁来回答" : "Who answers"}
          style={{ position: "absolute", left: 0, bottom: "calc(100% + 6px)", zIndex: 40, width: 300, maxHeight: 380, overflowY: "auto", background: "#fff", border: "1px solid #e6e6e6", borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.12)", padding: 6, display: "flex", flexDirection: "column", gap: 2 }}
        >
          {rows.map((k) => {
            const current = k === answering;
            return (
              <button
                key={k ?? "assistant"}
                type="button"
                role="option"
                aria-selected={current}
                onClick={() => pick(k)}
                className="answer-row"
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 8px", border: 0, borderRadius: 8, background: current ? "#f4f4f5" : "transparent", cursor: "pointer", fontFamily: "inherit", textAlign: "left", width: "100%" }}
              >
                <AgentIcon agent={k} size={26} radius={7} />
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#171717" }}>{k ? <AgentName agent={k} zh={zh} /> : zh ? "你的助理" : "Your agent"}</span>
                  <span style={{ fontSize: 11.5, color: "#8a8a8a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {k ? (zh ? AGENT_LABELS[k].hint : AGENT_LABELS[k].hintEn) : zh ? "权限和你一样，什么都可以问" : "Same access as you; ask it anything"}
                  </span>
                </span>
                {current ? (
                  <span style={{ color: "#171717", display: "flex", flexShrink: 0 }}>
                    <Icon name="check" size={13} strokeWidth={2.4} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </span>
      ) : null}
    </span>
  );
}
