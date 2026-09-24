"use client";

import * as React from "react";
import { useLocalPreference } from "@/lib/client/preference";

/**
 * A panel that folds shut and can be dragged taller or shorter.
 *
 * "Have everything as dropdowns and resizable." The header folds the panel
 * (remembered in this browser, per panel); the corner of the body drags its
 * height. Nothing inside needs to know.
 */
export function Fold({
  id,
  title,
  sub,
  right,
  icon,
  children,
  resizable = true,
  height,
  minHeight = 80,
  flush = false,
  style,
}: {
  /** Where the open/closed state is remembered. */
  id: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  resizable?: boolean;
  /** Starting body height; content taller than it scrolls. Unset grows with content. */
  height?: number;
  minHeight?: number;
  /** No padding round the body, for lists that draw their own. */
  flush?: boolean;
  style?: React.CSSProperties;
}) {
  const [state, setState] = useLocalPreference(`aura:fold:${id}`, ["open", "shut"] as const, "open");
  const open = state === "open";

  return (
    <section style={{ background: "#ffffff", border: "1px solid #e2e2e2", borderRadius: 14, minWidth: 0, overflow: "hidden", ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", borderBottom: open ? "1px solid #f0f0f0" : "none", minWidth: 0 }}>
        <button
          type="button"
          onClick={() => setState(open ? "shut" : "open")}
          aria-expanded={open}
          style={{ display: "flex", alignItems: "center", gap: 8, border: 0, background: "transparent", padding: 0, cursor: "pointer", font: "inherit", color: "inherit", minWidth: 0, textAlign: "left" }}
        >
          <svg viewBox="0 0 24 24" aria-hidden style={{ width: 14, height: 14, flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform .15s ease", stroke: "#7c7c7c", fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
            <path d="M9.5 6.5 15 12l-5.5 5.5" />
          </svg>
          {icon}
          <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap" }}>{title}</span>
          {sub ? <span style={{ fontSize: 12, color: "#999999", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span> : null}
        </button>
        <span style={{ flexGrow: 1 }} />
        {right}
      </div>
      {open ? (
        <div
          style={{
            padding: flush ? 0 : "12px 14px",
            resize: resizable ? "vertical" : "none",
            overflow: resizable || height ? "auto" : "visible",
            height,
            minHeight: resizable ? minHeight : undefined,
          }}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}
