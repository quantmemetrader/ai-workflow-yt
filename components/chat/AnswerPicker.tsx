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
/** A tint at an opacity, when the caller has no helper of its own. */
const tintAt = (hex: string, a: number) => `${hex}${Math.round(a * 255).toString(16).padStart(2, "0")}`;

export function AnswerPicker({
  answering,
  zh,
  onPick,
  soft = tintAt,
  align = "left",
  quick = 4,
  prefer = [],
}: {
  answering: AgentKey | null;
  zh: boolean;
  onPick: (k: AgentKey | null) => void;
  soft?: (hex: string, a: number) => string;
  align?: "left" | "right";
  /** How many faces sit beside the chip for one press; the rest are behind 「+N」. */
  quick?: number;
  /** Who comes first among the faces (the employee this screen is about). */
  prefer?: AgentKey[];
}) {
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
  /* A few faces for one press, the rest one press further: "multiple there, then a dropdown". */
  const order = [...prefer, ...AGENT_KEYS.filter((k) => !prefer.includes(k))].filter((k) => k !== answering);
  const faces = order.slice(0, Math.max(0, quick));
  const rest = order.length - faces.length;

  return (
    <span ref={root} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <button
        type="button"
        className="answer"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={zh ? "选择谁来回答" : "Choose who answers"}
        /* Styled here, not by the chat screen's stylesheet: the side panels use it too, and there the chip came out as loose text. */
        style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 8px 0 4px", borderRadius: 8, fontSize: 12, lineHeight: 1, color: "#525252", whiteSpace: "nowrap", flexShrink: 0, background: answering ? soft(AGENT_TINTS[answering], 0.5) : "#f4f4f5", border: 0, cursor: "pointer", fontFamily: "inherit" }}
      >
        <AgentIcon agent={answering} size={20} radius={5} />
        {zh ? "回答：" : "Answering: "}
        <b style={{ fontWeight: 600, color: "#171717" }}>{answering ? <AgentName agent={answering} zh={zh} /> : zh ? "你的助理" : "Your agent"}</b>
        <span aria-hidden style={{ fontSize: 10, color: "#8a8a8a", marginLeft: 2 }}>{open ? "▴" : "▾"}</span>
      </button>
      {faces.map((k) => (
        <button
          key={k}
          type="button"
          className="answer-face"
          onClick={() => pick(k)}
          aria-label={zh ? `问${AGENT_LABELS[k].nameLocal}` : `Ask ${AGENT_LABELS[k].nameEn}`}
          title={zh ? `问${AGENT_LABELS[k].nameLocal}：${AGENT_LABELS[k].hint}` : `Ask ${AGENT_LABELS[k].nameEn}: ${AGENT_LABELS[k].hintEn}`}
          style={{ display: "flex", padding: 2, border: "1px solid transparent", borderRadius: 7, background: "transparent", cursor: "pointer", flexShrink: 0 }}
        >
          <AgentIcon agent={k} size={22} radius={6} />
        </button>
      ))}
      {rest > 0 ? (
        <button
          type="button"
          className="answer-face"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={zh ? `还有 ${rest} 位同事` : `${rest} more colleagues`}
          title={zh ? "更多同事" : "More colleagues"}
          style={{ display: "inline-flex", alignItems: "center", gap: 2, height: 26, padding: "0 7px", border: "1px solid #e6e6e6", borderRadius: 7, background: "#fff", color: "#525252", fontFamily: "inherit", fontSize: 11.5, fontWeight: 600, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap" }}
        >
          +{rest}
          <span aria-hidden style={{ fontSize: 9, color: "#8a8a8a" }}>{open ? "▴" : "▾"}</span>
        </button>
      ) : null}
      {open ? (
        <span
          role="listbox"
          aria-label={zh ? "谁来回答" : "Who answers"}
          style={{ position: "absolute", ...(align === "right" ? { right: 0 } : { left: 0 }), bottom: "calc(100% + 6px)", zIndex: 40, width: 300, maxHeight: 470, overflowY: "auto", background: "#fff", border: "1px solid #e6e6e6", borderRadius: 12, boxShadow: "0 12px 32px rgba(0,0,0,0.12)", padding: 6, display: "flex", flexDirection: "column", gap: 2 }}
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
