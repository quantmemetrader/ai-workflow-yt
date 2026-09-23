"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { recentConversationsAction, type RecentConversation } from "@/app/(app)/chat/actions";

/**
 * Everything you have asked the assistant, from anywhere in the product.
 *
 * The threads were always stored and always had a page; nothing listed them,
 * so a conversation was gone the moment a panel closed. Chat's own sidebar now
 * lists them — but the assistant answers on *every* screen, and somebody in
 * the middle of an edit should not have to go to Chat to find what it told
 * them ten minutes ago.
 *
 * So: a clock in the rail, on every screen. It loads when opened rather than
 * on every page render — this is a thing people reach for occasionally, and it
 * should cost nothing the rest of the time.
 */
export function HistoryButton({ locale }: { locale: string }) {
  const zh = locale.startsWith("zh");
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

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) {
      load(async () => {
        const res = await recentConversationsAction();
        setRows(res.conversations ?? []);
      });
    }
  }

  return (
    <div ref={box} style={{ position: "relative", display: "contents" }}>
      <button
        type="button"
        onClick={toggle}
        className={`r${open ? " on" : ""}`}
        aria-label={zh ? "历史记录" : "Your chat history"}
        title={zh ? "历史记录" : "Your chat history"}
        aria-expanded={open}
        style={{ border: 0, background: open ? "#ffffff" : "transparent", cursor: "pointer", padding: 0 }}
      >
        <svg viewBox="0 0 24 24" style={{ fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" }}>
          <path d="M12 4a8 8 0 1 0 8 8" />
          <path d="M20 4v4.5h-4.5" />
          <path d="M12 7.5V12l3 1.8" />
        </svg>
      </button>

      {open ? (
        <div
          style={{
            position: "fixed",
            left: 58,
            bottom: 14,
            zIndex: 240,
            width: 292,
            maxHeight: "68vh",
            overflowY: "auto",
            background: "#ffffff",
            border: "1px solid #ededed",
            borderRadius: 12,
            boxShadow: "0 14px 40px rgba(0,0,0,0.16)",
            padding: 8,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              padding: "4px 8px 8px",
              fontSize: 11.5,
              color: "#999999",
            }}
          >
            <span style={{ flexGrow: 1, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase" }}>
              {zh ? "你问过的" : "You asked"}
            </span>
            <span>{zh ? "仅你可见" : "only you"}</span>
          </div>

          {loading && rows === null ? (
            <p style={{ fontSize: 12, color: "#999999", padding: "6px 8px", margin: 0 }}>
              {zh ? "正在读取…" : "Reading…"}
            </p>
          ) : rows && rows.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {rows.map((c) => (
                <Link
                  key={c.id}
                  href={`/chat/t/${c.id}`}
                  onClick={() => setOpen(false)}
                  title={c.title}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "7px 8px",
                    borderRadius: 8,
                    fontSize: 12.5,
                    color: "#383838",
                    textDecoration: "none",
                  }}
                >
                  <span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.title}
                  </span>
                  <span style={{ fontSize: 11.5, color: "#c7c7c7", flexShrink: 0 }}>{c.when}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "#999999", padding: "6px 8px", margin: 0, lineHeight: 1.6 }}>
              {zh
                ? "还没有对话。在任意页面右侧向助理提问，问过的内容就会留在这里。"
                : "Nothing yet. Ask the assistant on any screen and the thread stays here."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
