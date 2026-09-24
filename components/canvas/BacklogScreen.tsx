"use client";

import { ModelPicker } from "@/components/shell/ModelPicker";

import * as React from "react";
import Link from "next/link";
import { useResizable } from "@/components/ui/Resizer";
import { AddTopicButton } from "./AddTopicButton";
import { StatusStrip } from "@/components/ui/kit";

/**
 * BacklogScreen — a transcription of design/canvas/Res-Backlog.dc.html.
 *
 * Everything after the artboard's 52px rail: the Market Research sidebar
 * (Screens, Connected sources, the ranking-weights footer), the header bar, the
 * filter row, the four-lane board and the right-hand Agent panel. Markup,
 * nesting, class names, SVG paths, pixel values and colours are the artboard's;
 * only the content is lifted into props. The artboard is the source of truth —
 * when it changes, change this file with it, and do not "improve" anything here
 * that the artboard does not do.
 *
 * Three things the artboard draws as text are editable here, because the screen
 * owns the assignment (rule: owner, target channel and due date change in
 * place): the owner name is a <select>, the grey channel badge is a <select>
 * with the same .bd .gray metrics, and the due date is a native date input laid
 * over the artboard's .cap text so the visible treatment is unchanged.
 *
 * Interaction the artboard implies but does not draw: a card is selectable
 * (the artboard's own .focus ring), "Send selected to Script" hands the
 * selected topic off, and a focused card takes Enter to hand off and
 * Delete/Backspace to drop out of the backlog. The artboard has no drop or
 * hand-off button of its own.
 */

export type BacklogItem = {
  id: string;
  name: string;
  category: string | null;
  summary: string | null;
  ownerName: string | null;
  ownerId: string | null;
  targetChannel: string | null;
  dueDate: string | null; // "2026-09-30" or null
  heat: number;
  change: number; // fraction, e.g. 0.382 for +38.2%
  adoptedAt: string | null; // ISO
  /** Which lane it sits in. */
  stage: Stage;
  flagged: boolean;
  flagReason: string | null;
};

export type Person = { id: string; name: string };

export type Stage = "adopted" | "briefing" | "scripting" | "handed";

/** The artboard's `accent` prop, at its default (#007BE0). */
const ACCENT = "#007be0";

/** A <select> wearing the artboard's chip text, chevron and all. */
const PICKER: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#171717",
  fontWeight: 500,
  fontFamily: "inherit",
  fontSize: "inherit",
  letterSpacing: "inherit",
  padding: 0,
  maxWidth: 140,
  cursor: "pointer",
};

/* --------------------------------------------------------------------- css */

/**
 * The artboard's own <style>, verbatim, minus the rail rules (.r — the rail is
 * not ours) and the html/body rules (the artboard is a 1440x900 frame, the
 * product fills the viewport). Every selector is scoped to [data-backlog-screen]
 * (the two roots below) so these one-letter class names cannot collide with —
 * or be overridden by — the rest of the app, which defines its own .n / .lbl /
 * .btn. Source order is the artboard's, so the cascade inside is unchanged.
 */
const CSS = `
[data-backlog-screen] { font-family: Inter, 'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Source Han Sans SC', system-ui, sans-serif; font-weight: 420; letter-spacing: 0.02em; -webkit-font-smoothing: antialiased; color: #171717; }
[data-backlog-screen] * { box-sizing: border-box; }
[data-backlog-screen] a { color: #007be0; text-decoration: none; }
[data-backlog-screen] img { display: block; }
[data-backlog-screen] p { margin: 0; }

/* sidebar */
[data-backlog-screen] .n { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 9px; border-radius: 8px; font-size: 12.5px; color: #525252; transition: background .16s ease; }
[data-backlog-screen] .n.on { background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.1); color: #171717; font-weight: 500; }
[data-backlog-screen] .n b { margin-left: auto; font-size: 11.5px; font-weight: 500; color: #999999; }
[data-backlog-screen] .n i { margin-left: auto; font-style: normal; display: inline-flex; align-items: center; height: 17px; padding: 0 6px; border-radius: 9px; background: #ffe7e7; color: #e03636; font-size: 11px; font-weight: 500; }
[data-backlog-screen] .lbl { font-size: 11.5px; font-weight: 500; color: #999999; padding: 0 9px; }

/* generic */
[data-backlog-screen] .bar { height: 48px; flex-shrink: 0; border-bottom: 1px solid #ededed; display: flex; align-items: center; gap: 10px; padding: 0 20px; }
[data-backlog-screen] .h1 { font-size: 15px; font-weight: 500; }
[data-backlog-screen] .mut { font-size: 12.5px; color: #999999; }
[data-backlog-screen] .btn { height: 30px; padding: 0 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; white-space: nowrap; }
[data-backlog-screen] .btn.p { background: #007be0; color: #fff; font-weight: 500; }
[data-backlog-screen] .btn.s { border: 1px solid #ededed; color: #525252; }
[data-backlog-screen] .btn svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
[data-backlog-screen] .chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border: 1px solid #ededed; border-radius: 8px; font-size: 12.5px; color: #4a5763; white-space: nowrap; }
[data-backlog-screen] .chip svg { width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
[data-backlog-screen] .bd { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 6px; font-size: 11.5px; font-weight: 500; white-space: nowrap; }
[data-backlog-screen] .gray { background: #f3f3f3; color: #525252 }
[data-backlog-screen] .blue { background: #e6f4ff; color: #007be0 }
[data-backlog-screen] .grn  { background: #e4faeb; color: #278f5e }
[data-backlog-screen] .amb  { background: #fff7d3; color: #db7706 }
[data-backlog-screen] .red  { background: #ffe7e7; color: #e03636 }
[data-backlog-screen] .card { border: 1px solid #ededed; border-radius: 12px; background: #fff; padding: 16px; }
[data-backlog-screen] .kv { display: flex; justify-content: space-between; gap: 14px; padding: 8px 0; border-bottom: 1px solid #f3f3f3; font-size: 12.5px; }
[data-backlog-screen] .kv span:first-child { color: #999999; }
[data-backlog-screen] .av { width: 20px; height: 20px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }
[data-backlog-screen] .stat { border: 1px solid #ededed; border-radius: 12px; padding: 13px 15px; background: #fff; }
[data-backlog-screen] .stat i { font-style: normal; display: block; font-size: 11.5px; font-weight: 500; color: #999999; }
[data-backlog-screen] .stat b { display: block; font-size: 22px; font-weight: 500; letter-spacing: -0.01em; margin-top: 6px; font-variant-numeric: tabular-nums; }

[data-backlog-screen] .num { justify-content: flex-end; font-variant-numeric: tabular-nums; }
[data-backlog-screen] .el { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
[data-backlog-screen] .body { flex-grow: 1; min-height: 0; padding: 18px 20px; overflow: hidden; }
[data-backlog-screen] .focus { box-shadow: 0 0 0 3px #EFF6FF; }

[data-backlog-screen] .up { color: #278f5e; } [data-backlog-screen] .dn { color: #e03636; }
[data-backlog-screen] .tf { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: #f3f3f3; }
[data-backlog-screen] .tf div { height: 24px; padding: 0 10px; border-radius: 6px; display: flex; align-items: center; font-size: 11.5px; color: #7c7c7c; font-weight: 500; }
[data-backlog-screen] .tf div.on { background: #fff; color: #171717; box-shadow: 0 1px 2px rgba(0,0,0,.1); }
[data-backlog-screen] .rtab { height: 26px; padding: 0 11px; border-radius: 7px; display: flex; align-items: center; font-size: 12.5px; color: #7c7c7c; }
[data-backlog-screen] .rtab.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); color: #171717; font-weight: 500; }
[data-backlog-screen] .cap { font-size: 11.5px; color: #999999; }
[data-backlog-screen] .sw { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }

/* the product needs a pointer on what it made clickable; the artboard is static */
[data-backlog-screen] .btn, [data-backlog-screen] .chip, [data-backlog-screen] .n { cursor: pointer; }
[data-backlog-screen] .rtab { white-space: nowrap; }
[data-backlog-screen] .btn { border: 0; font-family: inherit; letter-spacing: inherit; }
`;

/* ---------------------------------------------------------------- language */

/** zh-CN strings for the artboard's chrome; English is the artboard's own. */
const ZH: Record<string, string> = {
  "Market Research": "市场研究",
  Screens: "屏幕",
  "Trends dashboard": "趋势看板",
  "Search & compare": "搜索与对比",
  "Content performance": "内容表现",
  "Comment inbox": "评论收件箱",
  // 选题储备, as the sidebar's own nav row and the page title both call it.
  // This screen said 选题待办 for the same thing, so the label you press and the
  // heading you land on were two different words.
  "Topic backlog": "选题储备",
  "Connected sources": "已连接来源",
  "News sites": "新闻站点",
  "Ranking weights": "排序权重",
  "hands off directly to Script": "直接交接给脚本",
  Owner: "负责人",
  Channel: "渠道",
  Everyone: "全部",
  All: "全部",
  "Send selected to Script": "把所选发给脚本",
  Adopted: "已采纳",
  Briefing: "写简报",
  Scripting: "写脚本",
  "Handed to Video": "已交接给视频",
  "in Script": "在脚本模块",
  "read-only": "只读",
  "Nothing has been adopted yet.": "还没有采纳任何选题。",
  "Add a topic here, or adopt one on the Trends dashboard and it lands here, ready to plan.":
    "可以直接在这里添加选题，也可以在趋势看板采纳一个，它就会出现在这里，等待排期。",
  Unassigned: "未指派",
  "No channel": "未选渠道",
  "Set date": "设置日期",
  Agent: "助理",
  "Nothing is dated, so nothing can slip yet.": "还没有任何截止日期，暂时不会延期。",
  "Ask about the backlog…": "询问选题储备…",
  "Scoped to your entitled sources": "仅限你有权限的来源",
  "Go to the Trends dashboard": "前往趋势面板",
  "Due date": "截止日期",
  Flagged: "已标记",
};

/* ------------------------------------------------------------------ format */

/** "12 Sep" — the artboard's date on a card. */
function shortDate(iso: string, locale: string): string {
  const d = parseDay(iso);
  if (d === null) return iso;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(d);
}

/** "2026-09-30" (or an ISO stamp) as a local calendar day. */
function parseDay(iso: string): Date | null {
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole days from today to a due date; negative once it is late. */
function daysUntil(iso: string): number | null {
  const d = parseDay(iso);
  if (d === null) return null;
  return Math.round((startOfDay(d) - startOfDay(new Date())) / 86400000);
}

/** "+38.2%" / "−6.7%" — the sign the canvas uses, U+2212 for a fall. */
function pct(change: number, locale: string): string {
  const n = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.abs(change) * 100);
  return `${change < 0 ? "−" : "+"}${n}%`;
}

function count(n: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(n);
}

/** No avatar URL on BacklogItem, so the artboard's 20px circle carries initials. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/* --------------------------------------------------------------- component */

export function BacklogScreen(props: {
  items: BacklogItem[];
  people: Person[]; // for the owner picker
  channels: string[]; // e.g. ["YouTube", "Instagram", "TikTok", "WeChat"]
  locale: string;
  /** The regions this backlog is scoped to, as the module is configured. */
  region: string;
  /** The model actually answering, for the line under the panel composer. */
  model: string;
  onAssign: (
    topicId: string,
    patch: { ownerId?: string | null; targetChannel?: string | null; dueDate?: string | null },
  ) => void;
  onHandOff: (topicId: string) => void; // "hand off to Script"
  /** Moves a card to another lane. */
  onMoveStage: (topicId: string, stage: Stage) => void;
  onDrop: (topicId: string) => void; // back out of the backlog
  /** Hands a question to the employee's agent. */
  onAsk: (prompt: string) => void;
  /** The conversation so far, in the agent panel. */
  thread?: React.ReactNode;
}): React.JSX.Element {
  const { items, people, channels, locale, region, model, onAssign, onHandOff, onMoveStage, onDrop, onAsk, thread } =
    props;

  const zh = locale.startsWith("zh");
  const t = (key: string): string => (zh ? (ZH[key] ?? key) : key);
  const [ask, setAsk] = React.useState("");
  // The agent column shares one stored width across every screen that
  // draws it, so narrowing it here does not leave it wide over there.
  const { width: agentWidth, handle: agentHandle } = useResizable("agent-panel", {
    min: 220, max: 620, initial: 272, edge: "left",
  });

  /** The card the primary button acts on; the artboard's .focus ring marks it. */
  const [selected, setSelected] = React.useState<string | null>(null);

  /** The artboard drew these two as chips with a chevron and no picker behind
   * them. They are real filters here rather than decoration. */
  /* Dragging: which card is in the air, the lane it left, and the lane under
     the pointer. Three pieces rather than one because the card it left must
     not light up as a target, and a drop on its own lane must do nothing
     rather than write the same stage back to the database. */
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [dragStage, setDragStage] = React.useState<string | null>(null);
  const [overLane, setOverLane] = React.useState<string | null>(null);

  const [ownerFilter, setOwnerFilter] = React.useState("");
  const [channelFilter, setChannelFilter] = React.useState("");
  const shown = items.filter(
    (i) =>
      (ownerFilter === "" || i.ownerId === ownerFilter) &&
      (channelFilter === "" || i.targetChannel === channelFilter),
  );

  const selectedId = shown.some((i) => i.id === selected) ? selected : null;

  const dueThisWeek = shown.filter((i) => {
    if (i.dueDate === null) return false;
    const d = daysUntil(i.dueDate);
    return d !== null && d >= 0 && d <= 7;
  }).length;

  /** The artboard's "at risk of slipping" topic: the nearest due date. */
  const atRisk = items
    .filter((i) => i.dueDate !== null)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))[0];
  const atRiskDays = atRisk !== undefined && atRisk.dueDate !== null ? daysUntil(atRisk.dueDate) : null;

  const agentNote =
    atRisk === undefined || atRisk.dueDate === null || atRiskDays === null
      ? t("Nothing is dated, so nothing can slip yet.")
      : zh
        ? `${atRisk.name}将在 ${count(atRiskDays, locale)} 天后到期，但仍停留在“已采纳”，还没有简报。按从简报到锁定通常 3 天计算，除非今天开始写简报，否则会错过 ${shortDate(atRisk.dueDate, locale)}。`
        : `${atRisk.name} is due in ${count(atRiskDays, locale)} days and is still at Adopted, no brief yet. At the usual 3 days from brief to lock, it will miss ${shortDate(atRisk.dueDate, locale)} unless the brief starts today.`;

  /** The artboard's four lanes, filled from each topic's own stage. */
  const lanes: { key: Stage; name: string; note: string | null; rows: BacklogItem[] }[] = [
    { key: "adopted", name: t("Adopted"), note: null, rows: shown.filter((i) => i.stage === "adopted") },
    { key: "briefing", name: t("Briefing"), note: null, rows: shown.filter((i) => i.stage === "briefing") },
    { key: "scripting", name: t("Scripting"), note: t("in Script"), rows: shown.filter((i) => i.stage === "scripting") },
    { key: "handed", name: t("Handed to Video"), note: t("read-only"), rows: shown.filter((i) => i.stage === "handed") },
  ];

  const frameStyle = { "--ac": ACCENT } as React.CSSProperties;

  const STAGE_LABEL: Record<Stage, string> = {
    adopted: t("Adopted"),
    briefing: t("Briefing"),
    scripting: t("Scripting"),
    handed: t("Handed to Video"),
  };

  function cardClick(e: React.MouseEvent<HTMLDivElement>, id: string) {
    // the owner / channel / date controls own their own clicks
    if ((e.target as HTMLElement).closest("select, input") !== null) return;
    setSelected((cur) => (cur === id ? null : id));
  }

  function cardKeyDown(e: React.KeyboardEvent<HTMLDivElement>, id: string) {
    if (e.target !== e.currentTarget) return; // never from inside a control
    if (e.key === "Enter") {
      e.preventDefault();
      onHandOff(id);
    } else if (e.key === " ") {
      e.preventDefault();
      setSelected((cur) => (cur === id ? null : id));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onDrop(id);
    }
  }

  return (
    <>
      <style>{CSS}</style>

      {/* The module sidebar is a shared component now: see ResearchSidebar. */}
      <div
        data-backlog-screen=""
        style={{ ...frameStyle, flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}
      >
        {/* The artboard also drew a search box and a notification bell here.
            Neither had anything behind it — there is no topic search and no
            notification feed — so they are not drawn: global search lives on
            the rail, at /search. */}
        <div className="bar">
          <span className="h1">{t("Topic backlog")}</span>
          <span className="mut">{t("hands off directly to Script")}</span>
          <div style={{ flexGrow: 1 }}></div>
          {/* The board filled up two ways — adopt on Trends, or drag a card —
              and neither of them is "I have an idea, put it in". This is the
              third way, and it is on the screen the idea belongs to. */}
          <AddTopicButton zh={zh} className="btn s" />
        </div>

        {/* The four lanes as four numbers. The board below says the same thing
            in full, but only once you have scrolled all four columns; this is
            the shape of the pipeline before you read any of it. */}
        <StatusStrip
          items={lanes.map((lane) => ({
            label: lane.name,
            value: lane.rows.length,
            tone:
              lane.key === "adopted"
                ? ("waiting" as const)
                : lane.key === "handed"
                  ? ("done" as const)
                  : ("running" as const),
          }))}
          right={zh ? `${count(dueThisWeek, locale)} 个本周到期` : `${count(dueThisWeek, locale)} due this week`}
        />

        <div style={{ flexGrow: 1, display: "flex", minHeight: 0 }}>
          <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div
              style={{
                flexShrink: 0,
                height: 50,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "0 20px",
                borderBottom: "1px solid #ededed",
              }}
            >
              <div className="chip">
                {t("Owner")}
                <select
                  aria-label={t("Owner")}
                  value={ownerFilter}
                  onChange={(e) => setOwnerFilter(e.target.value)}
                  style={PICKER}
                >
                  <option value="">{t("Everyone")}</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="chip">
                {t("Channel")}
                <select
                  aria-label={t("Channel")}
                  value={channelFilter}
                  onChange={(e) => setChannelFilter(e.target.value)}
                  style={PICKER}
                >
                  <option value="">{t("All")}</option>
                  {channels.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ flexGrow: 1 }}></div>
              <span className="cap">
                {zh
                  ? `${count(shown.length, locale)} 个已采纳选题`
                  : `${count(shown.length, locale)} adopted topics`}
              </span>
              <button
                type="button"
                className="btn p"
                disabled={selectedId === null}
                aria-disabled={selectedId === null}
                style={{ opacity: selectedId === null ? 0.5 : 1 }}
                onClick={() => {
                  if (selectedId !== null) onHandOff(selectedId);
                }}
              >
                {t("Send selected to Script")}
              </button>
            </div>
            <div
              style={{
                flexGrow: 1,
                minHeight: 0,
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0,1fr))",
                gap: 12,
                padding: "16px 20px",
                overflow: "hidden",
              }}
            >
              {shown.length === 0 ? (
                <div style={{ gridColumn: "1 / -1", maxWidth: 460 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{t("Nothing has been adopted yet.")}</div>
                  {/* The empty state used to name one way in, and it was the
                      one on another screen. Both ways are here now, and the
                      one that works without leaving is first. */}
                  <p className="mut" style={{ lineHeight: 1.55, marginTop: 6 }}>
                    {t("Add a topic here, or adopt one on the Trends dashboard and it lands here, ready to plan.")}
                  </p>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <AddTopicButton zh={zh} className="btn p" />
                    <Link
                      href="/research"
                      className="btn s"
                      style={{ textDecoration: "none", border: "1px solid #ededed" }}
                    >
                      {t("Go to the Trends dashboard")}
                    </Link>
                  </div>
                </div>
              ) : (
                lanes.map((lane) => (
                  <div
                    key={lane.key}
                    /* A kanban board you cannot drag on is a list with
                       headings. The stage dropdown on each card stays — it is
                       the keyboard path and the one screen readers announce —
                       but the obvious gesture now works. */
                    onDragOver={(e) => {
                      if (dragging === null || dragStage === lane.key) return;
                      // Preventing the default is what marks this a valid drop
                      // target; without it the browser refuses the drop and
                      // the card springs back for no visible reason.
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (overLane !== lane.key) setOverLane(lane.key);
                    }}
                    onDragLeave={(e) => {
                      // Only when the pointer has actually left the lane, not
                      // when it crosses a card inside it.
                      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                      if (overLane === lane.key) setOverLane(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const id = dragging ?? e.dataTransfer.getData("text/plain");
                      setOverLane(null);
                      setDragging(null);
                      setDragStage(null);
                      if (id && lane.key !== dragStage) onMoveStage(id, lane.key as Stage);
                    }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      minWidth: 0,
                      background: overLane === lane.key ? "#f0f6ff" : "#f8f8f8",
                      borderRadius: 12,
                      padding: 10,
                      outline: overLane === lane.key ? `1.5px dashed ${ACCENT}` : "1.5px dashed transparent",
                      outlineOffset: -2,
                      transition: "background .12s linear",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "2px 4px 10px" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>{lane.name}</span>
                      <span className="cap">{count(lane.rows.length, locale)}</span>
                      {lane.note === null ? null : (
                        <span className="cap" style={{ marginLeft: "auto" }}>
                          {lane.note}
                        </span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {lane.rows.map((item) => {
                        const days = item.dueDate === null ? null : daysUntil(item.dueDate);
                        const dueSoon = days !== null && days <= 7;
                        const ownerKnown = people.some((p) => p.id === item.ownerId);
                        const channelKnown =
                          item.targetChannel !== null && channels.includes(item.targetChannel);
                        const on = selectedId === item.id;
                        return (
                          <div
                            key={item.id}
                            role="button"
                            tabIndex={0}
                            aria-pressed={on}
                            aria-keyshortcuts="Enter Delete"
                            onClick={(e) => cardClick(e, item.id)}
                            onKeyDown={(e) => cardKeyDown(e, item.id)}
                            data-stage={item.stage}
                            draggable={item.stage !== "handed"}
                            onDragStart={(e) => {
                              setDragging(item.id);
                              setDragStage(item.stage);
                              e.dataTransfer.effectAllowed = "move";
                              // Text too, so a card dragged into a notes app
                              // or another window arrives as something legible.
                              e.dataTransfer.setData("text/plain", item.id);
                            }}
                            onDragEnd={() => {
                              setDragging(null);
                              setDragStage(null);
                              setOverLane(null);
                            }}
                            style={{
                              border: "1px solid #ededed",
                              borderRadius: 11,
                              background: "#fff",
                              padding: 12,
                              opacity: dragging === item.id ? 0.45 : 1,
                              // the artboard's card shadow; .focus's ring rides in front of it
                              boxShadow: on
                                ? "0 0 0 3px #EFF6FF, 0 1px 1px rgba(5,5,6,.04)"
                                : "0 1px 1px rgba(5,5,6,.04)",
                              cursor: "pointer",
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <span
                                title={`${zh ? "热度" : "Heat"} ${count(item.heat, locale)} · ${pct(item.change, locale)}`}
                                style={{
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  color: ACCENT,
                                  fontVariantNumeric: "tabular-nums",
                                }}
                              >
                                {count(item.heat, locale)}
                              </span>
                              <select
                                className="bd gray"
                                aria-label={`${t("Channel")} — ${item.name}`}
                                value={item.targetChannel ?? ""}
                                onChange={(e) =>
                                  onAssign(item.id, {
                                    targetChannel: e.target.value === "" ? null : e.target.value,
                                  })
                                }
                                style={{
                                  border: "none",
                                  outlineOffset: 2,
                                  appearance: "none",
                                  WebkitAppearance: "none",
                                  fontFamily: "inherit",
                                  letterSpacing: "inherit",
                                  minWidth: 0,
                                  maxWidth: 110,
                                  textOverflow: "ellipsis",
                                  cursor: "pointer",
                                }}
                              >
                                <option value="">{t("No channel")}</option>
                                {item.targetChannel !== null && !channelKnown ? (
                                  <option value={item.targetChannel}>{item.targetChannel}</option>
                                ) : null}
                                {channels.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                              {dueSoon && item.dueDate !== null && days !== null ? (
                                <span className="bd red" style={{ marginLeft: "auto" }}>
                                  {days >= 0
                                    ? zh
                                      ? `${count(days, locale)} 天后到期`
                                      : `Due in ${count(days, locale)} d`
                                    : zh
                                      ? `已逾期 ${count(-days, locale)} 天`
                                      : `${count(-days, locale)} d late`}
                                </span>
                              ) : null}
                              {item.flagged ? (
                                <span
                                  className="bd amb"
                                  title={item.flagReason ?? t("Flagged")}
                                  style={{
                                    // a reason is longer than the artboard's one word,
                                    // so it truncates instead of pushing the card open
                                    marginLeft: dueSoon ? undefined : "auto",
                                    minWidth: 0,
                                    display: "block",
                                    lineHeight: "20px",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {item.flagReason ?? t("Flagged")}
                                </span>
                              ) : null}
                            </div>
                            <div
                              title={item.summary ?? undefined}
                              style={{
                                fontSize: 13,
                                fontWeight: 500,
                                lineHeight: 1.4,
                                marginTop: 8,
                                textWrap: "pretty",
                              }}
                            >
                              {item.name}
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7, rowGap: 4, marginTop: 11 }}>
                              <div
                                className="av"
                                title={item.ownerName ?? t("Unassigned")}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  background: "#f3f3f3",
                                  color: "#7c7c7c",
                                  fontSize: 9.5,
                                  fontWeight: 500,
                                  letterSpacing: 0,
                                }}
                              >
                                {item.ownerName === null ? "" : initials(item.ownerName)}
                              </div>
                              <select
                                aria-label={`${t("Stage")} — ${item.name}`}
                                value={item.stage}
                                onChange={(e) => onMoveStage(item.id, e.target.value as Stage)}
                                onClick={(e) => e.stopPropagation()}
                                className="bd gray"
                                style={{
                                  appearance: "none",
                                  border: 0,
                                  cursor: "pointer",
                                  fontFamily: "inherit",
                                  fontSize: 11.5,
                                  marginRight: 6,
                                }}
                              >
                                {(["adopted", "briefing", "scripting", "handed"] as Stage[]).map((st) => (
                                  <option key={st} value={st}>
                                    {STAGE_LABEL[st]}
                                  </option>
                                ))}
                              </select>
                              <select
                                aria-label={`${t("Owner")} — ${item.name}`}
                                value={item.ownerId ?? ""}
                                onChange={(e) =>
                                  onAssign(item.id, { ownerId: e.target.value === "" ? null : e.target.value })
                                }
                                style={{
                                  fontSize: 11.5,
                                  color: "#525252",
                                  minWidth: 0,
                                  flexGrow: 1,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                  height: 20,
                                  border: "none",
                                  background: "transparent",
                                  padding: 0,
                                  appearance: "none",
                                  WebkitAppearance: "none",
                                  fontFamily: "inherit",
                                  fontWeight: "inherit",
                                  letterSpacing: "inherit",
                                  cursor: "pointer",
                                }}
                              >
                                <option value="">
                                  {item.ownerId === null && item.ownerName !== null
                                    ? item.ownerName
                                    : t("Unassigned")}
                                </option>
                                {item.ownerId !== null && !ownerKnown ? (
                                  <option value={item.ownerId}>{item.ownerName ?? item.ownerId}</option>
                                ) : null}
                                {people.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                              </select>
                              {/* the artboard's .cap date, with a native date input over it */}
                              <span
                                style={{
                                  position: "relative",
                                  marginLeft: "auto",
                                  flexShrink: 0,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  /* The native date input underneath has a
                                     wide intrinsic size; clipped to the
                                     label, it stopped pushing past the card. */
                                  overflow: "hidden",
                                  maxWidth: "100%",
                                }}
                              >
                                <span className="cap" style={{ whiteSpace: "nowrap" }}>
                                  {item.dueDate === null ? t("Set date") : shortDate(item.dueDate, locale)}
                                </span>
                                <input
                                  type="date"
                                  aria-label={`${t("Due date")} — ${item.name}`}
                                  value={item.dueDate ?? ""}
                                  onChange={(e) =>
                                    onAssign(item.id, { dueDate: e.target.value === "" ? null : e.target.value })
                                  }
                                  style={{
                                    position: "absolute",
                                    inset: 0,
                                    width: "100%",
                                    height: "100%",
                                    opacity: 0,
                                    border: "none",
                                    padding: 0,
                                    margin: 0,
                                    background: "transparent",
                                    fontFamily: "inherit",
                                    fontSize: 11.5,
                                    cursor: "pointer",
                                  }}
                                />
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          <div
            style={{
              width: agentWidth,
              position: "relative",
              flexShrink: 0,
              borderLeft: "1px solid #ededed",
              background: "#fcfcfc",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {agentHandle}
            <div
              style={{
                height: 42,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                gap: 2,
                padding: "0 10px",
                borderBottom: "1px solid #ededed",
              }}
            >
              {/* The artboard paired this with a "Watchlist" tab. The watchlist
                  lives on the Trends dashboard, and a tab that switches to
                  nothing is worse than no tab, so only the panel's own name is
                  drawn. */}
              <div className="rtab on" style={{ gap: 6 }}>
                <svg
                  viewBox="0 0 24 24"
                  style={{
                    width: 12,
                    height: 12,
                    stroke: ACCENT,
                    fill: "none",
                    strokeWidth: 1.8,
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                  }}
                >
                  <path d="M12 4.2 19 8v8l-7 3.8L5 16V8z" />
                  <path d="M12 11.8 19 8M12 11.8v8M12 11.8 5 8" />
                </svg>
                {t("Agent")}
              </div>
              <div style={{ flexGrow: 1 }}></div>
              <span className="cap">{region}</span>
            </div>

            <div style={{ flexShrink: 0, padding: "11px 13px", borderBottom: "1px solid #f3f3f3" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  height: 25,
                  padding: "0 10px",
                  borderRadius: 7,
                  background: "#fff",
                  border: "1px solid #ededed",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: 3, background: ACCENT }}></span>
                <span style={{ fontSize: 11.5, color: "#525252" }}>
                  {zh
                    ? `${count(shown.length, locale)} 个选题 · ${count(lanes.length, locale)} 个阶段`
                    : `${count(shown.length, locale)} topics · ${count(lanes.length, locale)} stages`}
                </span>
              </div>
            </div>
            {/* The artboard scripted a conversation here — a question nobody
                asked, a tool result nobody ran ("0.5 s"), and a "Start the
                brief" / "Not now" pair wired to nothing. What is left is the
                one thing this screen can say from its own dates. */}
            {thread ?? (
              <div style={{ flexGrow: 1, minHeight: 0, padding: "14px 13px 0", overflow: "hidden" }}>
                <p style={{ fontSize: 12, lineHeight: 1.6, color: "#383838", textWrap: "pretty" }}>{agentNote}</p>
              </div>
            )}
            <div style={{ flexShrink: 0, padding: "11px 13px 9px" }}>
              <div style={{ border: "1px solid #e2e2e2", borderRadius: 10, background: "#fff", padding: "9px 10px 7px" }}>
                <input
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && ask.trim()) {
                      e.preventDefault();
                      onAsk(ask);
                      setAsk("");
                    }
                  }}
                  aria-label={t("Ask about the backlog…")}
                  placeholder={t("Ask about the backlog…")}
                  style={{
                    width: "100%",
                    border: 0,
                    outline: "none",
                    background: "transparent",
                    fontSize: 12,
                    fontFamily: "inherit",
                    letterSpacing: "inherit",
                    color: "#171717",
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 11 }}>
                  <ModelPicker current={model} zh={zh} />
                  <button
                    type="button"
                    aria-label={zh ? "发送" : "Send"}
                    onClick={() => {
                      if (ask.trim()) {
                        onAsk(ask);
                        setAsk("");
                      }
                    }}
                    style={{
                      width: 25,
                      height: 25,
                      borderRadius: 7,
                      border: 0,
                      padding: 0,
                      cursor: "pointer",
                      background: ACCENT,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      style={{
                        width: 12,
                        height: 12,
                        stroke: "#fff",
                        fill: "none",
                        strokeWidth: 2.3,
                        strokeLinecap: "round",
                        strokeLinejoin: "round",
                      }}
                    >
                      <path d="M12 19V5.5M6 11.5 12 5.5l6 6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
            <div
              style={{
                flexShrink: 0,
                borderTop: "1px solid #f3f3f3",
                padding: "9px 13px 11px",
                display: "flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              {/* The artboard put a running cost here. Nothing on this screen
                  has spent anything, so the figure would be invented; spend is
                  shown against the real ledger in Settings. */}
              <span style={{ fontSize: 11.5, color: "#999999" }}>{t("Scoped to your entitled sources")}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
