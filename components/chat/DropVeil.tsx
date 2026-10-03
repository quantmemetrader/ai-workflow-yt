"use client";

import * as React from "react";

/**
 * Files dragged from the desktop onto anywhere on a chat screen (the client:
 * "desktop files cannot be dragged into the chat box"). A window-level
 * listener, so the drop lands over the box, the thread or the margin, and
 * the veil below says where it goes while something is held over the page.
 *
 * `onFiles` is read through a ref, so a caller can pass a fresh closure each
 * render (its own attach function, which sees its current state).
 */
export function useFileDrop(enabled: boolean, onFiles: (files: FileList) => void): boolean {
  const [dragging, setDragging] = React.useState(false);
  const handler = React.useRef(onFiles);
  handler.current = onFiles;
  React.useEffect(() => {
    if (!enabled) return;
    /* The boot script (lib/client/boot.ts) swallows a drop nothing takes; while a
       screen takes drops anywhere, it stands aside. */
    const w = window as unknown as { __fileDropZones?: number };
    w.__fileDropZones = (w.__fileDropZones ?? 0) + 1;
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      if (e.dataTransfer?.files?.length) handler.current(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      w.__fileDropZones = Math.max(0, (w.__fileDropZones ?? 1) - 1);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
      setDragging(false);
    };
  }, [enabled]);
  return dragging;
}

/** The veil over the screen while files are held over it. */
export function DropVeil({ on, zh, title, sub }: { on: boolean; zh: boolean; title?: string; sub?: string }) {
  return (
    <DropArea
      on={on}
      title={title ?? (zh ? "松开，把文件放进这条消息" : "Drop to add the files to this message")}
      sub={sub ?? (zh ? "任何格式都行：PPT、Word、Excel、PDF、图片、音频、视频、压缩包" : "Any format: slides, documents, spreadsheets, PDFs, pictures, audio, video, zip")}
    />
  );
}

/**
 * Drop props for one box that takes files (a composer, the home box): the
 * dragged files go to `onFiles`, nothing else on the page sees the drop, and
 * the browser never opens the file instead (Avon, 2 Oct: drag-and-drop
 * "works in some chat windows, not others"; in the others the page was
 * replaced by the file).
 */
export function dropFilesProps(onFiles: (files: FileList) => void, enabled = true): Pick<React.HTMLAttributes<HTMLElement>, "onDragOver" | "onDrop"> {
  return {
    onDragOver: (e) => {
      if (!enabled || !Array.from(e.dataTransfer.types).includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDrop: (e) => {
      if (!enabled || !e.dataTransfer.files.length) return;
      e.preventDefault();
      e.stopPropagation();
      onFiles(e.dataTransfer.files);
    },
  };
}

/**
 * Where a drop highlight belongs (Rahul, 4 Oct): over the page's main area
 * only, never over the side assistant, which lights up by itself; and nothing
 * at all while the files are over the assistant.
 */
/* Where the files are being held, kept from the first event, so the highlight is right before any re-render. */
let lastDragTarget: Element | null = null;
if (typeof window !== "undefined") {
  const keep = (e: DragEvent) => { if (e.target instanceof Element) lastDragTarget = e.target; };
  window.addEventListener("dragenter", keep, true);
  window.addEventListener("dragover", keep, true);
}

export function useDropArea(active: boolean): { rect: { left: number; top: number; width: number; height: number } | null; overPanel: boolean } {
  const [state, setState] = React.useState<{ rect: { left: number; top: number; width: number; height: number } | null; overPanel: boolean }>({ rect: null, overPanel: false });
  React.useEffect(() => {
    if (!active) return;
    const measure = (e?: DragEvent) => {
      const target = e?.target instanceof Element ? e.target : lastDragTarget;
      const overPanel = Boolean(target?.closest("[data-agent-panel]"));
      const main = document.querySelector("main")?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
      const panel = document.querySelector("[data-agent-panel]")?.getBoundingClientRect();
      let right = main.right;
      if (panel && panel.width > 0 && panel.left > main.left + 200 && panel.left < main.right) right = panel.left;
      setState({ rect: { left: main.left, top: main.top, width: right - main.left, height: main.height }, overPanel });
    };
    measure();
    const over = (e: DragEvent) => measure(e);
    window.addEventListener("dragover", over, true);
    return () => window.removeEventListener("dragover", over, true);
  }, [active]);
  return active ? state : { rect: null, overPanel: false };
}

/** The highlight itself: the main area, dashed and light, the destination in words. */
export function DropArea({ on, title, sub }: { on: boolean; title: string; sub: string }) {
  const { rect, overPanel } = useDropArea(on);
  if (!on || !rect || overPanel) return null;
  return (
    <div aria-hidden style={{ position: "fixed", left: rect.left + 8, top: rect.top + 8, width: Math.max(0, rect.width - 16), height: Math.max(0, rect.height - 16), zIndex: 80, borderRadius: 14, border: "2px dashed #171717", background: "rgba(255,255,255,.9)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, pointerEvents: "none", textAlign: "center", padding: 16 }}>
      <span style={{ fontSize: 16, fontWeight: 600, color: "#171717" }}>{title}</span>
      <span style={{ fontSize: 12.5, color: "#7c7c7c" }}>{sub}</span>
    </div>
  );
}
