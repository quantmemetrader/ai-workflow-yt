"use client";

import { useCallback } from "react";
import { useLocalNumber } from "@/lib/client/preference";

/**
 * A draggable edge between two panels.
 *
 * Every column in this product is a number typed into a style object: the rail
 * is 52, the workspace sidebar 256, the research sidebar 212, the agent panel
 * 312 or 320. Those are the artboards' numbers and they are good defaults, but
 * a person reading a long thread wants the agent narrow and a person working
 * with the agent wants it wide, and neither could have it.
 *
 * The width is remembered per panel, in the browser, because it is a
 * preference about looking rather than a fact about the studio.
 *
 * Pointer events rather than mouse events, so a trackpad, a pen and a touch
 * screen all work, and the pointer is captured so dragging fast over an iframe
 * or off the window does not drop the drag.
 */
export function useResizable(
  key: string,
  { min, max, initial, edge }: { min: number; max: number; initial: number; edge: "left" | "right" },
) {
  const [width, setWidth] = useLocalNumber(`aura:width:${key}`, { min, max, fallback: initial });

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);

      const startX = event.clientX;
      // Read from the DOM rather than a ref mirrored during render: the panel
      // is the thing whose width is being dragged, and it always knows.
      const startWidth = handle.parentElement?.getBoundingClientRect().width ?? initial;

      const move = (e: PointerEvent) => {
        // Dragging the left edge of a right-hand panel makes it wider as the
        // pointer travels left, and the other way round on the other side.
        const delta = edge === "left" ? startX - e.clientX : e.clientX - startX;
        setWidth(Math.round(Math.min(max, Math.max(min, startWidth + delta))));
      };

      const up = (e: PointerEvent) => {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
      // Held on the body, or the cursor flickers back to a caret over text and
      // dragging selects the page.
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [edge, initial, max, min, setWidth],
  );

  // Keyboard: the handle is focusable, so the arrows move it in steps and the
  // panel is adjustable without a pointer at all.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 48 : 12;
      const towards = edge === "left" ? -1 : 1;
      let next: number | null = null;
      if (event.key === "ArrowLeft") next = width - step * towards;
      if (event.key === "ArrowRight") next = width + step * towards;
      if (next === null) return;
      event.preventDefault();
      setWidth(Math.min(max, Math.max(min, next)));
    },
    [edge, max, min, setWidth, width],
  );

  const reset = useCallback(() => setWidth(NaN), [setWidth]);

  const handle = (
    <ResizeHandle
      edge={edge}
      width={width}
      min={min}
      max={max}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={reset}
    />
  );

  return { width, handle };
}

/**
 * The same thing for a seam that runs across instead of down.
 *
 * Panels stack as well as sit side by side — the watchlist with the agent
 * under it on the Trends dashboard — and a seam you can drag one way but not
 * the other is a seam that looks broken half the time.
 */
export function useResizableHeight(
  key: string,
  { min, max, initial, edge }: { min: number; max: number; initial: number; edge: "top" | "bottom" },
) {
  const [height, setHeight] = useLocalNumber(`aura:height:${key}`, { min, max, fallback: initial });

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);

      const startY = event.clientY;
      const startHeight = handle.parentElement?.getBoundingClientRect().height ?? initial;

      const move = (e: PointerEvent) => {
        // Dragging the top edge of a bottom panel makes it taller as the
        // pointer travels up.
        const delta = edge === "top" ? startY - e.clientY : e.clientY - startY;
        setHeight(Math.round(Math.min(max, Math.max(min, startHeight + delta))));
      };

      const up = (e: PointerEvent) => {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };

      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [edge, initial, max, min, setHeight],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 48 : 12;
      const towards = edge === "top" ? -1 : 1;
      let next: number | null = null;
      if (event.key === "ArrowUp") next = height - step * towards;
      if (event.key === "ArrowDown") next = height + step * towards;
      if (next === null) return;
      event.preventDefault();
      setHeight(Math.min(max, Math.max(min, next)));
    },
    [edge, max, min, setHeight, height],
  );

  const reset = useCallback(() => setHeight(NaN), [setHeight]);

  const handle = (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize panel"
      aria-valuenow={height}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={reset}
      title="Drag to resize · double-click to reset"
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        [edge]: -3,
        height: 7,
        zIndex: 12,
        cursor: "row-resize",
        background: "transparent",
        touchAction: "none",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(0,123,224,0.28)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    />
  );

  return { height, handle };
}

function ResizeHandle({
  edge,
  width,
  min,
  max,
  onPointerDown,
  onKeyDown,
  onDoubleClick,
}: {
  edge: "left" | "right";
  width: number;
  min: number;
  max: number;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
      title="Drag to resize · double-click to reset"
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        [edge]: -3,
        width: 7,
        zIndex: 12,
        cursor: "col-resize",
        // Invisible until touched: a visible bar on every seam would clutter a
        // screen that is mostly seams.
        background: "transparent",
        touchAction: "none",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(0,123,224,0.28)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    />
  );
}
