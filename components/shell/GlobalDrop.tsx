"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { dropTarget, handOver } from "@/lib/client/dropped";
import { DropArea } from "@/components/chat/DropVeil";
import { startProjectAction } from "@/app/(app)/projects/actions";

/**
 * Drag-and-drop on the whole screen of every page (Rahul, 4 Oct). A screen
 * with its own drop (Chat, a project's chat, Video, AI training, Files) takes
 * it first; everywhere else the files go to the page's natural place, named
 * on the veil while they are held over it, and the app goes there.
 */
export function GlobalDrop({ zh }: { zh: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [label, setLabel] = useState<string | null>(null);
  const depth = useRef(0);
  const path = useRef(pathname);
  path.current = pathname;
  useEffect(() => {
    const w = window as unknown as { __globalDrop?: boolean; __fileDropZones?: number };
    w.__globalDrop = true;
    const files = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const ownedByPage = () => (w.__fileDropZones ?? 0) > 0;
    const target = () => dropTarget(path.current, Boolean(document.querySelector("[data-agent-panel]")), window.location.search);
    const enter = (e: DragEvent) => {
      if (!files(e) || ownedByPage()) return;
      depth.current += 1;
      const t = target();
      setLabel(zh ? t.zh : t.en);
    };
    const leave = (e: DragEvent) => {
      if (!files(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setLabel(null);
    };
    const over = (e: DragEvent) => {
      if (!files(e) || ownedByPage() || e.defaultPrevented) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const drop = (e: DragEvent) => {
      depth.current = 0;
      setLabel(null);
      if (!e.dataTransfer?.files.length || ownedByPage() || e.defaultPrevented) return;
      e.preventDefault();
      const list = Array.from(e.dataTransfer.files);
      const t = target();
      if (t.kind === "new-project") {
        /* /video with nothing open: a new edit named after the first file, the files into it. */
        const title = list[0].name.replace(/\.[^.]+$/, "").slice(0, 60) || (zh ? "新剪辑" : "New edit");
        void startProjectAction({ title }).then((res) => {
          if (!("id" in res) || !res.id) return;
          handOver(`project-files:${res.id}`, list);
          router.push(`/projects/${res.id}/files`);
        });
        return;
      }
      handOver(t.kind, list);
      if (t.href && !path.current.startsWith(t.href.split("?")[0])) router.push(t.href);
      else if (t.href && t.href.includes("?")) router.replace(t.href);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      w.__globalDrop = false;
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [router, zh]);
  return <DropArea on={Boolean(label)} title={label ?? ""} sub={zh ? "任何格式都行：Word、PDF、表格、图片、音频、视频" : "Any format: documents, PDFs, sheets, pictures, audio, video"} />;
}
