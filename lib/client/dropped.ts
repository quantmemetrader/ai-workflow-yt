"use client";

import { useEffect, useRef } from "react";

/**
 * Files dropped anywhere in the app, handed to whoever takes them (Rahul, 4 Oct:
 * "drag and drop on the whole screen, and it takes me there"). The page-wide
 * layer (`GlobalDrop`) decides where they go from the address, keeps them here
 * if it has to navigate first, and the receiving screen collects them on mount
 * or from the event if it is already open.
 */
export type DropKind = string; // "files" | "panel" | "library:legal" | "project-files:<id>"

let pending: { kind: DropKind; files: File[]; at: number } | null = null;
const EVENT = "aura:dropped";

export function handOver(kind: DropKind, files: File[]) {
  pending = { kind, files, at: Date.now() };
  window.dispatchEvent(new CustomEvent(EVENT, { detail: kind }));
}

function take(kind: DropKind): File[] | null {
  if (!pending || pending.kind !== kind || Date.now() - pending.at > 60_000) return null;
  const files = pending.files;
  pending = null;
  return files;
}

/** A screen that takes dropped files of one kind. */
export function useDroppedFiles(kind: DropKind | null, onFiles: (files: File[]) => void) {
  const handler = useRef(onFiles);
  handler.current = onFiles;
  useEffect(() => {
    if (!kind) return;
    const now = take(kind);
    if (now) handler.current(now);
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== kind) return;
      const files = take(kind);
      if (files) handler.current(files);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [kind]);
}

/** Where files dropped on this page go, and the line that says so. */
export function dropTarget(pathname: string, hasPanel: boolean, search = ""): { kind: DropKind; href: string | null; zh: string; en: string } {
  const lib = pathname.match(/^\/(legal|finance|accounting)(\/|$)/);
  if (lib) return { kind: `library:${lib[1]}`, href: `/${lib[1]}?tab=library`, zh: `松开，上传到${{ legal: "法务", finance: "财务", accounting: "账务" }[lib[1]]}资料库`, en: `Drop to upload to the ${lib[1]} library` };
  const proj = pathname.match(/^\/projects\/(wp_[a-z0-9]+)/);
  if (proj) return { kind: `project-files:${proj[1]}`, href: `/projects/${proj[1]}/files`, zh: "松开，加到这个项目的文件里", en: "Drop to add to this project's files" };
  if (/^\/video\/?$/.test(pathname) && !/[?&]project=/.test(search)) return { kind: "new-project", href: null, zh: "松开，新建一个剪辑项目并放进这些素材", en: "Drop to start a new edit with these files" };
  if (hasPanel) return { kind: "panel", href: null, zh: "松开，附到右边助理的这条消息里", en: "Drop to attach to the assistant's message" };
  return { kind: "files", href: "/files", zh: "松开，上传到文件", en: "Drop to upload to Files" };
}
