"use client";

import { useCallback, useEffect, useState } from "react";
import { NOTIFY_EVENT, type Notice } from "@/lib/client/notify";

/**
 * Where a failure goes now that nothing calls `window.alert`.
 *
 * Bottom left, so it never lands on the background-work toast in the other
 * corner. Errors stay until they are dismissed, because an error you did not
 * read is an error you will hit again; anything else clears itself.
 */
const HOLD = { error: 0, ok: 4000, info: 5000 } as const;

export function Toaster() {
  const [notices, setNotices] = useState<Notice[]>([]);

  const drop = useCallback((id: number) => {
    setNotices((cur) => cur.filter((n) => n.id !== id));
  }, []);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();

    function onNotice(event: Event) {
      const notice = (event as CustomEvent<Notice>).detail;
      if (!notice?.text) return;
      setNotices((cur) => [...cur.slice(-3), notice]);
      const hold = HOLD[notice.kind];
      if (hold) timers.add(setTimeout(() => drop(notice.id), hold));
    }

    window.addEventListener(NOTIFY_EVENT, onNotice);
    return () => {
      window.removeEventListener(NOTIFY_EVENT, onNotice);
      for (const t of timers) clearTimeout(t);
    };
  }, [drop]);

  if (!notices.length) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: 18,
        bottom: 18,
        zIndex: 220,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        maxWidth: 380,
      }}
    >
      {notices.map((n) => (
        <div
          key={n.id}
          role={n.kind === "error" ? "alert" : "status"}
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            padding: "11px 12px",
            borderRadius: 11,
            border: `1px solid ${n.kind === "error" ? "#ffd6d6" : n.kind === "ok" ? "#cdeed9" : "#ededed"}`,
            background: n.kind === "error" ? "#fff7f7" : n.kind === "ok" ? "#f4fcf7" : "#ffffff",
            boxShadow: "0 8px 28px rgba(23,23,23,0.13)",
            animation: "fadeUp .18s cubic-bezier(.32,.72,0,1) both",
          }}
        >
          <Glyph kind={n.kind} />
          <span
            style={{
              fontSize: 12.5,
              lineHeight: 1.55,
              color: n.kind === "error" ? "#8a2b2b" : "#383838",
              minWidth: 0,
              overflowWrap: "anywhere",
            }}
          >
            {n.text}
          </span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => drop(n.id)}
            style={{
              marginLeft: "auto",
              flexShrink: 0,
              width: 18,
              height: 18,
              padding: 0,
              border: 0,
              borderRadius: 5,
              background: "transparent",
              cursor: "pointer",
              color: "#c7c7c7",
              lineHeight: 0,
            }}
          >
            <svg viewBox="0 0 24 24" style={{ width: 12, height: 12, stroke: "currentColor", fill: "none", strokeWidth: 2.1, strokeLinecap: "round" }}>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

function Glyph({ kind }: { kind: Notice["kind"] }) {
  const stroke = kind === "error" ? "#e03636" : kind === "ok" ? "#278f5e" : "#7c7c7c";
  return (
    <svg
      viewBox="0 0 24 24"
      style={{ width: 14, height: 14, flexShrink: 0, marginTop: 1, stroke, fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}
    >
      <circle cx="12" cy="12" r="8.6" />
      {kind === "ok" ? <path d="m8.4 12.2 2.6 2.6 4.8-5" /> : <path d="M12 7.8v5M12 16.1h.01" />}
    </svg>
  );
}
