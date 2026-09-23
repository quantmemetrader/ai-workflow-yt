"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { recentConversationsAction, type RecentConversation } from "@/app/(app)/chat/actions";

/**
 * Earlier conversations, inside the panel that had them.
 *
 * The rail's clock lists every thread from anywhere; this is the same list
 * one click from the composer you are typing in, and picking one puts it
 * back in this panel rather than taking you to Chat.
 */
export function AgentHistory({
  zh,
  current,
  onPick,
  onNew,
}: {
  zh: boolean;
  current: string | null;
  onPick: (conversationId: string) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<RecentConversation[] | null>(null);
  const [loading, load] = useTransition();
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (box.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) {
      load(async () => {
        const res = await recentConversationsAction();
        setRows(res.conversations ?? []);
      });
    }
  };

  const small: React.CSSProperties = {
    height: 24,
    padding: "0 8px",
    borderRadius: 7,
    border: "1px solid #ededed",
    background: "#fff",
    color: "#525252",
    fontSize: 11,
    fontFamily: "inherit",
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
  };

  return (
    <div ref={box} style={{ position: "relative", display: "flex", gap: 4 }}>
      <button type="button" onClick={onNew} title={zh ? "新对话" : "New conversation"} style={small}>
        <svg viewBox="0 0 24 24" style={{ width: 10, height: 10, stroke: "currentColor", fill: "none", strokeWidth: 2.4, strokeLinecap: "round" }}>
          <path d="M12 6v12M6 12h12" />
        </svg>
        {zh ? "新对话" : "New"}
      </button>
      <button type="button" onClick={toggle} aria-expanded={open} title={zh ? "历史对话" : "History"} style={{ ...small, background: open ? "#f3f3f3" : "#fff" }}>
        <svg viewBox="0 0 24 24" style={{ width: 11, height: 11, stroke: "currentColor", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
        {zh ? "历史" : "History"}
      </button>

      {open ? (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            zIndex: 41,
            width: 280,
            maxHeight: 340,
            overflowY: "auto",
            background: "#fff",
            border: "1px solid #e2e2e2",
            borderRadius: 12,
            boxShadow: "0 12px 32px rgba(23,23,23,.14), 0 2px 6px rgba(23,23,23,.06)",
            padding: 6,
          }}
        >
          {loading || rows === null ? (
            <div style={{ padding: 10, fontSize: 11.5, color: "#999999" }}>{zh ? "读取中…" : "Loading…"}</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 10, fontSize: 11.5, color: "#999999" }}>{zh ? "还没有对话。" : "Nothing yet."}</div>
          ) : (
            rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  onPick(r.id);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  textAlign: "left",
                  padding: "7px 8px",
                  borderRadius: 7,
                  border: 0,
                  background: r.id === current ? "#f3f3f3" : "transparent",
                  font: "inherit",
                  fontSize: 12,
                  color: "#171717",
                  cursor: "pointer",
                }}
              >
                <span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                <span style={{ fontSize: 10.5, color: "#999999", flexShrink: 0 }}>{r.when}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
