"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AGENT_COLORS, AGENT_LABELS, type AgentKey } from "@/lib/agents/catalog";
import type { Automation, AutomationKey } from "@/lib/automations/service";
import type { Pipeline, Stage } from "@/lib/home/pipeline";
import { setAutomationAction } from "@/app/(app)/settings/actions";
import { notify } from "@/lib/client/notify";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { SayToAgent } from "@/components/flow/SayToAgent";

/**
 * 自动化流程 — the approved board, live.
 *
 * Twelve nodes on dotted paper in the board's own positions, arrows between
 * them, one colour per employee. Black nodes are where a person nods. A
 * running node has the green-to-blue border; a step that has not come is
 * dashed and grey. The three automations are switches on the nodes they
 * govern. Every node opens the thing itself: the brief, the plan, the
 * script, the project.
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

type State = Stage["state"];
type Node = {
  id: string;
  x: number;
  y: number;
  owner: AgentKey | "you" | "loop";
  when: string;
  name: string;
  what: string;
  state: State;
  href?: string | null;
  chip?: string | null;
  buttons?: { label: string; href: string; primary?: boolean }[];
  automation?: AutomationKey;
};

const W = 1254;
const H = 860;

export function FlowScreen({ pipeline, automations, zh, canEdit }: { pipeline: Pipeline; automations: AutomationRow[]; zh: boolean; canEdit: boolean }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [talk, setTalk] = React.useState<string | null>(null);
  const by = new Map(pipeline.stages.map((s) => [s.key, s]));
  const auto = new Map(automations.map((a) => [a.key, a]));
  const S = (k: Stage["key"]) => by.get(k)!;
  const hhmm = (a?: AutomationRow) => (a?.value.hour !== undefined ? `${String(a.value.hour).padStart(2, "0")}:${String(a.value.minute ?? 0).padStart(2, "0")}` : "");

  function save(key: AutomationKey, patch: Partial<Automation>) {
    start(async () => {
      const res = await setAutomationAction(key, patch);
      if (res && "error" in res && res.error) notify(res.error);
      else router.refresh();
    });
  }

  const topic = S("topic"), plan = S("plan"), script = S("script"), approve = S("approve"), cut = S("cut"), exp = S("export"), publish = S("publish"), feedback = S("feedback");
  /* "看成片" is the gap between a finished render and a post. */
  const review: State = publish.state !== "todo" ? "done" : exp.state === "done" ? "you" : "todo";
  const postApprove: State = publish.state === "done" ? "done" : publish.state === "you" ? "you" : "todo";
  const scriptHref = pipeline.scriptId ? `/script/${pipeline.scriptId}` : "/script";
  const projectHref = pipeline.projectId ? `/video?project=${pipeline.projectId}` : "/video";

  const nodes: Node[] = [
    { id: "digest", x: 40, y: 96, owner: "research", when: `${t("每天", "Daily")} ${hhmm(auto.get("digest"))}`, name: t("研究员发晨报", "Researcher's brief"), what: t("频道数据、各平台热榜、对标账号", "Channel data, hot lists, rivals"), state: topic.state, href: topic.href, chip: topic.state === "done" ? t("研究日报 · 今天", "Brief · today") : t("研究日报", "Brief"), automation: "digest" },
    { id: "plan", x: 356, y: 96, owner: "planning", when: plan.state === "done" ? plan.line : `${t("晨报之后", "After the brief")} ${hhmm(auto.get("plan"))}`, name: t("策划派今天的活", "Planner assigns the day"), what: t("每条待办一位负责人，一个按钮开工", "One owner per to-do, one button to start"), state: plan.state, href: plan.href, chip: t("今日计划", "Today's plan"), automation: "plan" },
    { id: "script", x: 672, y: 96, owner: "script", when: script.line, name: t("编剧写脚本", "Writer writes the script"), what: t("按频道点赞率最高的结构", "To the channel's best-performing structure"), state: script.state, href: scriptHref, chip: pipeline.title ? `${t("脚本", "Script")} · ${pipeline.title}` : t("脚本", "Script") },
    { id: "approve", x: 988, y: 96, owner: "you", when: approve.state === "done" ? approve.line : approve.state === "you" ? t("需要你", "Needs you") : t("脚本写完后", "After the script"), name: t("批准脚本", "Approve the script"), what: t("批准后自动交给剪辑师", "Approval hands it to the Editor"), state: approve.state, href: approve.href, buttons: approve.state === "you" ? [{ label: t("批准", "Approve"), href: `${scriptHref}?tab=approval`, primary: true }, { label: t("让它改", "Ask for changes"), href: scriptHref }] : undefined },
    { id: "cut", x: 988, y: 356, owner: "video", when: cut.state === "todo" && !pipeline.projectId ? t("素材上传后", "On upload") : cut.line, name: t("转写 + 粗剪", "Transcribe + rough cut"), what: t("按简报时长剪，开头结尾保留", "Cut to the brief's length, opening and ending kept"), state: cut.state, href: cut.href, chip: cut.state === "done" ? `${t("粗剪", "Rough cut")} · ${cut.line}` : null, automation: "footage" },
    { id: "export", x: 672, y: 356, owner: "video", when: exp.state === "running" ? exp.line : exp.state === "done" ? exp.line : t("粗剪确认后", "After the rough cut"), name: t("图形 + 渲染", "Graphics + render"), what: t("字幕、图形、成片", "Captions, graphics, the master"), state: exp.state, href: exp.href },
    { id: "review", x: 356, y: 356, owner: "you", when: review === "you" ? t("需要你", "Needs you") : review === "done" ? t("已确认", "Confirmed") : t("成片出来后", "When the master is ready"), name: t("看成片", "Watch the cut"), what: t("满意 / 再短一点 / 换开头", "Happy / shorter / new opening"), state: review, href: projectHref, buttons: review === "you" ? [{ label: t("满意", "Happy"), href: projectHref, primary: true }, { label: t("再短一点", "Shorter"), href: projectHref }, { label: t("换开头", "New opening"), href: projectHref }] : undefined },
    { id: "copy", x: 40, y: 356, owner: "article", when: publish.state === "todo" ? t("成片确认后", "After sign-off") : publish.line, name: t("撰稿人写各平台文案", "Copywriter writes per platform"), what: "YouTube · 小红书 · 抖音 · 微博", state: publish.state === "you" ? "done" : publish.state, href: publish.href },
    { id: "post", x: 40, y: 616, owner: "you", when: postApprove === "you" ? t("需要你", "Needs you") : postApprove === "done" ? t("已发布", "Published") : t("文案写好后", "After the copy"), name: t("批准发布", "Approve publishing"), what: t("每个平台单独确认", "Each platform confirmed on its own"), state: postApprove, href: "/publish", buttons: postApprove === "you" ? [{ label: t("全部发布", "Publish all"), href: "/publish", primary: true }, { label: t("逐个看", "One by one"), href: "/publish" }] : undefined },
    { id: "comments", x: 356, y: 616, owner: "research", when: t("发布后", "After posting"), name: t("收评论，写回复草稿", "Collect comments, draft replies"), what: t("观众的问题进选题储备", "Viewer questions go into the backlog"), state: feedback.state === "done" ? "done" : "todo", href: "/research/inbox" },
    { id: "numbers", x: 672, y: 616, owner: "research", when: t("发布后 24 小时", "24h after posting"), name: t("研究员复盘数据", "Researcher reads the numbers"), what: t("点赞率、完播，回流到明天", "Like-rate and watch-through feed tomorrow"), state: feedback.state, href: "/research/performance" },
    { id: "loop", x: 988, y: 616, owner: "loop", when: t("循环", "Loop"), name: t(`明天 ${hhmm(auto.get("digest")) || "08:00"} 再来一轮`, `Again tomorrow at ${hhmm(auto.get("digest")) || "08:00"}`), what: t("昨天的结果决定今天的选题", "Yesterday's results choose today's topic"), state: "todo" },
  ];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const edges: { from: string; to: string; d: string; label?: string; loop?: boolean }[] = [
    { from: "digest", to: "plan", d: "M276 154 L356 154", label: hhmm(auto.get("plan")) },
    { from: "plan", to: "script", d: "M592 154 L672 154" },
    { from: "script", to: "approve", d: "M908 154 L988 154" },
    { from: "approve", to: "cut", d: "M1106 246 L1106 356" },
    { from: "cut", to: "export", d: "M988 414 L908 414" },
    { from: "export", to: "review", d: "M672 414 L592 414" },
    { from: "review", to: "copy", d: "M356 414 L276 414" },
    { from: "copy", to: "post", d: "M158 476 L158 616" },
    { from: "post", to: "comments", d: "M276 674 L356 674" },
    { from: "comments", to: "numbers", d: "M592 674 L672 674", label: "+24h" },
    { from: "numbers", to: "loop", d: "M908 674 L988 674", loop: true },
    { from: "loop", to: "digest", d: "M1106 616 C 1106 40, 158 40, 158 96", loop: true },
  ];

  const doneCount = nodes.filter((n) => n.state === "done" && n.owner !== "you").length;
  const nodded = nodes.filter((n) => n.state === "done" && n.owner === "you").length;
  const next = nodes.find((n) => n.state === "you") ?? null;

  return (
    <div style={{ flexGrow: 1, minWidth: 0, minHeight: 0, overflow: "auto", ...PAPER }}>
      <div style={{ position: "relative", width: W, height: H, margin: "0 auto" }}>
        {/* ---- title row ---- */}
        <div style={{ position: "absolute", left: 26, right: 26, top: 0, height: 56, display: "flex", alignItems: "center", gap: 14 }}>
          <Link href="/home" style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 9, border: "1px solid #d9d9d9", background: "#fff", color: "#171717", fontSize: 12.5, textDecoration: "none", flexShrink: 0 }}>
            ← {t("回首页", "Back to Home")}
          </Link>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{t("自动化流程", "The flow")}</div>
            <div style={{ fontSize: 12, color: "#525252" }}>{t("没有人吩咐的时候，这些事也会发生。黑色是需要你点头的地方。", "These happen with nobody asking. Black is where you nod.")}</div>
          </div>
          <div style={{ flexGrow: 1 }} />
          {(["research", "planning", "script", "video", "article"] as AgentKey[]).map((k) => (
            <span key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#525252" }}>
              <AgentIcon agent={k} size={18} radius={5} />
              {zh ? AGENT_LABELS[k].nameLocal : AGENT_LABELS[k].name}
            </span>
          ))}
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#525252" }}>
            <span style={{ width: 18, height: 18, borderRadius: 5, background: "#171717", flexShrink: 0 }} />
            {t("你", "You")}
          </span>
        </div>

        {/* ---- arrows ---- */}
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
          <defs>
            <marker id="fl-head" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M0 0 L7 3.5 L0 7 z" fill="#a9a6a0" />
            </marker>
            <marker id="fl-head-run" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
              <path d="M0 0 L7 3.5 L0 7 z" fill="#0f5bd5" />
            </marker>
            <linearGradient id="fl-flow" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#cfcbc3" />
              <stop offset="1" stopColor="#a9a6a0" />
            </linearGradient>
            <linearGradient id="fl-run" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#278f5e" />
              <stop offset="1" stopColor="#0f5bd5" />
            </linearGradient>
            <linearGradient id="fl-loop" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#0f5bd5" />
              <stop offset="1" stopColor="#6a3fc4" />
            </linearGradient>
          </defs>
          {edges.map((e) => {
            const to = byId.get(e.to)!;
            const live = to.state === "running" || to.state === "you";
            const stroke = e.loop ? "url(#fl-loop)" : live ? "url(#fl-run)" : "url(#fl-flow)";
            const dash = e.loop ? "3 5" : to.state === "todo" ? "5 5" : undefined;
            const [x1, y1, x2, y2] = (e.d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
            const mid = e.label && x1 !== undefined ? { x: (x1 + (x2 ?? x1)) / 2, y: Math.min(y1, y2 ?? y1) - 6 } : null;
            return (
              <React.Fragment key={`${e.from}-${e.to}`}>
                <path d={e.d} fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray={dash} markerEnd={live ? "url(#fl-head-run)" : "url(#fl-head)"} />
                {mid && e.label ? (
                  <text x={mid.x} y={mid.y} fontSize="10" fill="#8f8c86" textAnchor="middle" fontFamily="Inter, Noto Sans SC, sans-serif">
                    {e.label}
                  </text>
                ) : null}
              </React.Fragment>
            );
          })}
        </svg>

        {/* ---- nodes ---- */}
        {nodes.map((n) => (
          <NodeCard key={n.id} talking={talk === n.id} onTalk={() => setTalk(talk === n.id ? null : n.id)} node={n} zh={zh} automation={n.automation ? auto.get(n.automation) : undefined} canEdit={canEdit} pending={pending} onToggle={(k, v) => save(k, { enabled: v })} />
        ))}

        {/* ---- a line to whoever owns the step, typed on the board ---- */}
        {talk
          ? (() => {
              const n = byId.get(talk);
              if (!n || n.owner === "loop") return null;
              const agent: AgentKey = n.owner === "you" ? (n.id === "approve" ? "script" : n.id === "review" ? "video" : "article") : n.owner;
              return (
                <div style={{ position: "absolute", left: Math.min(n.x, W - 330), top: n.y + 168, width: 320, zIndex: 20 }}>
                  <SayToAgent agent={agent} about={n.name} zh={zh} onDone={() => setTalk(null)} />
                </div>
              );
            })()
          : null}

        {/* ---- the line at the bottom ---- */}
        <div style={{ position: "absolute", left: 26, right: 26, bottom: 18, background: "#fff", border: "1px solid #e2e2e2", padding: "10px 16px", display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12.5, color: "#525252", flexGrow: 1 }}>
            {t("今天这条流程已经自动走了 ", "Today the flow has run ")}
            <b style={{ color: "#171717" }}>{doneCount} {t("步", "steps")}</b>
            {t("，你点了 ", " on its own; you nodded ")}
            <b style={{ color: "#171717" }}>{nodded} {t("次", "times")}</b>
            {t("。", ".")} {next ? t(`下一次需要你：${next.name}。`, `Next it needs you: ${next.name}.`) : t("现在没有需要你的地方。", "Nothing needs you right now.")}
          </span>
          <Link href="/home" style={{ fontSize: 12.5, color: "#525252", textDecoration: "none" }}>
            ← {t("回首页", "Home")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function NodeCard({ node: n, zh, automation, canEdit, pending, onToggle, talking, onTalk }: { talking: boolean; onTalk: () => void; node: Node; zh: boolean; automation?: AutomationRow; canEdit: boolean; pending: boolean; onToggle: (k: AutomationKey, v: boolean) => void }) {
  const t = (a: string, b: string) => (zh ? a : b);
  const dark = n.owner === "you";
  const loop = n.owner === "loop";
  const todo = n.state === "todo";
  const running = n.state === "running";
  const color = dark || loop ? "#171717" : AGENT_COLORS[n.owner as AgentKey];
  const off = automation ? !automation.value.enabled : false;

  const box: React.CSSProperties = loop
    ? { border: "1px dashed #0f5bd5", background: "#fff" }
    : dark
      ? todo
        ? { border: "1px dashed #d9d9d9", background: "#fbfbfb", color: "#999999" }
        : { background: "#171717", color: "#fff", opacity: n.state === "done" ? 0.55 : 1 }
      : running
        ? { border: "1px solid transparent", background: "linear-gradient(#fff, #fff) padding-box, linear-gradient(135deg, #278f5e, #0f5bd5) border-box" }
        : todo
          ? { border: "1px dashed #d9d9d9", background: "#fbfbfb", color: "#999999" }
          : { border: "1px solid #d9d9d9", background: "#fff" };
  const muted = todo && !loop;
  const inner = (
    <div style={{ position: "absolute", left: n.x, top: n.y, width: 236, boxSizing: "border-box", padding: "13px 14px", ...box, opacity: off ? 0.55 : box.opacity }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
        <span style={{ color: loop ? "#0f5bd5" : running ? color : dark && !todo ? "#b3b3b3" : muted ? "#b3b3b3" : "#999999", fontWeight: running || loop ? 500 : 400, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {running ? <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: color, marginRight: 5, verticalAlign: "1px", animation: "auraPulse 1.6s ease-in-out infinite" }} /> : null}
          {n.when}
        </span>
        <span style={{ flexGrow: 1 }} />
        {automation ? (
          <span onClick={(e) => e.preventDefault()} style={{ display: "inline-flex" }}>
            <Switch on={automation.value.enabled} disabled={!canEdit || pending} label={zh ? automation.name : automation.nameEn} dark={dark && !todo} onChange={(v) => onToggle(automation.key, v)} />
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
        {!dark && !loop ? <span style={{ opacity: todo ? 0.45 : 1, display: "flex" }}><AgentIcon agent={n.owner as AgentKey} size={22} radius={6} /></span> : null}
        <span style={{ fontSize: 13.5, fontWeight: 600, color: dark && !todo ? "#fff" : muted ? "#999999" : "#171717" }}>{n.name}</span>
      </div>
      <div style={{ fontSize: 12, color: dark && !todo ? "#b3b3b3" : muted ? "#b3b3b3" : "#525252", marginTop: 5, lineHeight: 1.5 }}>{n.what}</div>
      {n.buttons ? (
        <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          {n.buttons.map((b) => (
            <Link key={b.label} href={b.href} onClick={(e) => e.stopPropagation()} style={{ height: 28, padding: "0 12px", display: "inline-flex", alignItems: "center", border: `1px solid ${b.primary ? "#fff" : "#4a4a4a"}`, background: b.primary ? "#fff" : "transparent", color: b.primary ? "#171717" : "#fff", fontSize: 12, fontWeight: b.primary ? 500 : 400, textDecoration: "none" }}>
              {b.label}
            </Link>
          ))}
        </div>
      ) : n.chip && !todo ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 22, padding: "0 8px", marginTop: 8, border: "1px solid #e2e2e2", background: "#fafafa", fontSize: 11, color: "#525252", maxWidth: "100%" }}>
          <span style={{ width: 6, height: 6, border: "1px solid #999", boxSizing: "border-box", flexShrink: 0 }} />
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.chip}</span>
        </span>
      ) : null}
      {off ? <div style={{ fontSize: 11, color: "#a35f00", marginTop: 8 }}>{t("已关闭", "Off")}</div> : null}
      {!loop ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onTalk();
          }}
          aria-expanded={talking}
          style={{ marginTop: 9, height: 22, padding: "0 8px", border: `1px solid ${dark && !todo ? "#4a4a4a" : "#e2e2e2"}`, background: dark && !todo ? "transparent" : "#fafafa", color: dark && !todo ? "#d9d9d9" : "#525252", fontFamily: "inherit", fontSize: 11, cursor: "pointer", letterSpacing: "inherit" }}
        >
          {talking ? t("收起", "Close") : t("说一句", "Comment")}
        </button>
      ) : null}
    </div>
  );
  return n.href && !loop ? (
    <Link href={n.href} style={{ textDecoration: "none", color: "inherit" }}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

function Switch({ on, disabled, label, dark, onChange }: { on: boolean; disabled: boolean; label: string; dark?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onChange(!on);
      }}
      style={{ width: 30, height: 18, borderRadius: 999, border: 0, padding: 2, background: on ? "#278f5e" : dark ? "#4a4a4a" : "#d9d9d9", cursor: disabled ? "default" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: on ? "flex-end" : "flex-start", flexShrink: 0, opacity: disabled ? 0.7 : 1 }}
    >
      <span style={{ width: 14, height: 14, borderRadius: 7, background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }} />
    </button>
  );
}

const PAPER: React.CSSProperties = {
  backgroundColor: "#f4f3f0",
  backgroundImage: "radial-gradient(#d8d5cf 1px, transparent 1px)",
  backgroundSize: "22px 22px",
};
