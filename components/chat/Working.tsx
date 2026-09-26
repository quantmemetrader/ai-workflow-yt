"use client";

import * as React from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { AGENT_COLORS, AGENT_TINTS, type AgentKey } from "@/lib/agents/catalog";
import { STEP_LABELS, directorStepLabel, stepLabel, type StepKey } from "@/lib/agents/steps";
import { soft } from "./look";

/**
 * The two live pieces the chat draws while an AI employee works, shared by
 * the channel (`ChannelSurface`) and the project page's chat drawer
 * (`ProjectScreen`), so both say the same thing the same way.
 *
 * Styled inline, with their one animation in a style tag of their own:
 * they are drawn inside two different surfaces with different CSS scopes.
 */
const KEYFRAMES = `@keyframes chatWorkDot { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }
@media (prefers-reduced-motion: reduce) { [data-work-dots] i { animation: none !important; opacity: .6 !important; } }`;

/** Three dots that breathe: something is happening, and it is not stuck. */
export function Dots() {
  const dot: React.CSSProperties = { width: 4, height: 4, borderRadius: 2, background: "currentColor", opacity: 0.3, animation: "chatWorkDot 1.2s ease-in-out infinite", display: "block" };
  return (
    <span data-work-dots="" aria-hidden style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />
      <i style={dot} />
      <i style={{ ...dot, animationDelay: ".15s" }} />
      <i style={{ ...dot, animationDelay: ".3s" }} />
    </span>
  );
}

/**
 * What an employee is doing right now, in its own colour: "正在看…",
 * "正在输入…", "正在写脚本", "正在粗剪" (`lib/agents/steps.ts`).
 */
export function WorkingPill({ agent, step, zh, compact = false }: { agent: AgentKey; step: StepKey; zh: boolean; compact?: boolean }) {
  const known = STEP_LABELS[step] ? step : "working";
  const label = stepLabel(known, zh).replace(/…$/, "");
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        height: compact ? 26 : 30,
        padding: compact ? "0 10px 0 8px" : "0 12px 0 10px",
        borderRadius: 999,
        fontSize: compact ? 12 : 12.5,
        fontWeight: 500,
        marginTop: 4,
        background: soft(AGENT_TINTS[agent], 0.45),
        color: AGENT_COLORS[agent],
        maxWidth: "100%",
      }}
    >
      <Icon name={STEP_LABELS[known].icon} size={13} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <Dots />
    </span>
  );
}

type JobState = { state: string; step: string | null; percent: number | null; error: string | null };

/** What the chip knows: nothing yet, an answer, or that there is nothing
 *  for this reader to follow (not theirs to open, or no job at all). */
type JobView = JobState | "gone" | null;

/**
 * A long job a message started — the director making the whole video, or a
 * render — followed live: its step and percent, asked of `/api/chat/job`
 * every few seconds while it runs and not after. Reads "进行中" until the
 * first answer, on the server and in the browser alike, so hydration agrees.
 */
export function JobChip({ job, zh, project }: { job: { videoProjectId: string }; zh: boolean; project?: { id: string } | null }) {
  const [view, setView] = React.useState<JobView>(null);
  React.useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const until = Date.now() + 40 * 60_000;
    const tick = async () => {
      if (!live) return;
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch(`/api/chat/job?project=${encodeURIComponent(job.videoProjectId)}`, { cache: "no-store" });
          /* A video this reader may not open (a private project's render
             narrated in #制作), or one that is gone: no chip, rather than
             "进行中" forever over a link that leads nowhere. */
          if (r.status === 403 || r.status === 404) {
            if (live) setView("gone");
            return;
          }
          if (r.ok) {
            const j = (await r.json()) as JobState;
            if (!live) return;
            /* Nothing started, nothing to follow. */
            setView(j.state === "idle" ? "gone" : j);
            if (j.state !== "queued" && j.state !== "running") return;
          }
        } catch {
          // The next tick tries again.
        }
      }
      if (Date.now() < until) timer = setTimeout(tick, 4000);
    };
    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [job.videoProjectId]);

  if (view === "gone") return null;
  const s = view;
  const href = project ? `/projects/${project.id}` : `/video?project=${job.videoProjectId}`;
  const failed = s?.state === "failed";
  const frame: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    height: 26,
    padding: "0 10px",
    borderRadius: 8,
    border: `1px solid ${failed ? "#f6d5d1" : "#e0efe6"}`,
    background: failed ? "#fdf3f2" : "#f3f8f5",
    color: failed ? "#a3281c" : "#0b7a63",
    fontSize: 12,
    marginTop: 8,
    textDecoration: "none",
  };
  if (failed) {
    return (
      <Link href={href} prefetch={false} style={frame}>
        <Icon name="film" size={12} />
        {zh ? `没做成${s.error ? `：${s.error.slice(0, 60)}` : ""}` : `Stopped${s.error ? `: ${s.error.slice(0, 60)}` : ""}`}
      </Link>
    );
  }
  if (s?.state === "done") {
    return (
      <Link href={href} prefetch={false} style={frame}>
        <Icon name="check" size={12} />
        {zh ? "成片已出 · 去看" : "Rendered · watch it"}
      </Link>
    );
  }
  const running = s !== null && (s.state === "queued" || s.state === "running");
  const what = !running ? (zh ? "进行中" : "In progress") : s.state === "queued" ? (zh ? "排队中" : "Queued") : `${zh ? "正在" : ""}${directorStepLabel(s.step, zh)}`;
  return (
    <Link href={href} prefetch={false} style={frame}>
      <Dots />
      {what}
      {running && s.percent !== null ? (
        <>
          <span aria-hidden style={{ width: 64, height: 4, borderRadius: 2, background: "#dcebe2", overflow: "hidden", display: "inline-block" }}>
            <b style={{ display: "block", height: "100%", width: `${Math.max(4, s.percent)}%`, background: "linear-gradient(90deg,#278f5e,#0f5bd5)", transition: "width .4s ease" }} />
          </span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{s.percent}%</span>
        </>
      ) : null}
    </Link>
  );
}
