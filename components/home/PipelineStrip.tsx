"use client";

import * as React from "react";
import Link from "next/link";
import { AGENT_COLORS, AGENT_LABELS } from "@/lib/agents/catalog";
import type { Pipeline, Stage, StageKey } from "@/lib/home/pipeline";

/**
 * Today's video as eight steps in a row, each coloured by who does it.
 *
 * Drawn as the approved board draws it: a white panel with a hairline, a
 * 4px bar per step in the employee's colour, the step's number and name, the
 * employee, and one line on where it is. Read from `pipelineToday`; nothing
 * here decides anything. A step is a link to the thing it is about.
 */
const LABELS: Record<StageKey, [string, string]> = {
  topic: ["选题", "Topic"],
  plan: ["计划", "Plan"],
  script: ["文稿", "Script"],
  approve: ["核查锁稿", "Approve"],
  cut: ["AI 粗剪", "Rough cut"],
  export: ["精剪输出", "Final cut"],
  publish: ["多平台发布", "Publish"],
  feedback: ["数据回流", "Feedback"],
};

const SHORT: Record<Exclude<Stage["owner"], "you">, string> = {
  research: "Researcher",
  planning: "Planner",
  script: "Writer",
  video: "Editor",
  article: "Copywriter",
};

function ownerName(stage: Stage, zh: boolean): string {
  if (stage.owner === "you") return zh ? "你" : "You";
  return zh ? AGENT_LABELS[stage.owner].nameLocal : SHORT[stage.owner];
}

function ownerColor(stage: Stage): string {
  return stage.owner === "you" ? "#171717" : AGENT_COLORS[stage.owner];
}

function bar(stage: Stage): React.CSSProperties {
  const color = ownerColor(stage);
  if (stage.state === "done" || stage.state === "you") return { background: color };
  if (stage.state === "running") {
    const pct = stage.progress !== null && stage.progress > 0 ? Math.round(stage.progress * 100) : 50;
    return { background: `linear-gradient(90deg, ${color} ${pct}%, #e2e2e2 ${pct}%)` };
  }
  return { background: "#e2e2e2" };
}

export function PipelineStrip({
  pipeline,
  zh,
  /** The button to the whole flow. Off on the flow page itself. */
  cta = true,
}: {
  pipeline: Pipeline;
  zh: boolean;
  cta?: boolean;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const active = pipeline.stages.find((s) => s.state === "running" || s.state === "you") ?? null;

  return (
    <section style={{ background: "#ffffff", border: "1px solid #e2e2e2", padding: "14px 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, minWidth: 0 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>{t("今天这条片走到哪了", "Where today's video is")}</span>
        {pipeline.title ? (
          <span style={{ fontSize: 12, color: "#999999", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pipeline.title}</span>
        ) : (
          <span style={{ fontSize: 12, color: "#c7c7c7" }}>{t("还没有开始的片子", "Nothing in progress yet")}</span>
        )}
        <span style={{ flexGrow: 1 }} />
        {cta ? (
          <Link
            href="/flow"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              height: 30,
              padding: "0 13px",
              border: "1px solid #171717",
              background: "linear-gradient(180deg, #2b2b2b, #171717)",
              color: "#ffffff",
              fontSize: 12.5,
              fontWeight: 500,
              textDecoration: "none",
              whiteSpace: "nowrap",
              flexShrink: 0,
              boxShadow: "0 1px 1px rgba(0,0,0,0.12)",
            }}
          >
            {t("打开全部流程", "Open the full flow")} →
          </Link>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gap: 10 }}>
        {pipeline.stages.map((s) => {
          const dim = s.state === "todo";
          const color = ownerColor(s);
          const on = active?.key === s.key;
          const inner = (
            <>
              <div style={{ height: 4, ...bar(s) }} />
              <div style={{ fontSize: 11, color: "#999999", marginTop: 7, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.n} · {zh ? LABELS[s.key][0] : LABELS[s.key][1]}
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 500, color: dim ? "#999999" : color, marginTop: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {ownerName(s, zh)}
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  marginTop: 3,
                  lineHeight: 1.4,
                  color: s.state === "running" ? color : s.state === "you" ? "#171717" : dim ? "#999999" : "#525252",
                  fontWeight: s.state === "running" || s.state === "you" ? 500 : 400,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                }}
              >
                {s.line}
              </div>
            </>
          );
          const style: React.CSSProperties = {
            minWidth: 0,
            display: "block",
            textDecoration: "none",
            color: "inherit",
            padding: on ? "6px 8px 8px" : "6px 0 8px",
            margin: on ? "0 -8px" : 0,
            background: on ? "#f7f7f5" : "transparent",
          };
          return s.href ? (
            <Link key={s.key} href={s.href} style={style} title={s.line}>
              {inner}
            </Link>
          ) : (
            <div key={s.key} style={style}>
              {inner}
            </div>
          );
        })}
      </div>
    </section>
  );
}
