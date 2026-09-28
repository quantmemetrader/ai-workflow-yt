"use client";

import * as React from "react";

/**
 * The project 剪辑 page's two modes: 简单 (step by step: upload, let the AI
 * cut, watch) for anybody, and 专业剪辑 (the full desk with its timeline)
 * for the editor. The owner: "make it for non-technical people".
 *
 * The page hands over both, already built; only the chosen one is drawn.
 * The choice is kept in this browser; the switch (`ModeSwitch`) sits in
 * each mode's own top row and reads this through context.
 */
export type EditMode = "simple" | "pro";

const KEY = "tg.editMode";

const Ctx = React.createContext<{ mode: EditMode; set: (m: EditMode) => void; zh: boolean }>({ mode: "simple", set: () => {}, zh: true });

/* The choice lives in localStorage; this is its tiny store, so every
   switch on the page (there are two, one per mode) reads the same value
   and the server's first draw (simple) is what hydration expects. */
const listeners = new Set<() => void>();
function readMode(): EditMode {
  try {
    return window.localStorage.getItem(KEY) === "pro" ? "pro" : "simple";
  } catch {
    return "simple";
  }
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}
function writeMode(m: EditMode) {
  try {
    window.localStorage.setItem(KEY, m);
  } catch {
    /* not kept; the page still switches for now */
  }
  memory = m;
  listeners.forEach((fn) => fn());
}
/* When storage is unavailable the choice still holds for this visit. */
let memory: EditMode | null = null;

export function EditModes({ zh, simple, pro }: { zh: boolean; simple: React.ReactNode; pro: React.ReactNode }) {
  const mode = React.useSyncExternalStore(
    subscribe,
    () => {
      const stored = readMode();
      return stored === "pro" ? "pro" : (memory ?? stored);
    },
    () => "simple" as EditMode,
  );
  const value = React.useMemo(() => ({ mode, set: writeMode, zh }), [mode, zh]);
  return <Ctx.Provider value={value}>{mode === "pro" ? pro : simple}</Ctx.Provider>;
}

/** 简单 | 专业剪辑, as a small two-way switch. */
export function ModeSwitch() {
  const { mode, set, zh } = React.useContext(Ctx);
  const item = (m: EditMode, label: string) => (
    <button
      type="button"
      onClick={() => set(m)}
      aria-pressed={mode === m}
      style={{
        height: 28,
        padding: "0 12px",
        border: 0,
        borderRadius: 7,
        fontFamily: "inherit",
        fontSize: 12.5,
        fontWeight: mode === m ? 600 : 500,
        cursor: "pointer",
        background: mode === m ? "#fff" : "transparent",
        color: mode === m ? "#171717" : "#6b6b6b",
        boxShadow: mode === m ? "0 1px 2px rgba(0,0,0,.1)" : "none",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
  return (
    <span role="group" aria-label={zh ? "剪辑方式" : "Editing mode"} style={{ display: "inline-flex", gap: 2, padding: 2, borderRadius: 9, background: "#ebeae6", flexShrink: 0 }}>
      {item("simple", zh ? "简单" : "Simple")}
      {item("pro", zh ? "专业剪辑" : "Pro editor")}
    </span>
  );
}
