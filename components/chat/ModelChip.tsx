"use client";

import * as React from "react";
import { AUTO_MODEL, CHAT_MODELS, chatModel } from "@/lib/ai/chat-models";

/**
 * 「模型：自动 ▾」 in a composer: which model answers the messages sent from
 * this box. One message's choice, not the studio's (that stays in 设置);
 * the list is plain words first, the model's real name small and grey.
 */
export function ModelChip({
  value,
  onChange,
  zh,
  placement = "up",
  align = "right",
}: {
  value: string;
  onChange: (id: string) => void;
  zh: boolean;
  placement?: "up" | "down";
  align?: "left" | "right";
}) {
  const [open, setOpen] = React.useState(false);
  /* Where the list floats: fixed to the window from the chip's own box, so no
     card or panel it sits in can clip it; above the chip when there is room
     (or when asked), else below. */
  const [at, setAt] = React.useState<React.CSSProperties | null>(null);
  const box = React.useRef<HTMLSpanElement | null>(null);
  const toggle = () => {
    if (open) return setOpen(false);
    const r = box.current?.getBoundingClientRect();
    if (r) {
      const listH = 440;
      const up = placement === "up" ? r.top > listH || r.top > window.innerHeight - r.bottom : r.bottom + listH > window.innerHeight && r.top > window.innerHeight - r.bottom;
      const horiz = align === "right" ? { right: Math.max(8, window.innerWidth - r.right) } : { left: Math.max(8, r.left) };
      setAt(up ? { bottom: window.innerHeight - r.top + 6, ...horiz } : { top: r.bottom + 6, ...horiz });
    }
    setOpen(true);
  };
  const now = chatModel(value);

  React.useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <span ref={box} style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={zh ? "这条消息用哪个模型回答" : "Which model answers this message"}
        style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 28, padding: "0 8px", border: "1px solid #e7e6e2", borderRadius: 8, background: value === AUTO_MODEL ? "#fff" : "#f4f4f2", color: "#404040", fontFamily: "inherit", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        <span style={{ color: "#8a8a8a" }}>{zh ? "模型" : "Model"}</span>
        <b style={{ fontWeight: 600, color: "#171717" }}>{zh ? now.zh : now.en}</b>
        <svg viewBox="0 0 24 24" width={11} height={11} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
          <path d={placement === "up" ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
        </svg>
      </button>
      {open ? (
        <div
          role="listbox"
          aria-label={zh ? "选模型" : "Choose a model"}
          style={{
            position: "fixed",
            ...(at ?? { bottom: 60, right: 16 }),
            zIndex: 90,
            maxHeight: "calc(100vh - 24px)",
            overflowY: "auto",
            width: 272,
            padding: 6,
            background: "#fff",
            border: "1px solid #e7e6e2",
            borderRadius: 12,
            boxShadow: "0 12px 32px rgba(0,0,0,.12)",
          }}
        >
          <div style={{ padding: "4px 8px 6px", fontSize: 11.5, color: "#8a8a8a" }}>{zh ? "只对这里发的消息有效" : "Only for messages sent from here"}</div>
          {CHAT_MODELS.map((m) => {
            const on = m.id === value;
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                className="mc-row"
                style={{ display: "flex", alignItems: "flex-start", gap: 8, width: "100%", padding: "7px 8px", border: 0, borderRadius: 8, background: on ? "#f4f4f2" : "transparent", textAlign: "left", fontFamily: "inherit", cursor: "pointer" }}
              >
                <span style={{ width: 14, flexShrink: 0, paddingTop: 2, color: "#171717" }}>
                  {on ? (
                    <svg viewBox="0 0 24 24" width={13} height={13} aria-hidden fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                  ) : null}
                </span>
                <span style={{ minWidth: 0, flexGrow: 1 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#171717" }}>{zh ? m.zh : m.en}</span>
                    {m.real ? <span style={{ fontSize: 10.5, color: "#b0b0ac" }}>{m.real}</span> : null}
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: "#7a7a7a", marginTop: 1 }}>{zh ? m.lineZh : m.lineEn}</span>
                </span>
              </button>
            );
          })}
          <style>{`.mc-row:hover{background:#f7f7f5 !important}`}</style>
        </div>
      ) : null}
    </span>
  );
}

/**
 * The picked model for one box, kept for this browser tab per conversation
 * (sessionStorage, guarded), so it sticks while you keep writing there and
 * resets to 自动 in a new chat.
 */
export function useChatModel(scope: string): [string, (id: string) => void] {
  const key = `tg-model:${scope}`;
  const [value, setValue] = React.useState<string>(AUTO_MODEL);
  React.useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(key);
      setValue(saved && CHAT_MODELS.some((m) => m.id === saved) ? saved : AUTO_MODEL);
    } catch {
      setValue(AUTO_MODEL);
    }
  }, [key]);
  const set = React.useCallback(
    (id: string) => {
      setValue(id);
      try {
        window.sessionStorage.setItem(key, id);
      } catch {
        /* private window: the choice still holds for this page */
      }
    },
    [key],
  );
  return [value, set];
}
