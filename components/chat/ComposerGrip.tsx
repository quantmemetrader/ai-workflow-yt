"use client";

import * as React from "react";

const KEY = "tg:composer-height";

/**
 * The message box grows with what is typed and can be dragged taller by its
 * top edge (Catherine, 6 Oct: it stayed one line high, so a long message
 * could only be read a line at a time; other AI chats let you pull the box
 * up). The dragged height is remembered on this computer; double-click the
 * handle to go back to growing on its own.
 */
export function useComposerGrip(box: React.RefObject<HTMLTextAreaElement | null>, value: string, zh: boolean) {
  const [tall, setTall] = React.useState<number | null>(null);
  React.useEffect(() => {
    try {
      const v = Number(localStorage.getItem(KEY));
      if (v >= 60) setTall(v);
    } catch {
      /* private window: grow on its own */
    }
  }, []);
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    const cap = Math.max(tall ?? 0, 240);
    const want = Math.max(tall ?? 0, Math.min(el.scrollHeight, cap));
    el.style.height = `${want}px`;
    el.style.maxHeight = `${Math.max(cap, want)}px`;
    el.style.overflowY = el.scrollHeight > want + 2 ? "auto" : "hidden";
  }, [box, value, tall]);

  const drag = React.useRef<{ y: number; h: number } | null>(null);
  const last = React.useRef<number | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={zh ? "拖动调整输入框高度，双击还原" : "Drag to resize the box; double-click to reset"}
      title={zh ? "拖动调整输入框高度，双击还原" : "Drag to resize; double-click to reset"}
      onPointerDown={(e) => {
        const el = box.current;
        if (!el) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, h: el.getBoundingClientRect().height };
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const next = Math.round(Math.max(60, Math.min(window.innerHeight * 0.7, drag.current.h + (drag.current.y - e.clientY))));
        last.current = next;
        setTall(next);
      }}
      onPointerUp={() => {
        drag.current = null;
        try {
          if (last.current) localStorage.setItem(KEY, String(last.current));
        } catch {
          /* not remembered, still resized */
        }
      }}
      onDoubleClick={() => {
        setTall(null);
        last.current = null;
        try {
          localStorage.removeItem(KEY);
        } catch {
          /* nothing to forget */
        }
      }}
      style={{ position: "absolute", top: -7, left: 0, right: 0, height: 14, cursor: "ns-resize", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 2, touchAction: "none" }}
    >
      <span style={{ width: 36, height: 4, borderRadius: 2, background: "#d4d4d0" }} />
    </div>
  );
}
