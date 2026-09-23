"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { currentWork, serverWork, subscribeBusy } from "@/lib/client/busy";

/**
 * The thing that says something is happening.
 *
 * Bottom left, in the sidebar's own empty space above whoever is signed in —
 * not across the middle of the window. A banner in the centre interrupts what
 * you are reading in order to tell you that something unrelated is loading,
 * which is the opposite of what an indicator is for.
 *
 * It names what it is working on when the caller said ("Collecting nvidia"),
 * because "Loading…" answers a question nobody asked.
 *
 * The agent is deliberately not in here: a model turn belongs to the panel
 * that asked for it, and shows its waiting there.
 *
 * It waits 140ms before appearing. Something that returns in 80ms should not
 * flash an indicator; something that takes two seconds must not look broken.
 */
export function BusyBar() {
  const work = useSyncExternalStore(subscribeBusy, currentWork, serverWork);
  const shown = useDelayed(work.length > 0, 140);
  if (!shown || work.length === 0) return null;

  // The newest thing is what somebody just did, so it is the one named.
  const latest = work[work.length - 1];
  const others = work.length - 1;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        // Clear of the 52px rail, and above the signed-in block at the foot of
        // whichever sidebar this module draws.
        left: 60,
        bottom: 14,
        zIndex: 300,
        maxWidth: 260,
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 30,
        padding: "0 11px 0 9px",
        borderRadius: 9,
        background: "rgba(255,255,255,0.98)",
        border: "1px solid #ededed",
        boxShadow: "0 6px 20px rgba(23,23,23,0.12)",
        pointerEvents: "none",
        animation: "fadeUp .18s cubic-bezier(.32,.72,0,1) both",
      }}
    >
      <svg
        viewBox="0 0 24 24"
        style={{ width: 13, height: 13, flexShrink: 0, animation: "auraSpin 1s linear infinite" }}
      >
        <circle cx="12" cy="12" r="8.6" stroke="#ededed" strokeWidth="2.8" fill="none" />
        <path
          d="M12 3.4a8.6 8.6 0 0 1 8.6 8.6"
          stroke="#007be0"
          strokeWidth="2.8"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      <span
        style={{
          fontSize: 11.5,
          color: "#383838",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {latest.label ?? "Working…"}
        {others > 0 ? ` +${others}` : ""}
      </span>
    </div>
  );
}

/**
 * True once `on` has been true for `ms`, false the moment it stops.
 *
 * The delay is only on the way in. Something that finishes quickly never
 * flashes; something already on screen leaves at once rather than lingering
 * after the work is done.
 */
function useDelayed(on: boolean, ms: number): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!on) {
      const id = setTimeout(() => setShown(false), 0);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(id);
  }, [on, ms]);

  return shown;
}
