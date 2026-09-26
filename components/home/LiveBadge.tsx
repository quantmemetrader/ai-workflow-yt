"use client";

import * as React from "react";
import { AgentTyping } from "@/components/agents/AgentTyping";
import { Icon } from "@/components/ui/Icon";
import { Tr } from "@/components/ui/Tr";
import { useLiveProject, useLiveSnapshot } from "@/lib/client/live";
import { isRecent, isRunning, liveWords } from "@/lib/projects/live-types";

/**
 * A project card's status, live.
 *
 * Home's card said 进行中 from the server's render and stayed that way
 * until somebody reloaded, while the worker was ten minutes into a render.
 * This reads the studio-wide live store (`lib/client/live.ts`): while the
 * film is being made the pill types like 剪辑师 in the chat — "正在剪辑 ·
 * 设计图形", "正在渲染 42%" — and for two minutes after it lands it says
 * 成片已出 · 看看. With nothing happening it draws `fallback`, the card's
 * usual pill, which is also what the server rendered, so hydration agrees.
 *
 * `LiveBar` is the thin line under the stepper that goes with it: the
 * render's percent, or a slow sweep while the director is on a step with
 * no percent to give.
 */
export function LiveBadge({ projectId, zh, fallback }: { projectId: string; zh: boolean; fallback: React.ReactNode }) {
  const p = useLiveProject(projectId);
  const { at: polled } = useLiveSnapshot();
  const now = useNow(1000, p?.state === "armed");
  if (!p) return <>{fallback}</>;
  /* The countdown ticks; the windows read the poll's clock. */
  const at = now ?? polled;
  if (isRunning(p) || p.state === "armed") {
    const words = liveWords(p, at);
    return <AgentTyping agent="video" zh={zh} size="sm" face={false} label={words} percent={p.percent !== null && (p.state === "rendering" || p.step === "render") ? p.percent : null} />;
  }
  if (isRecent(p, at)) {
    const done = p.state === "done";
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap", color: done ? "#1e7a4f" : "#a3281c", background: done ? "#e7f6ee" : "#fdf3f2", borderRadius: 999, padding: "2px 9px 2px 7px" }}>
        <Icon name={done ? "check" : "undo"} size={11} strokeWidth={2.4} />
        {done ? <Tr zh="成片已出 · 看看" en="Film is out · watch" inZh={zh} /> : <Tr zh="渲染没成功 · 重试" en="Render failed · retry" inZh={zh} />}
      </span>
    );
  }
  return <>{fallback}</>;
}

export function LiveBar({ projectId }: { projectId: string }) {
  const p = useLiveProject(projectId);
  if (!p || !isRunning(p)) return null;
  const pct = p.percent !== null && (p.state === "rendering" || p.step === "render") ? p.percent : null;
  return (
    <span aria-hidden style={{ display: "block", height: 3, borderRadius: 2, background: "#e6eef9", overflow: "hidden", marginTop: -2 }}>
      {pct !== null ? (
        <span style={{ display: "block", height: "100%", width: `${Math.max(3, pct)}%`, borderRadius: 2, background: "linear-gradient(90deg,#278f5e,#0f5bd5)", transition: "width .6s ease" }} />
      ) : (
        <span style={{ display: "block", height: "100%", width: "30%", borderRadius: 2, background: "linear-gradient(90deg,#278f5e,#0f5bd5)", animation: "liveSweep 1.6s ease-in-out infinite" }} />
      )}
      <style dangerouslySetInnerHTML={{ __html: "@keyframes liveSweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(340%); } } @media (prefers-reduced-motion: reduce) { [data-live-sweep] { animation: none; } }" }} />
    </span>
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

/**
 * The line under a card's stepper ("剪辑师正在渲染"), live: the same words as
 * the pill while the film is made, "成片已出 · 看看" once it lands, and the
 * server's line otherwise — so the pill and the line cannot disagree between
 * two refreshes.
 */
export function LiveLine({ projectId, zh, fallback }: { projectId: string; zh: boolean; fallback: React.ReactNode }) {
  const p = useLiveProject(projectId);
  const { at: polled } = useLiveSnapshot();
  const now = useNow(1000, p?.state === "armed");
  /* Each side in its own keyed span: the server's line is a bare string,
     and swapping a bare text node for the live words makes React remove
     that node — which Chrome's translate has already replaced with its own
     <font>, so the removal throws and takes the page down. Replacing a
     whole element is safe. */
  const at = now ?? polled;
  if (!p || (!isRunning(p) && p.state !== "armed" && !isRecent(p, at))) return <span key="server">{fallback}</span>;
  const words = liveWords(p, at);
  const text = isRunning(p) || p.state === "armed" ? { zh: `剪辑师${words.zh}`, en: `The editor is ${words.en.toLowerCase()}` } : p.state === "done" ? { zh: "成片已出 · 看看", en: "The film is out · watch it" } : { zh: `渲染没成功 · 重试`, en: "The render failed · try again" };
  return (
    <span key="live">
      <Tr zh={text.zh} en={text.en} inZh={zh} />
    </span>
  );
}
