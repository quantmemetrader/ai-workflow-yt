"use client";

import * as React from "react";
import Link from "next/link";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { SayToAgent } from "@/components/flow/SayToAgent";
import { AGENT_COLORS, AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import type { Pipeline, Stage, StageKey } from "@/lib/home/pipeline";

/**
 * Today's video as the board draws it: two rows, the second running back
 * under the first, one card per step with that employee's own mark.
 *
 * Every card opens the thing it is about, and has a line under it to talk
 * to whoever owns the step, so a comment is made where the step is rather
 * than in a channel somewhere else. The whole board is one big button away.
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

/** Who to talk to about a step that is yours: the one who hands it to you. */
const ASK: Record<StageKey, AgentKey> = {
  topic: "research",
  plan: "planning",
  script: "script",
  approve: "script",
  cut: "video",
  export: "video",
  publish: "article",
  feedback: "research",
};

export function MiniFlow({ pipeline, zh }: { pipeline: Pipeline; zh: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const [talking, setTalking] = React.useState<StageKey | null>(null);
  const s = pipeline.stages;
  const top = s.slice(0, 4);
  const bottom = s.slice(4, 8).reverse();
  const doneCount = s.filter((x) => x.state === "done").length;
  const yours = s.find((x) => x.state === "you") ?? null;

  const arrow = (dir: "right" | "left", live: boolean) => (
    <div aria-hidden style={{ display: "flex", alignItems: "center", justifyContent: "center", color: live ? "#0f5bd5" : "#b9b6b0", fontSize: 14 }}>
      {dir === "right" ? "→" : "←"}
    </div>
  );
  const live = (x: Stage) => x.state === "running" || x.state === "you";

  const card = (x: Stage) => (
    <StageCard key={x.key} alignRight={["script", "approve", "cut", "export"].includes(x.key)} stage={x} zh={zh} label={zh ? LABELS[x.key][0] : LABELS[x.key][1]} talking={talking === x.key} onTalk={() => setTalking(talking === x.key ? null : x.key)} ask={ASK[x.key]} />
  );

  return (
    <section style={{ background: "#ffffff", border: "1px solid #e2e2e2", borderRadius: 14, padding: "16px 16px 14px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 12, minWidth: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap" }}>{t("今天这条片走到哪了", "Where today's video is")}</span>
        <span style={{ fontSize: 12.5, color: pipeline.title ? "#525252" : "#b3b3b3", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {pipeline.title ?? t("还没有开始的片子", "Nothing in progress yet")}
        </span>
        <span style={{ flexGrow: 1 }} />
        <span style={{ fontSize: 12, color: "#999999", whiteSpace: "nowrap" }}>
          {t(`${doneCount}/8 步完成`, `${doneCount}/8 done`)}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 18px minmax(0,1fr) 18px minmax(0,1fr) 18px minmax(0,1fr)", rowGap: 4 }}>
        {top.flatMap((x, i) => (i === 0 ? [card(x)] : [<React.Fragment key={`a${i}`}>{arrow("right", live(x))}</React.Fragment>, card(x)]))}
        <div style={{ gridColumn: "7", display: "flex", justifyContent: "center", color: live(s[4]) ? "#0f5bd5" : "#b9b6b0", fontSize: 14, height: 18, alignItems: "center" }} aria-hidden>
          ↓
        </div>
        {bottom.flatMap((x, i) => (i === 0 ? [card(x)] : [<React.Fragment key={`b${i}`}>{arrow("left", live(bottom[i - 1]))}</React.Fragment>, card(x)]))}
      </div>

      <Link
        href="/flow"
        style={{
          marginTop: 14,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "14px 18px",
          borderRadius: 12,
          background: "linear-gradient(180deg, #2b2b2b, #111111)",
          color: "#fff",
          textDecoration: "none",
          boxShadow: "0 2px 8px rgba(0,0,0,0.14)",
        }}
      >
        <AgentIcon size={34} radius={9} />
        <span style={{ minWidth: 0, flexGrow: 1 }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 600 }}>{t("打开全部流程", "Open the full flow")}</span>
          <span style={{ display: "block", fontSize: 12, color: "#b3b3b3", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {yours
              ? t(`下一步需要你：${LABELS[yours.key][0]}。`, `Next it needs you: ${LABELS[yours.key][1]}.`)
              : t("没有人吩咐的时候，这些事也会发生。黑色是需要你点头的地方。", "These happen with nobody asking. Black is where you nod.")}
          </span>
        </span>
        <span style={{ fontSize: 20, lineHeight: 1 }}>→</span>
      </Link>
    </section>
  );
}

function StageCard({ stage: x, zh, label, talking, onTalk, ask, alignRight }: { alignRight: boolean; stage: Stage; zh: boolean; label: string; talking: boolean; onTalk: () => void; ask: AgentKey }) {
  const you = x.owner === "you";
  const color = you ? "#171717" : AGENT_COLORS[x.owner as AgentKey];
  const todo = x.state === "todo";
  const running = x.state === "running";
  const needsYou = x.state === "you";
  const owner = you ? (zh ? "你" : "You") : zh ? AGENT_LABELS[x.owner as AgentKey].nameLocal : AGENT_LABELS[x.owner as AgentKey].name;

  const frame: React.CSSProperties = needsYou
    ? { background: "#171717", color: "#fff", border: "1px solid #171717" }
    : running
      ? { border: "1px solid transparent", background: "linear-gradient(#fff, #fff) padding-box, linear-gradient(135deg, #278f5e, #0f5bd5) border-box" }
      : todo
        ? { border: "1px dashed #d9d9d9", background: "#fbfbfa" }
        : { border: "1px solid #e2e2e2", background: "#fff" };

  const body = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ opacity: todo ? 0.45 : 1, display: "flex" }}>
          <AgentIcon agent={you ? null : (x.owner as AgentKey)} size={26} radius={7} />
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 11, color: needsYou ? "#b3b3b3" : "#999999", whiteSpace: "nowrap" }}>
            {x.n} · {label}
          </span>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: needsYou ? "#fff" : todo ? "#999999" : color, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{owner}</span>
        </span>
      </div>
      <div style={{ fontSize: 11.5, marginTop: 7, lineHeight: 1.4, color: needsYou ? "#fff" : running ? color : todo ? "#b3b3b3" : "#525252", fontWeight: running || needsYou ? 500 : 400, minHeight: 32, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
        {running ? <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: color, marginRight: 5, verticalAlign: "1px", animation: "auraPulse 1.6s ease-in-out infinite" }} /> : null}
        {x.line}
      </div>
    </>
  );

  return (
    <div style={{ minWidth: 0, position: "relative" }}>
      <div style={{ ...frame, borderRadius: 10, padding: "10px 10px 8px", minWidth: 0 }}>
        {x.href ? (
          <Link href={x.href} title={x.line} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
            {body}
          </Link>
        ) : (
          body
        )}
        <button
          type="button"
          onClick={onTalk}
          aria-expanded={talking}
          style={{ marginTop: 6, height: 22, padding: "0 8px", borderRadius: 6, border: `1px solid ${needsYou ? "#4a4a4a" : "#e2e2e2"}`, background: needsYou ? "transparent" : "#fafafa", color: needsYou ? "#d9d9d9" : "#525252", fontFamily: "inherit", fontSize: 11, cursor: "pointer", letterSpacing: "inherit" }}
        >
          {talking ? (zh ? "收起" : "Close") : zh ? "说一句" : "Comment"}
        </button>
      </div>
      {talking ? (
        <div style={{ position: "absolute", ...(alignRight ? { right: 0 } : { left: 0 }), top: "calc(100% + 4px)", width: "max(100%, 280px)", zIndex: 5 }}>
          <SayToAgent agent={ask} about={label} zh={zh} onDone={onTalk} />
        </div>
      ) : null}
    </div>
  );
}
