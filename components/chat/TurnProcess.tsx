"use client";

import * as React from "react";
import { STEP_LABELS, stepForTool } from "@/lib/agents/steps";

export type ProcessTool = { id: string; name: string; status: string; summary?: string; durationMs?: number | null; detail?: string; startedAtMs?: number };
export type ProcessMessage = {
  status: "streaming" | "complete" | "failed" | "stopped";
  content: string;
  tools: ProcessTool[];
  reasoning?: string;
  estimateMs?: number;
  startedAtMs?: number;
  finishedAtMs?: number;
};

const stepName = (t: ProcessTool, zh: boolean) => {
  if (t.detail) return t.detail.replace(/^正在/, "");
  const l = STEP_LABELS[stepForTool(t.name)];
  return (zh ? l.zh : l.en).replace(/^正在/, "").replace(/…$/, "");
};
const secs = (ms: number, zh: boolean) => {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return zh ? `${s} 秒` : `${s}s`;
  const m = Math.floor(s / 60);
  return zh ? `${m} 分 ${s % 60} 秒` : `${m}m ${s % 60}s`;
};

/**
 * What an AI turn is doing and did, shown the way DeepSeek shows it (15 Oct: "show the agent's thought
 * process, the actual steps", and "a good-looking loading bar: how much is done, how much time is left, and
 * a small line about what it is actually doing").
 *
 * While the turn runs: the step it is on in words, how many steps so far, time used and time left, a bar,
 * the model's thinking as it comes, and the finished steps ticked off. Once answered it folds to one line
 * ("已完成 · 4 步 · 23 秒") that opens to the same record.
 */
export function TurnProcess({ message, zh }: { message: ProcessMessage; zh: boolean }) {
  const live = message.status === "streaming";
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [live]);
  const [open, setOpen] = React.useState(false);

  const tools = message.tools;
  const thinking = message.reasoning?.trim() ?? "";
  if (!live && !tools.length && !thinking) return null;

  const running = [...tools].reverse().find((t) => t.status === "running");
  const writing = live && !running && message.content.length > 0;
  const doneSteps = tools.filter((t) => t.status !== "running").length;
  const step = running
    ? (running.detail ?? `正在${stepName(running, zh)}`)
    : writing
      ? (zh ? "正在写回答" : "Writing the answer")
      : doneSteps
        ? (zh ? "正在整理查到的内容" : "Going through what it found")
        : thinking
          ? (zh ? "正在思考" : "Thinking")
          : zh ? "正在理解你的问题" : "Reading your question";
  const started = message.startedAtMs ?? now;
  const elapsed = Math.max(0, now - started);
  const est = message.estimateMs && message.estimateMs > 2000 ? message.estimateMs : 25_000;
  /* Time-based, nudged forward by each finished step and by the answer arriving, never past 96% until it is done. */
  const done = tools.filter((t) => t.status !== "running").length;
  const byTime = elapsed / est;
  const pct = Math.min(0.96, Math.max(byTime, writing ? 0.85 : 0, done ? Math.min(0.8, 0.15 + done * 0.12) : 0.04));
  const left = est - elapsed;
  const over = left < 0;
  const total = message.finishedAtMs && message.startedAtMs ? message.finishedAtMs - message.startedAtMs : null;

  const list = (
    <div className="tp-body">
      {thinking ? (
        <div className="tp-think">
          <div className="tp-think-h">{zh ? "思考过程" : "Thinking"}</div>
          <div className="tp-think-t">{thinking}</div>
        </div>
      ) : null}
      {tools.length ? (
        <ol className="tp-steps">
          {tools.map((t, i) => (
            <li key={t.id + i} data-s={t.status}>
              <span className="tp-dot" aria-hidden>
                {t.status === "running" ? <span className="tp-spin" /> : t.status === "error" ? "!" : <svg viewBox="0 0 24 24" width="10" height="10"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </span>
              <span className="tp-name">{stepName(t, zh)}</span>
              <span className="tp-time">
                {t.status === "running" ? (t.startedAtMs ? secs(now - t.startedAtMs, zh) : zh ? "进行中" : "running") : t.status === "error" ? (zh ? "失败" : "failed") : t.durationMs ? secs(t.durationMs, zh) : ""}
              </span>
              {t.summary && t.status !== "running" ? <div className="tp-sum">{t.summary}</div> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );

  return (
    <div className={`tp${live ? " live" : ""}`}>
      <style>{CSS}</style>
      {live ? (
        <>
          <div className="tp-head">
            <span className="tp-pulse" aria-hidden />
            <span className="tp-step">{step}</span>
            <span className="tp-meta">
              {tools.length ? (zh ? `第 ${tools.length} 步 · ` : `step ${tools.length} · `) : ""}
              {secs(elapsed, zh)}
              {/* Once it is writing, the honest number is how much is written, not a countdown that has run out. */}
              {writing
                ? zh
                  ? ` · 已写 ${message.content.length} 字`
                  : ` · ${message.content.length} characters so far`
                : over
                  ? zh
                    ? " · 比平时久一些，还在做"
                    : " · taking longer than usual"
                  : zh
                    ? ` · 约剩 ${secs(left, zh)}`
                    : ` · ~${secs(left, zh)} left`}
            </span>
          </div>
          <div className="tp-bar" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${Math.round(pct * 100)}%` }} />
          </div>
          {list}
        </>
      ) : (
        <>
          <button type="button" className="tp-fold" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <svg viewBox="0 0 24 24" width="11" height="11" style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform .15s" }} aria-hidden><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            {message.status === "complete" ? (zh ? "已完成" : "Done") : message.status === "stopped" ? (zh ? "已停止" : "Stopped") : zh ? "没有完成" : "Not finished"}
            {tools.length ? (zh ? ` · ${tools.length} 步` : ` · ${tools.length} steps`) : ""}
            {total ? ` · ${secs(total, zh)}` : ""}
            {thinking ? (zh ? " · 看思考过程" : " · see the thinking") : ""}
          </button>
          {open ? list : null}
        </>
      )}
    </div>
  );
}

const CSS = `
.tp { margin: 2px 0 10px; font-size: 12.5px; color: #525252; }
.tp.live { border: 1px solid #ebeae6; border-radius: 12px; background: linear-gradient(180deg, #fcfcfb, #f8f8f6); padding: 10px 12px 8px; }
.tp-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.tp-pulse { width: 8px; height: 8px; border-radius: 50%; background: #2f7d4f; flex-shrink: 0; box-shadow: 0 0 0 0 rgba(47,125,79,.5); animation: tp-pulse 1.6s ease-out infinite; }
@keyframes tp-pulse { 0% { box-shadow: 0 0 0 0 rgba(47,125,79,.45); } 70% { box-shadow: 0 0 0 7px rgba(47,125,79,0); } 100% { box-shadow: 0 0 0 0 rgba(47,125,79,0); } }
.tp-step { font-weight: 600; color: #171717; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 auto; }
.tp-meta { color: #8a8a8a; font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; flex-shrink: 0; }
.tp-bar { height: 5px; border-radius: 3px; background: #ecebe7; overflow: hidden; margin: 8px 0 6px; }
.tp-bar span { display: block; height: 100%; border-radius: 3px; background: linear-gradient(90deg, #171717, #4a4a4a); position: relative; transition: width .5s ease; overflow: hidden; }
.tp-bar span::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent); animation: tp-shine 1.4s linear infinite; }
@keyframes tp-shine { from { transform: translateX(-100%); } to { transform: translateX(100%); } }
.tp-body { display: flex; flex-direction: column; gap: 6px; }
.tp-think { border-left: 2px solid #e3e2dd; padding: 2px 0 2px 10px; }
.tp-think-h { font-size: 11.5px; color: #8a8a8a; margin-bottom: 2px; }
.tp-think-t { white-space: pre-wrap; line-height: 1.6; color: #6b6b6b; max-height: 220px; overflow: auto; font-size: 12.5px; }
.tp-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.tp-steps li { display: grid; grid-template-columns: 16px 1fr auto; align-items: center; gap: 7px; }
.tp-dot { width: 16px; height: 16px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: #e8f3ec; color: #2f7d4f; font-size: 10px; font-weight: 700; }
.tp-steps li[data-s="running"] .tp-dot { background: #f0efeb; }
.tp-steps li[data-s="error"] .tp-dot { background: #fbeaea; color: #c42b2b; }
.tp-spin { width: 9px; height: 9px; border-radius: 50%; border: 1.6px solid #c7c7c7; border-top-color: #525252; animation: spin .7s linear infinite; }
.tp-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #3d3d3d; }
.tp-steps li[data-s="running"] .tp-name { color: #171717; font-weight: 500; }
.tp-time { color: #a3a3a3; font-size: 11.5px; font-variant-numeric: tabular-nums; }
.tp-sum { grid-column: 2 / 4; color: #8a8a8a; font-size: 12px; white-space: pre-wrap; line-height: 1.45; }
.tp-fold { border: 0; background: transparent; padding: 2px 0; font: inherit; font-size: 12px; color: #8a8a8a; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; }
.tp-fold:hover { color: #171717; }
.tp-fold + .tp-body { margin-top: 6px; border: 1px solid #ecebe7; border-radius: 10px; padding: 8px 10px; background: #fbfbfa; }
`;
