"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { PipelineStrip } from "@/components/home/PipelineStrip";
import { AGENT_COLORS, AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import type { Automation, AutomationKey } from "@/lib/automations/service";
import type { Pipeline, Stage, StageKey } from "@/lib/home/pipeline";
import { setAutomationAction } from "@/app/(app)/settings/actions";
import { notify } from "@/lib/client/notify";

/**
 * 自动化流程 — how a video moves through the studio, and the switches on it.
 *
 * One chain, top to bottom, in the order the work goes: who does each step,
 * what starts it, where it is today, and the button to the thing itself. The
 * three automations sit beside it where they act, so "turn off the morning
 * brief" is done on the picture of the morning brief, not on a settings page
 * three screens away.
 */
export type AutomationRow = {
  key: AutomationKey;
  name: string;
  nameEn: string;
  what: string;
  whatEn: string;
  scheduled: boolean;
  value: Automation;
};

type Node = {
  stage: StageKey | "review";
  owner: AgentKey | "you";
  name: [string, string];
  what: [string, string];
  trigger: [string, string];
  automation?: AutomationKey;
};

const NODES: Node[] = [
  { stage: "topic", owner: "research", name: ["发晨报", "Morning brief"], what: ["频道数据、各平台热榜、对标账号，今天值得讨论的一个选题。", "Channel data, every platform's hot list, rivals, and one topic worth discussing today."], trigger: ["每天", "daily"], automation: "digest" },
  { stage: "plan", owner: "planning", name: ["派今天的活", "Today's to-dos"], what: ["把晨报变成待办，每条一位负责人，一个按钮开工。", "Turns the brief into to-dos, one owner each, one button to start."], trigger: ["晨报之后", "after the brief"], automation: "plan" },
  { stage: "script", owner: "script", name: ["写脚本", "Write the script"], what: ["按频道点赞率最高的结构写，用观众原话做钩子。", "Written to the channel's best-performing structure, hooked on a viewer's own words."], trigger: ["收到待办或被 @ 后", "on a to-do or an @"] },
  { stage: "approve", owner: "you", name: ["批准脚本", "Approve the script"], what: ["核查数字、来源、敏感表述。批准后自动交给剪辑师。", "Check the numbers, sources and wording. Approval hands it to the Editor."], trigger: ["脚本写完", "when the script is done"] },
  { stage: "cut", owner: "video", name: ["AI 粗剪", "Rough cut"], what: ["素材上传后自动转写；策划说这段能做什么；剪辑师按脚本粗剪。", "Footage is transcribed on upload, the Planner says what it is good for, the Editor cuts to the script."], trigger: ["素材上传后", "on upload"], automation: "footage" },
  { stage: "review", owner: "you", name: ["看粗剪", "Review the cut"], what: ["满意就出成片，不满意让它再短一点或换段落。", "Happy: render. Not: ask for shorter, or different segments."], trigger: ["粗剪出来后", "when the rough cut lands"] },
  { stage: "export", owner: "video", name: ["精剪输出", "Final cut"], what: ["字幕、图形、渲染成片。", "Captions, graphics, the render."], trigger: ["你确认后", "after your go"] },
  { stage: "publish", owner: "article", name: ["各平台文案与发布", "Copy and publish"], what: ["按平台改写标题和文案，排期发布。", "Titles and copy per platform, scheduled and posted."], trigger: ["成片出来后", "when the master is ready"] },
  { stage: "feedback", owner: "research", name: ["数据回流", "Numbers come back"], what: ["播放、点赞率、评论回到研究员手里，进明天的晨报。", "Views, like-rate and comments go back to the Researcher, into tomorrow's brief."], trigger: ["发布后 24 小时 · 回到第 1 步", "24h after posting · back to step 1"] },
];

export function FlowScreen({
  pipeline,
  automations,
  zh,
  canEdit,
}: {
  pipeline: Pipeline;
  automations: AutomationRow[];
  zh: boolean;
  canEdit: boolean;
}) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const byKey = new Map(pipeline.stages.map((s) => [s.key, s]));
  const auto = new Map(automations.map((a) => [a.key, a]));

  /* "看粗剪" is not a row anywhere; it is the gap between a rough cut that
     exists and a render that has not started. */
  const cut = byKey.get("cut");
  const exp = byKey.get("export");
  const review: Stage | null =
    cut && exp
      ? {
          key: "cut",
          n: 0,
          owner: "you",
          state: exp.state === "done" || exp.state === "running" ? "done" : cut.state === "done" ? "you" : "todo",
          line: exp.state === "done" || exp.state === "running" ? t("已确认", "confirmed") : cut.state === "done" ? t("等你看一眼", "waiting for you") : t("等上一步", "after the previous step"),
          href: cut.href,
          progress: null,
        }
      : null;

  function save(key: AutomationKey, patch: Partial<Automation>) {
    start(async () => {
      const res = await setAutomationAction(key, patch);
      if (res && "error" in res && res.error) {
        notify(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, overflowY: "auto" }}>
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "30px 26px 60px" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>{t("自动化流程", "The flow")}</h1>
            <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "#7c7c7c", lineHeight: 1.6 }}>
              {t("一条片从选题到数据回流怎么走，谁做哪一步，哪一步等你。", "How a video goes from topic to numbers, who does each step, and which steps wait on you.")}
            </p>
          </div>
          <span style={{ flexGrow: 1 }} />
          <Link href="/home" style={{ fontSize: 12.5, color: "#525252", textDecoration: "none", whiteSpace: "nowrap" }}>
            ← {t("回首页", "Home")}
          </Link>
        </div>

        <PipelineStrip pipeline={pipeline} zh={zh} cta={false} />

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 18, marginTop: 18, alignItems: "start" }}>
          {/* ---- the chain ------------------------------------------------ */}
          <div>
            {NODES.map((node, i) => {
              const stage = node.stage === "review" ? review : (byKey.get(node.stage) ?? null);
              const state = stage?.state ?? "todo";
              const color = node.owner === "you" ? "#171717" : AGENT_COLORS[node.owner];
              const dark = node.owner === "you";
              const running = state === "running";
              const a = node.automation ? auto.get(node.automation) : null;
              const when =
                a && a.scheduled && a.value.hour !== undefined
                  ? `${t(node.trigger[0], node.trigger[1])} ${String(a.value.hour).padStart(2, "0")}:${String(a.value.minute ?? 0).padStart(2, "0")}`
                  : t(node.trigger[0], node.trigger[1]);
              const off = a ? !a.value.enabled : false;

              return (
                <React.Fragment key={node.stage + node.owner}>
                  {i > 0 ? <Connector live={running || state === "you"} dashed={state === "todo"} /> : null}
                  <div
                    style={{
                      border: running ? "1px solid transparent" : dark ? "1px solid #171717" : state === "todo" ? "1px dashed #d9d9d9" : "1px solid #e2e2e2",
                      background: running
                        ? "linear-gradient(#fff, #fff) padding-box, linear-gradient(135deg, #278f5e, #0f5bd5) border-box"
                        : dark
                          ? "#171717"
                          : "#ffffff",
                      color: dark ? "#ffffff" : "#171717",
                      borderRadius: 12,
                      padding: "13px 15px",
                      display: "grid",
                      gridTemplateColumns: "26px minmax(0, 1fr) auto",
                      gap: "4px 12px",
                      alignItems: "center",
                      opacity: off ? 0.6 : 1,
                    }}
                  >
                    {node.owner === "you" ? (
                      <span style={{ width: 26, height: 26, borderRadius: 8, background: "#fff", color: "#171717", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {t("你", "U")}
                      </span>
                    ) : (
                      <AgentIcon agent={node.owner} size={26} radius={8} />
                    )}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                          {node.owner === "you" ? t("你", "You") : zh ? AGENT_LABELS[node.owner].nameLocal : AGENT_LABELS[node.owner].name}
                          <span style={{ color: dark ? "#b3b3b3" : "#999999", fontWeight: 400 }}> · </span>
                          {t(node.name[0], node.name[1])}
                        </span>
                        <span style={{ fontSize: 11.5, color: dark ? "#b3b3b3" : "#999999" }}>{when}</span>
                      </div>
                    </div>
                    <StatePill state={state} line={stage?.line ?? t("等上一步", "after the previous step")} color={color} dark={dark} zh={zh} />
                    <span />
                    <div style={{ fontSize: 12.5, lineHeight: 1.55, color: dark ? "#d9d9d9" : "#525252" }}>{t(node.what[0], node.what[1])}</div>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                      {a ? (
                        <Switch
                          on={a.value.enabled}
                          disabled={!canEdit || pending}
                          label={zh ? a.name : a.nameEn}
                          dark={dark}
                          onChange={(v) => save(a.key, { enabled: v })}
                        />
                      ) : null}
                      {stage?.href ? (
                        <Link
                          href={stage.href}
                          style={{
                            fontSize: 12,
                            color: dark ? "#ffffff" : "#525252",
                            textDecoration: "none",
                            border: `1px solid ${dark ? "#4a4a4a" : "#e2e2e2"}`,
                            borderRadius: 7,
                            height: 26,
                            padding: "0 9px",
                            display: "inline-flex",
                            alignItems: "center",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {t("打开", "Open")} →
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>

          {/* ---- the switches ------------------------------------------- */}
          <aside style={{ position: "sticky", top: 0, display: "flex", flexDirection: "column", gap: 12 }}>
            <section style={{ border: "1px solid #ededed", borderRadius: 14, background: "#fff", padding: "14px 16px" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t("自动化开关", "Automations")}</div>
              <p style={{ margin: "4px 0 10px", fontSize: 12, color: "#7c7c7c", lineHeight: 1.55 }}>
                {t("AI 员工在没人吩咐时做的事。时间是香港时间。", "What the AI employees do without being asked. Times are Hong Kong.")}
              </p>
              {automations.map((a) => (
                <div key={a.key} style={{ borderTop: "1px solid #f3f3f3", padding: "10px 0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <AgentIcon agent={a.value.agent} size={18} radius={5} />
                    <span style={{ fontSize: 12.5, fontWeight: 500, flexGrow: 1 }}>{zh ? a.name : a.nameEn}</span>
                    <Switch on={a.value.enabled} disabled={!canEdit || pending} label={zh ? a.name : a.nameEn} onChange={(v) => save(a.key, { enabled: v })} />
                  </div>
                  <div style={{ fontSize: 11.5, color: "#7c7c7c", lineHeight: 1.5, marginTop: 4 }}>{zh ? a.what : a.whatEn}</div>
                  {a.scheduled ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                      <span style={{ fontSize: 11.5, color: "#999999" }}>{t("每天", "Daily at")}</span>
                      <input
                        type="time"
                        disabled={!canEdit || pending}
                        defaultValue={`${String(a.value.hour ?? 8).padStart(2, "0")}:${String(a.value.minute ?? 0).padStart(2, "0")}`}
                        onBlur={(e) => {
                          const [h, m] = e.target.value.split(":").map(Number);
                          if (Number.isInteger(h) && Number.isInteger(m) && (h !== a.value.hour || m !== a.value.minute)) save(a.key, { hour: h, minute: m });
                        }}
                        style={{ height: 26, padding: "0 7px", border: "1px solid #e2e2e2", borderRadius: 7, fontFamily: "inherit", fontSize: 12, color: "#171717", background: "#fff" }}
                      />
                      <span style={{ fontSize: 11.5, color: "#c7c7c7" }}>HKT</span>
                    </div>
                  ) : null}
                </div>
              ))}
              {!canEdit ? (
                <div style={{ fontSize: 11.5, color: "#999999", marginTop: 6 }}>{t("只有负责人和管理员能改。", "Only the owner and admins can change these.")}</div>
              ) : null}
            </section>

            <section style={{ border: "1px solid #ededed", borderRadius: 14, background: "#fff", padding: "14px 16px" }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{t("怎么读", "How to read this")}</div>
              <ul style={{ margin: "8px 0 0", padding: "0 0 0 16px", fontSize: 12, color: "#525252", lineHeight: 1.7 }}>
                <li>{t("彩色边框的一步正在进行。", "A coloured border means that step is running now.")}</li>
                <li>{t("黑色的一步等你决定。", "A black step is waiting on you.")}</li>
                <li>{t("虚线的一步还没到。", "A dashed step has not started.")}</li>
                <li>{t("每一步都能打开对应的东西：晨报、脚本、项目。", "Every step opens the thing itself: the brief, the script, the project.")}</li>
              </ul>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function StatePill({ state, line, color, dark, zh }: { state: Stage["state"]; line: string; color: string; dark: boolean; zh: boolean }) {
  const look =
    state === "done"
      ? { bg: dark ? "#2b2b2b" : "#e6f4ec", fg: dark ? "#8fd3ae" : "#0b7a63" }
      : state === "running"
        ? { bg: "#fff", fg: color }
        : state === "you"
          ? { bg: dark ? "#ffffff" : "#171717", fg: dark ? "#171717" : "#ffffff" }
          : { bg: dark ? "#2b2b2b" : "#f3f3f3", fg: dark ? "#b3b3b3" : "#999999" };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 22,
        padding: "0 9px",
        borderRadius: 999,
        background: look.bg,
        color: look.fg,
        border: state === "running" ? `1px solid ${color}` : "1px solid transparent",
        fontSize: 11.5,
        fontWeight: 500,
        whiteSpace: "nowrap",
      }}
      title={zh ? "这一步现在的状态" : "This step right now"}
    >
      {state === "running" ? <span style={{ width: 6, height: 6, borderRadius: 3, background: color, animation: "auraPulse 1.6s ease-in-out infinite" }} /> : null}
      {line}
    </span>
  );
}

function Connector({ live, dashed }: { live: boolean; dashed: boolean }) {
  const id = React.useId().replace(/:/g, "");
  return (
    <svg width="60" height="18" viewBox="0 0 60 18" aria-hidden style={{ display: "block", marginLeft: 0 }}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={live ? "#278f5e" : "#cfcbc3"} />
          <stop offset="1" stopColor={live ? "#0f5bd5" : "#a9a6a0"} />
        </linearGradient>
        <marker id={`h${id}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0 0 L6 3 L0 6 z" fill={live ? "#0f5bd5" : "#a9a6a0"} />
        </marker>
      </defs>
      <path d="M28 0 L28 16" fill="none" stroke={`url(#g${id})`} strokeWidth="1.5" strokeDasharray={dashed ? "3 3" : undefined} markerEnd={`url(#h${id})`} />
    </svg>
  );
}

function Switch({ on, disabled, label, dark, onChange }: { on: boolean; disabled: boolean; label: string; dark?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      style={{
        width: 34,
        height: 20,
        borderRadius: 999,
        border: 0,
        padding: 2,
        background: on ? "#278f5e" : dark ? "#4a4a4a" : "#d9d9d9",
        cursor: disabled ? "default" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: on ? "flex-end" : "flex-start",
        flexShrink: 0,
        opacity: disabled ? 0.7 : 1,
      }}
    >
      <span style={{ width: 16, height: 16, borderRadius: 8, background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
    </button>
  );
}
