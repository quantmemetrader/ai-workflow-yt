import * as React from "react";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { AGENT_COLORS, AGENT_LABELS, AGENT_TINTS, type AgentKey } from "@/lib/agents/catalog";
import { STEP_LABELS, stepForTool, type StepKey } from "@/lib/agents/steps";
import { AgentName, Tr } from "@/components/ui/Tr";
import { soft } from "@/components/chat/look";

/**
 * An AI employee at work on an answer, drawn the same way everywhere.
 *
 * "Need typing animation of AI as in chat or editing and stuff until AI
 * responds." Before this, each surface said it differently or not at all:
 * grey "思考中…" on the assistant screen, a blue spinner in the side panels,
 * a pulsing dot on the project cards, a tinted pill in the channel, and
 * nothing at all after 交代 on Home. Now every place an answer is pending
 * draws this: the employee's pixel face, a pill in its tint that says what
 * it is doing — 正在输入, 正在查资料, 正在写脚本, 正在剪辑, 正在渲染
 * (`lib/agents/steps.ts`, the same table the channel's working rows use) —
 * and three dots that breathe. A render or a director run adds its percent.
 *
 * The motion is CSS (app/globals.css, `.agent-typing*`): no interval, no
 * state, so the server's markup and the browser's first render agree.
 *
 * `face={false}` is for rows that already draw the employee's face beside
 * the text (a message row, a panel's header); the pill then sits where the
 * words will appear.
 */
export function AgentTyping({
  agent,
  zh,
  step = "typing",
  label,
  percent = null,
  face = true,
  name = false,
  size = "md",
  style,
}: {
  /** Who is answering; null is the person's own assistant (the robot). */
  agent: AgentKey | null;
  zh: boolean;
  /** What it is doing, from the shared step table. */
  step?: StepKey;
  /** Words of the caller's own instead of the step's, e.g. a stage of the
   *  idea generator. A string is shown as it is (already in the UI's
   *  language); a pair is made translate-proof. */
  label?: string | { zh: string; en: string };
  /** A job's progress, 0–100, shown as a short bar and a number. */
  percent?: number | null;
  face?: boolean;
  /** Put the employee's name in front of the step: "编剧 正在写脚本". */
  name?: boolean;
  size?: "sm" | "md";
  style?: React.CSSProperties;
}) {
  const known = STEP_LABELS[step] ? step : "working";
  const words = typeof label === "string" ? label : label ?? { zh: STEP_LABELS[known].zh, en: STEP_LABELS[known].en };
  /* The trailing ellipsis is the dots' job. */
  const text =
    typeof words === "string" ? (
      words.replace(/…$/, "")
    ) : (
      <Tr zh={words.zh.replace(/…$/, "")} en={words.en.replace(/…$/, "")} inZh={zh} />
    );
  const spoken = `${agent ? (zh ? AGENT_LABELS[agent].nameLocal : AGENT_LABELS[agent].nameEn) : zh ? "你的助理" : "Your assistant"} ${
    typeof words === "string" ? words : zh ? words.zh : words.en
  }`;
  const ink = agent ? AGENT_COLORS[agent] : "#525252";
  const tint = agent ? soft(AGENT_TINTS[agent], 0.5) : "#f1f1f0";
  const pct = percent === null || !Number.isFinite(percent) ? null : Math.max(0, Math.min(100, Math.round(percent)));
  const faceSize = size === "sm" ? 20 : 24;

  return (
    <span className={`agent-typing${size === "sm" ? " sm" : ""}`} role="status" aria-live="polite" aria-label={spoken} style={style}>
      {face ? (
        <span className="agent-typing-face" aria-hidden>
          <AgentIcon agent={agent} size={faceSize} radius={size === "sm" ? 6 : 7} />
        </span>
      ) : null}
      <span className="agent-typing-pill" aria-hidden style={{ background: tint, color: ink }}>
        {name && agent ? (
          <span className="agent-typing-name">
            <AgentName agent={agent} zh={zh} />
          </span>
        ) : null}
        <span className="agent-typing-label">{text}</span>
        {pct !== null ? (
          <>
            <span className="agent-typing-bar">
              <b style={{ width: `${Math.max(4, pct)}%` }} />
            </span>
            <span className="agent-typing-pct">{pct}%</span>
          </>
        ) : null}
        <span className="agent-typing-dots">
          <i />
          <i />
          <i />
        </span>
      </span>
    </span>
  );
}

/**
 * What a streamed turn is doing right now, from its tool events: the step
 * of the tool still running (the last one started), else typing — the
 * model is writing, or about to.
 */
export function streamStep(tools: { name: string; status: string }[]): StepKey {
  for (let i = tools.length - 1; i >= 0; i--) {
    if (tools[i].status === "running") return stepForTool(tools[i].name);
  }
  return "typing";
}
