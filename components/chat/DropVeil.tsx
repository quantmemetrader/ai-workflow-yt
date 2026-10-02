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
export function DropVeil({ on, zh }: { on: boolean; zh: boolean }) {
  if (!on) return null;
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(23,23,23,.28)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ padding: "28px 40px", borderRadius: 18, background: "#fff", border: "2px dashed #171717", textAlign: "center", boxShadow: "0 12px 40px rgba(0,0,0,.18)" }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: "#171717" }}>{zh ? "松开，把文件放进这条消息" : "Drop to add the files to this message"}</div>
        <div style={{ fontSize: 13, color: "#6b6b6b", marginTop: 6 }}>{zh ? "任何格式都行：PPT、Word、Excel、PDF、图片、音频、视频、压缩包" : "Any format: slides, documents, spreadsheets, PDFs, pictures, audio, video, zip"}</div>
      </div>
    </div>
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
