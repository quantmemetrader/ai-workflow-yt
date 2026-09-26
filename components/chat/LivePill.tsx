"use client";

import * as React from "react";
import Link from "next/link";
import { AgentTyping } from "@/components/agents/AgentTyping";
import { Icon } from "@/components/ui/Icon";
import { Tr } from "@/components/ui/Tr";
import { useLiveProject, useLiveSnapshot } from "@/lib/client/live";
import { friendlyError, isRecent, isRunning, liveWords, type LiveProject } from "@/lib/projects/live-types";

/**
 * The one live line a project's chat keeps while its film is being made.
 *
 * The channel used to have 剪辑师's "开始做…" from twenty minutes ago and
 * nothing since; the project page knew where the render was, the chat did
 * not. This is the row under the last message that follows the worker —
 * 转写 → 剪辑 → 设计图形 → 渲染 42% → 成片已出 — from the studio-wide
 * live store (`lib/client/live.ts`), the same numbers the project page and
 * Home show. One row, patched in place; never a message.
 *
 * It says 成片已出 (with 打开 and 下载) for two minutes after the film
 * lands, unless the worker's own "渲染好了" line with the card is already
 * in the thread (`hasCard`), in which case the card says it. A failed
 * render says why, with 重试 leading to the project page.
 *
 * Nothing on the server or at hydration (the store is empty there), so the
 * surfaces that draw it — the channel and the project page's drawer —
 * wrap it in their own row markup only when it has something to say
 * (`useLiveRow`).
 */
export function useLiveRow(projectId: string | null | undefined, hasCard?: (exportId: string) => boolean): LiveProject | null {
  const p = useLiveProject(projectId);
  const { at } = useLiveSnapshot();
  if (!p) return null;
  if (isRunning(p) || p.state === "armed") return p;
  if (!isRecent(p, at)) return null;
  if (p.state === "done" && p.exportId && hasCard?.(p.exportId)) return null;
  return p;
}

export function LivePill({ p, zh, size = "md" }: { p: LiveProject; zh: boolean; size?: "sm" | "md" }) {
  const now = useNow(1000, p.state === "armed");
  const { at } = useLiveSnapshot();
  const words = liveWords(p, now ?? at);
  if (isRunning(p) || p.state === "armed") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <AgentTyping agent="video" zh={zh} face={false} size={size} label={words} percent={p.percent !== null && (p.state === "rendering" || p.step === "render") ? p.percent : null} />
        <span style={{ fontSize: 11.5, color: "#7c7c7c", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {p.state === "armed" ? (
            <Tr zh="最后一段素材传完后一分钟自动开始；到项目页可以取消。" en="Starts a minute after the last upload; cancel on the project page." inZh={zh} />
          ) : (
            <Tr zh="转写 → 剪辑 → 设计图形 → 渲染。好了会把成片发在这里。" en="Transcribe → cut → design → render. The film lands here when done." inZh={zh} />
          )}
          <Link href={`/projects/${p.id}`} prefetch={false} style={{ color: "#525252", textDecoration: "none", whiteSpace: "nowrap" }}>
            <Tr zh="打开项目" en="Open the project" inZh={zh} /> →
          </Link>
        </span>
      </div>
    );
  }
  const done = p.state === "done";
  const pill: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 26,
    padding: "0 10px",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
    textDecoration: "none",
    whiteSpace: "nowrap",
    border: `1px solid ${done ? "#cbe9d8" : "#f6d5d1"}`,
    background: done ? "#eaf7ef" : "#fdf3f2",
    color: done ? "#146b43" : "#a3281c",
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: done ? "#146b43" : "#a3281c" }}>
        <Icon name={done ? "check" : "undo"} size={13} strokeWidth={2.4} />
        <Tr zh={words.zh} en={words.en} inZh={zh} />
      </span>
      {!done && p.error ? <span style={{ fontSize: 12, color: "#a3281c", minWidth: 0, overflowWrap: "anywhere" }}>{friendlyError(p.error, zh)}</span> : null}
      <Link href={`/projects/${p.id}`} prefetch={false} style={pill}>
        {done ? <Tr zh="打开" en="Open" inZh={zh} /> : <Tr zh="重试" en="Try again" inZh={zh} />}
      </Link>
      {done && p.fileId ? (
        <a href={`/api/files/${p.fileId}/download?download=1`} style={{ ...pill, background: "#fff", border: "1px solid #e2e2e2", color: "#171717" }}>
          <Icon name="download" size={12} />
          <Tr zh="下载" en="Download" inZh={zh} />
        </a>
      ) : null}
    </div>
  );
}

function useNow(ms: number, on: boolean): number | null {
  return React.useSyncExternalStore(
    (onChange) => {
      if (!on) return () => undefined;
      const id = setInterval(onChange, ms);
      return () => clearInterval(id);
    },
    () => (on ? Math.floor(Date.now() / ms) * ms : null),
    () => null,
  );
}
