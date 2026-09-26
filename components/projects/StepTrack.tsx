import * as React from "react";
import { Icon } from "@/components/ui/Icon";
import { AGENT_COLORS, AGENT_TINTS, type AgentKey } from "@/lib/agents/catalog";
import type { ProjectStep } from "@/lib/projects/service";
import type { PublishedPlace } from "@/lib/projects/publication";
import { PublishedPill } from "@/components/projects/Published";

/**
 * Where a project stands, drawn the same way wherever a project is a card.
 *
 * Home's project panel (`components/home/ProjectHub.tsx`) drew this first and
 * the projects list (`components/projects/ProjectsList.tsx`) was a row of grey
 * words ("进行中 · 完整流程 · 共享") beside it. Two drawings of one fact drift
 * apart, so both import these three from here:
 *
 *   `StepTrack`   the five steps as a small stepper, each dot in its
 *                 employee's light tint (AGENT_TINTS), the host's own steps in
 *                 a warm one, the step it has got to ringed.
 *   `StageBadge`  the soft pill beside a title: 等你 / 进行中 / 下一步 /
 *                 已完成, and for a finished project the green 已发布 pill
 *                 (with where it went) or a grey 已归档.
 *   `STAGE_TONE`  the four tints both of them and the cards' hover borders
 *                 read from.
 *
 * Inline styles only, no stylesheet: the stepper is drawn up to sixty times on
 * one page and a `<style>` per instance is sixty copies of the same rules. The
 * line between two dots, which Home drew with a `::before`, is a real span
 * here for the same reason. The pulse on a step at work borrows the global
 * `auraPulse` keyframes (app/canvas.css). Server-safe: no hooks, no clock.
 */

/** Soft tints for where a project stands. */
export const STAGE_TONE = {
  you: { bg: "#fff4df", ink: "#95590a", line: "#f4ddb0", dot: "#f0a53a" },
  running: { bg: "#e9f2fe", ink: "#1f5fbf", line: "#cfe0fb", dot: "#4a90e2" },
  todo: { bg: "#f3f3f1", ink: "#5f5f5f", line: "#e6e6e3", dot: "#b8b8b4" },
  done: { bg: "#e7f6ee", ink: "#1e7a4f", line: "#cbe9d8", dot: "#3fb57a" },
} as const;

export type StageTone = (typeof STAGE_TONE)[keyof typeof STAGE_TONE];

/** The tone of a project from the step it has got to (`frontierStep`);
 * null means every step is done. */
export function stageToneOf(now: Pick<ProjectStep, "state"> | null): StageTone {
  if (!now) return STAGE_TONE.done;
  return now.state === "you" ? STAGE_TONE.you : now.state === "running" ? STAGE_TONE.running : STAGE_TONE.todo;
}

/** The host's own steps (upload the clips, approve the cut) in a warm light tint. */
const YOU_TINT = "#fcebc9";
const YOU_INK = "#95590a";

/**
 * The soft status pill.
 *
 * `status` is the project's own status, when the caller has it: a done
 * project is 已发布 — the green pill from `Published.tsx`, with the marks of
 * where it went (`published`) — and an archived one 已归档 in grey, whatever
 * its steps say. Without it the pill is read from the step alone, as it
 * always was.
 */
export function StageBadge({ now, zh, status, published }: { now: Pick<ProjectStep, "state"> | null; zh: boolean; status?: string; published?: readonly PublishedPlace[] | null }) {
  const t = (a: string, b: string) => (zh ? a : b);
  if (status === "done") return <PublishedPill zh={zh} platforms={published ?? []} />;
  const archived = status === "archived";
  const tone = archived ? STAGE_TONE.todo : status === "done" ? STAGE_TONE.done : stageToneOf(now);
  const label = archived
    ? t("已归档", "Archived")
    : status === "done"
      ? t("已交付", "Delivered")
      : !now
        ? t("已完成", "Done")
        : now.state === "you"
          ? t("等你", "Needs you")
          : now.state === "running"
            ? t("进行中", "Working")
            : t("下一步", "Next");
  const live = !archived && status !== "done" && now?.state === "running";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap", color: tone.ink, background: tone.bg, borderRadius: 999, padding: "2px 9px 2px 7px" }}>
      <span style={{ width: 6, height: 6, borderRadius: 3, background: tone.dot, animation: live ? "auraPulse 1.4s ease-in-out infinite" : undefined }} />
      {label}
    </span>
  );
}

/** The five steps as a small stepper: each dot in its employee's light colour. */
export function StepTrack({ steps, current }: { steps: ProjectStep[]; current: string | null }) {
  return (
    <span style={{ display: "grid", gridTemplateColumns: `repeat(${steps.length}, minmax(0,1fr))` }}>
      {steps.map((s, i) => {
        const tint = s.owner === "you" ? YOU_TINT : AGENT_TINTS[s.owner as AgentKey];
        const ink = s.owner === "you" ? YOU_INK : AGENT_COLORS[s.owner as AgentKey];
        const done = s.state === "done";
        const skipped = s.state === "skipped";
        const isNow = current === s.key;
        const prevDone = i > 0 && (steps[i - 1].state === "done" || steps[i - 1].state === "skipped");
        const dot: React.CSSProperties = done
          ? { background: tint, color: ink }
          : skipped
            ? { background: "#fff", border: "1.5px dashed #d6d6d2", color: "#c4c4c0" }
            : isNow
              ? { background: "#fff", border: `2px solid ${ink}`, boxShadow: `0 0 0 3px ${tint}` }
              : { background: "#f4f4f2", border: "1px solid #e6e6e3" };
        return (
          <span key={s.key} title={`${s.label} · ${s.line}`} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
            {/* The line in from the step before: tinted once that step is behind us. */}
            {i > 0 ? <span aria-hidden style={{ position: "absolute", top: 9, left: "calc(-50% + 12px)", right: "calc(50% + 12px)", height: 2, borderRadius: 1, background: prevDone ? tint : "#ececea" }} /> : null}
            <span style={{ position: "relative", zIndex: 1, width: 20, height: 20, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxSizing: "border-box", ...dot }}>
              {done ? (
                <Icon name="check" size={11} strokeWidth={2.6} />
              ) : isNow ? (
                <span style={{ width: 7, height: 7, borderRadius: 4, background: ink, animation: s.state === "running" ? "auraPulse 1.4s ease-in-out infinite" : undefined }} />
              ) : null}
            </span>
            <span style={{ maxWidth: "100%", fontSize: 11, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isNow ? ink : done ? "#525252" : "#a8a8a4", fontWeight: isNow ? 600 : 500, textDecoration: skipped ? "line-through" : undefined }}>{s.label}</span>
          </span>
        );
      })}
    </span>
  );
}
