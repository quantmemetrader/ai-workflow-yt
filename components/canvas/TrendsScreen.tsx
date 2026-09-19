"use client";

import * as React from "react";

/**
 * TrendsScreen — a transcription of design/canvas/Res-Trends.dc.html.
 *
 * Everything after the artboard's 52px rail: the Market Research sidebar
 * (Screens, Connected sources, the ranking-weights footer), the header bar, the
 * filter row with its Sources / Category / Region chips, the #01 hero with its
 * chart, the three decision cards, and the right-hand Watchlist panel. Markup,
 * nesting, class names, SVG paths, pixel values and colours are the artboard's;
 * only the content is lifted into props. The artboard is the source of truth —
 * when it changes, change this file with it, and do not "improve" anything here
 * that the artboard does not do.
 *
 * The artboard renders its pickers closed (`popSrc` / `popCat` default false),
 * so this is that default state; the Category picker opens because the screen
 * owns `onToggleCategory`, the Sources picker has no handler and stays a chip.
 */

export type TrendTopic = {
  id: string;
  name: string;
  category: string | null;
  summary: string | null;
  angles: string[];
  flagged: boolean;
  flagReason: string | null;
  heat: number;
  change: number; // fraction, e.g. 0.382 for +38.2%
  rising: boolean;
  status: "new" | "adopted" | "rejected" | "saved";
  points: { d: string; v: number }[]; // for the sparkline
  sourceKeys: string[];
  freshness: string | null; // ISO, when the numbers were last refreshed
  articles: { title: string; url: string; domain: string; at: string }[];
};

export type SourceStatus = {
  key: string;
  name: string;
  kind: string;
  status: "live" | "degraded" | "unconfigured";
  note: string | null;
};

/** The artboard's `accent` prop, at its default (#007BE0). */
const ACCENT = "#007be0";

/** zh-CN is the default locale (spec §4.1). */
const ZH: Record<string, string> = {
  "Trends dashboard": "趋势面板",
  "ranked topics · adopt feeds ranking weights": "按热度排名 · 采纳会反馈到排序",
  Sources: "来源",
  Category: "类别",
  Region: "地区",
  All: "全部",
  None: "无",
  Ranked: "排名于",
  "Why it's moving": "为什么在升温",
  "Suggested angles": "建议切入角度",
  Decision: "决定",
  "Adopt → backlog": "采纳 → 选题储备",
  Reject: "拒绝",
  "Save for later": "稍后再看",
  "Your decision re-weights future ranking.": "你的决定会影响之后的排序。",
  "heat score": "热度分",
  sources: "个来源",
  days: "天",
  Topic: "选题",
  Heat: "热度",
  Change: "变化",
  Watchlist: "关注列表",
  Agent: "助理",
  "Sensitive: carries a flag and a reason": "敏感：带有标记和原因",
  "Mentions / day": "每日提及量",
  source: "来源",
  "No angles yet": "还没有切入角度",
  "Ask your agent to suggest some from what it has read.": "可以让助理根据已读到的内容给出建议。",
  Cooling: "降温中",
  Rising: "升温中",
  "Why it’s moving": "为什么在升温",
  Adopted: "已采纳",
  Rejected: "已拒绝",
  Saved: "稍后再看",
  Sensitive: "敏感",
  "flagged, reason not recorded": "已标记，未记录原因",
  "Rank only these beats": "只排这些领域",
  Beats: "领域",
  topics: "个选题",
  Clear: "清除",
  Done: "完成",
  "no data for this topic yet": "这个选题还没有数据",
  "no range": "暂无区间",
  "No topics in these categories yet": "这些类别下还没有选题",
  d: "天",
};

/* --------------------------------------------------------------------- css */

/**
 * The artboard's own <style>, verbatim, minus the rail rules (.r — the rail is
 * not ours) and the html/body rules (the artboard is a 1440x900 frame, the
 * product fills the viewport). Every selector is scoped to [data-trends-screen]
 * (the two roots below) so these one-letter class names cannot collide with —
 * or be overridden by — the rest of the app, which defines its own .n / .lbl /
 * .btn. Source order is the artboard's, so the cascade inside is unchanged.
 */
const CSS = `
[data-trends-screen] { font-family: Inter, system-ui, sans-serif; font-weight: 420; letter-spacing: 0.02em; -webkit-font-smoothing: antialiased; color: #171717; }
[data-trends-screen] * { box-sizing: border-box; }
[data-trends-screen] a { color: #007be0; text-decoration: none; }
[data-trends-screen] img { display: block; }
[data-trends-screen] p { margin: 0; }

/* sidebar */
[data-trends-screen] .n { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 9px; border-radius: 8px; font-size: 12.5px; color: #525252; transition: background .16s ease; }
[data-trends-screen] .n.on { background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.1); color: #171717; font-weight: 500; }
[data-trends-screen] .n b { margin-left: auto; font-size: 10.5px; font-weight: 500; color: #999999; }
[data-trends-screen] .n i { margin-left: auto; font-style: normal; display: inline-flex; align-items: center; height: 17px; padding: 0 6px; border-radius: 9px; background: #ffe7e7; color: #e03636; font-size: 10px; font-weight: 500; }
[data-trends-screen] .lbl { font-size: 10.5px; font-weight: 500; color: #999999; padding: 0 9px; }

/* generic */
[data-trends-screen] .bar { height: 48px; flex-shrink: 0; border-bottom: 1px solid #ededed; display: flex; align-items: center; gap: 10px; padding: 0 20px; }
[data-trends-screen] .h1 { font-size: 14px; font-weight: 500; }
[data-trends-screen] .mut { font-size: 12px; color: #999999; }
[data-trends-screen] .btn { height: 30px; padding: 0 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; white-space: nowrap; }
[data-trends-screen] .btn.p { background: #007be0; color: #fff; font-weight: 500; }
[data-trends-screen] .btn.s { border: 1px solid #ededed; color: #525252; }
[data-trends-screen] .btn svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
[data-trends-screen] .chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border: 1px solid #ededed; border-radius: 8px; font-size: 12px; color: #4a5763; white-space: nowrap; }
[data-trends-screen] .chip svg { width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
[data-trends-screen] .bd { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 6px; font-size: 11px; font-weight: 500; white-space: nowrap; }
[data-trends-screen] .gray { background: #f3f3f3; color: #525252 }
[data-trends-screen] .blue { background: #e6f4ff; color: #007be0 }
[data-trends-screen] .grn  { background: #e4faeb; color: #278f5e }
[data-trends-screen] .amb  { background: #fff7d3; color: #db7706 }
[data-trends-screen] .red  { background: #ffe7e7; color: #e03636 }
[data-trends-screen] .card { border: 1px solid #ededed; border-radius: 12px; background: #fff; padding: 16px; }
[data-trends-screen] .av { width: 20px; height: 20px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }

[data-trends-screen] .wl { display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 12px; border-bottom: 1px solid #f3f3f3; }
[data-trends-screen] .wl { cursor: pointer; }
[data-trends-screen] .wl.on { background: #f5faff; box-shadow: inset 2px 0 0 var(--ac); }
[data-trends-screen] .wl .rk { width: 16px; font-size: 10.5px; color: #c7c7c7; font-variant-numeric: tabular-nums; flex-shrink: 0; }
[data-trends-screen] .wl .nm { flex-grow: 1; min-width: 0; font-size: 12.5px; color: #171717; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
[data-trends-screen] .wl .ht { width: 26px; text-align: right; font-size: 12.5px; font-weight: 500; font-variant-numeric: tabular-nums; flex-shrink: 0; }
[data-trends-screen] .wl .ch { width: 54px; text-align: right; font-size: 11.5px; font-variant-numeric: tabular-nums; flex-shrink: 0; }
[data-trends-screen] .up { color: #278f5e; } [data-trends-screen] .dn { color: #e03636; }
[data-trends-screen] .tf { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: #f3f3f3; }
[data-trends-screen] .tf div { height: 24px; padding: 0 10px; border-radius: 6px; display: flex; align-items: center; font-size: 11.5px; color: #7c7c7c; font-weight: 500; }
[data-trends-screen] .tf div.on { background: #fff; color: #171717; box-shadow: 0 1px 2px rgba(0,0,0,.1); }
[data-trends-screen] .rtab { height: 26px; padding: 0 11px; border-radius: 7px; display: flex; align-items: center; font-size: 12px; color: #7c7c7c; }
[data-trends-screen] .rtab { white-space: nowrap; }
[data-trends-screen] .rtab.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); color: #171717; font-weight: 500; }
[data-trends-screen] .cap { font-size: 11px; color: #999999; }
[data-trends-screen] .lwbox { position: relative; }
[data-trends-screen] .lwload { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #c7c7c7; }
[data-trends-screen] .src { display: flex; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f3f3f3; }
[data-trends-screen] .src:last-child { border-bottom: none; }
[data-trends-screen] .src b { font-size: 10.5px; font-weight: 500; color: #999999; width: 52px; flex-shrink: 0; padding-top: 1px; }
[data-trends-screen] .src span { font-size: 12.5px; line-height: 1.45; color: #383838; }
[data-trends-screen] .sw { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
[data-trends-screen] .wl .nmw { flex-grow: 1; min-width: 0; overflow: hidden; display: flex; flex-direction: column; gap: 1px; }
[data-trends-screen] .wl .nmw .nm { display: block; }
[data-trends-screen] .wl .wc { font-size: 10.5px; color: #a3a3a3; }
[data-trends-screen] .pkw { position: relative; }
[data-trends-screen] .pkv { color: #171717; font-weight: 500; margin-left: 5px; }
[data-trends-screen] .pkb { margin-left: 6px; min-width: 17px; height: 17px; padding: 0 5px; box-sizing: border-box; border-radius: 9px; background: var(--ac); color: #fff; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; }
[data-trends-screen] .chip.pkon { border-color: var(--ac); }
[data-trends-screen] .pkbg { position: fixed; inset: 0; z-index: 40; }
[data-trends-screen] .pkp { position: absolute; top: calc(100% + 6px); left: 0; z-index: 41; background: #fff; border: 1px solid #e2e2e2; border-radius: 12px; box-shadow: 0 12px 32px rgba(23,23,23,.14), 0 2px 6px rgba(23,23,23,.06); padding: 6px; }
[data-trends-screen] .pkh { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 8px 8px 6px; }
[data-trends-screen] .pkh b { font-size: 13px; font-weight: 500; } [data-trends-screen] .pkh span { font-size: 11.5px; color: #999999; font-variant-numeric: tabular-nums; }
[data-trends-screen] .pkq { display: flex; align-items: center; gap: 7px; height: 30px; margin: 2px 4px 4px; padding: 0 9px; border: 1px solid #ededed; border-radius: 8px; background: #f8f8f8; font-size: 12px; color: #999999; }
[data-trends-screen] .pkq svg { width: 13px; height: 13px; stroke: #999999; fill: none; stroke-width: 1.8; stroke-linecap: round; flex-shrink: 0; }
[data-trends-screen] .pkg { padding: 9px 8px 4px; font-size: 10.5px; font-weight: 500; color: #999999; letter-spacing: .04em; text-transform: uppercase; }
[data-trends-screen] .pk { display: flex; align-items: center; gap: 9px; height: 31px; padding: 0 8px; border-radius: 7px; font-size: 12.5px; color: #383838; }
[data-trends-screen] .pk:hover { background: #f5f5f5; }
[data-trends-screen] .pk .cb, [data-trends-screen] .ppk .cb { border: 1.5px solid #c7c7c7; box-sizing: border-box; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
[data-trends-screen] .pk .cb { width: 15px; height: 15px; border-radius: 4px; }
[data-trends-screen] .pk .cb svg, [data-trends-screen] .ppk .cb svg { stroke: #fff; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; opacity: 0; }
[data-trends-screen] .pk .cb svg { width: 11px; height: 11px; }
[data-trends-screen] .pk.on .cb, [data-trends-screen] .ppk.on .cb { background: var(--ac); border-color: var(--ac); } [data-trends-screen] .pk.on .cb svg, [data-trends-screen] .ppk.on .cb svg { opacity: 1; }
[data-trends-screen] .pk .n { flex-grow: 1; } [data-trends-screen] .pk .d { font-size: 11px; color: #a3a3a3; }
[data-trends-screen] .pkf { display: flex; align-items: center; gap: 14px; margin-top: 6px; padding: 9px 8px 5px; border-top: 1px solid #f0f0f0; font-size: 12px; color: #7c7c7c; }
[data-trends-screen] .pkf .pka { color: var(--ac); margin-left: auto; }
`;

/* ------------------------------------------------------------------ format */

/** "+38.2%" / "−6.7%" — the artboard's sign, U+2212 for a fall. */
function pct(change: number, locale: string): string {
  const n = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.abs(change) * 100);
  return `${change < 0 ? "−" : "+"}${n}%`;
}

/** "27 Aug" — the artboard's date, in the "Why it's moving" column. */
function shortDate(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(d);
}

/** "9 Sep 2026" — the closing end of the chart's range. */
function shortDateYear(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(d);
}

/** "09:15" — the artboard's "Ranked 09:15" stamp. */
function clock(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d);
}

function count(n: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(n);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------- chart */

/**
 * The watchlist sparkline, drawn from the topic's own points into the
 * artboard's 48x18 box (1px inset for the 1.5px stroke, matching the range the
 * artboard's hand-drawn paths used).
 */
function sparkline(points: { d: string; v: number }[]): string {
  const n = points.length;
  if (n === 0) return "";
  if (n === 1) return "1,9 47,9";
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.v < min) min = p.v;
    if (p.v > max) max = p.v;
  }
  const span = max - min;
  return points
    .map((p, i) => {
      const x = 1 + (i * 46) / (n - 1);
      const y = span === 0 ? 9 : 16 - ((p.v - min) / span) * 14;
      return `${round2(x)},${round2(y)}`;
    })
    .join(" ");
}

/**
 * The hero chart. The artboard drew this with lightweight-charts (an area
 * series over a volume histogram, 318px tall, scale margins .08 / .26); this
 * component may only import React, so the same area is drawn as an SVG from the
 * topic's points. The box, height, colours and scale margins are the
 * artboard's.
 */
const CH_W = 1000;
const CH_H = 318;
const CH_TOP = Math.round(CH_H * 0.08);
const CH_BOT = Math.round(CH_H * 0.74);

function chartPaths(points: { d: string; v: number }[]): { line: string; area: string } {
  const n = points.length;
  if (n === 0) return { line: "", area: "" };
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.v < min) min = p.v;
    if (p.v > max) max = p.v;
  }
  const span = max - min;
  const xy = points.map((p, i) => {
    const x = n === 1 ? CH_W / 2 : (i * CH_W) / (n - 1);
    const y = span === 0 ? (CH_TOP + CH_BOT) / 2 : CH_BOT - ((p.v - min) / span) * (CH_BOT - CH_TOP);
    return { x: round2(x), y: round2(y) };
  });
  const first = xy[0];
  const last = xy[xy.length - 1];
  const line = xy.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
  const area = `${line} L${last.x} ${CH_BOT} L${first.x} ${CH_BOT} Z`;
  return { line, area };
}

/* --------------------------------------------------------------- component */

export function TrendsScreen(props: {
  topics: TrendTopic[];
  sources: SourceStatus[];
  categories: { key: string; label: string }[];
  activeCategories: string[];
  region: string;
  locale: string;
  onToggleCategory: (key: string) => void;
  onDecide: (topicId: string, action: "adopt" | "reject" | "save") => void;
  /** Start watching a phrase. The studio picks its own beats; nothing is
   * watched until someone says so. */
  onAddTopic: (query: string) => void;
}): React.JSX.Element {
  const {
    topics,
    sources,
    categories,
    activeCategories,
    region,
    locale,
    onToggleCategory,
    onDecide,
    onAddTopic,
  } = props;

  const zhLocale = locale.startsWith("zh");
  const [newTopic, setNewTopic] = React.useState("");

  const watchField = (
    <input
      value={newTopic}
      onChange={(e) => setNewTopic(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && newTopic.trim()) {
          e.preventDefault();
          onAddTopic(newTopic.trim());
          setNewTopic("");
        }
      }}
      placeholder={zhLocale ? "关注一个新选题…" : "Watch a topic…"}
      style={{
        width: "100%",
        height: 28,
        border: "1px solid #ededed",
        borderRadius: 8,
        background: "#ffffff",
        padding: "0 9px",
        fontSize: 12,
        fontFamily: "inherit",
        letterSpacing: "inherit",
        color: "#171717",
        outline: "none",
      }}
    />
  );

  const zh = zhLocale;
  const t = (key: string) => (zh ? (ZH[key] ?? key) : key);

  /** The artboard's `pop` state: '' | 'cat'. 'src' has no handler to drive it. */
  const [popCat, setPopCat] = React.useState(false);
  /** Which watchlist row is open in the hero. */
  const [openId, setOpenId] = React.useState<string | null>(null);

  const sourceName = React.useCallback(
    (key: string): string => sources.find((s) => s.key === key)?.name ?? key,
    [sources],
  );

  /** A topic's category matches a filter by key or by the label it displays. */
  const inCategory = React.useCallback(
    (topic: TrendTopic, key: string): boolean => {
      if (topic.category === null) return false;
      if (topic.category === key) return true;
      const cat = categories.find((c) => c.key === key);
      return cat !== undefined && cat.label.toLowerCase() === topic.category.toLowerCase();
    },
    [categories],
  );

  const categoryLabel = React.useCallback(
    (topic: TrendTopic): string => {
      if (topic.category === null) return "";
      return categories.find((c) => c.key === topic.category)?.label ?? topic.category;
    },
    [categories],
  );

  const visible = React.useMemo(
    () =>
      activeCategories.length === 0
        ? topics
        : topics.filter((t) => activeCategories.some((k) => inCategory(t, k))),
    [topics, activeCategories, inCategory],
  );

  /* Opening a watchlist row shows that topic in the hero beside it. The
     artboard implied a /research/topic/:id screen; there is none, so a click
     used to land on a 404. */
  const selected =
    visible.find((x) => x.id === openId) ?? (visible.length > 0 ? visible[0] : null);

  const pickedSources = sources.map((s) => s.name);
  const srcNames =
    pickedSources.slice(0, 2).join(", ") + (pickedSources.length > 2 ? ` +${pickedSources.length - 2}` : "");

  const chart = selected !== null ? chartPaths(selected.points) : { line: "", area: "" };
  const firstPoint = selected !== null && selected.points.length > 0 ? selected.points[0] : null;
  const lastPoint =
    selected !== null && selected.points.length > 0 ? selected.points[selected.points.length - 1] : null;

  const frameStyle = { "--ac": ACCENT } as React.CSSProperties;

  return (
    <>
      <style>{CSS}</style>

      {/* The module sidebar is a shared component now: see ResearchSidebar. */}
      <div
        data-trends-screen=""
        style={{ ...frameStyle, flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0 }}
      >
        <div className="bar">
          <span className="h1">{t("Trends dashboard")}</span>
          <span className="mut">{t("ranked topics · adopt feeds ranking weights")}</span>
          {/* The artboard also drew a search box and a notification bell here.
              Neither had anything behind it — there is no topic search and no
              notification feed, so the bell's red dot claimed something was
              waiting when nothing was. Global search lives on the rail, at
              /search. */}
          <div style={{ flexGrow: 1 }} />
        </div>
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
              {/* Sources are configured for the studio, not chosen per view, so
                  this states what was read rather than wearing a chevron for a
                  picker that never opens. */}
              <div className="chip">
                {t("Sources")}
                <span className="pkv">{pickedSources.length > 0 ? srcNames : t("None")}</span>
              </div>
              <div className="pkw">
                <div
                  className={`chip${activeCategories.length > 0 ? " pkon" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => setPopCat((v) => !v)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setPopCat((v) => !v);
                    }
                  }}
                >
                  {t("Category")}
                  {activeCategories.length === 0 ? <span className="pkv">{t("All")}</span> : null}
                  {activeCategories.length > 0 ? <span className="pkb">{activeCategories.length}</span> : null}
                  <svg viewBox="0 0 24 24">
                    <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
                  </svg>
                </div>
                {popCat ? (
                  <>
                    <div className="pkbg" onClick={() => setPopCat(false)} />
                    <div className="pkp" style={{ width: 270 }}>
                      <div className="pkh">
                        <b>{t("Rank only these beats")}</b>
                      </div>
                      <div className="pkg">{t("Beats")}</div>
                      {categories.map((c) => {
                        const on = activeCategories.includes(c.key);
                        const n = topics.filter((t) => inCategory(t, c.key)).length;
                        return (
                          <div
                            className={`pk${on ? " on" : ""}`}
                            key={c.key}
                            role="button"
                            tabIndex={0}
                            onClick={() => onToggleCategory(c.key)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onToggleCategory(c.key);
                              }
                            }}
                          >
                            <span className="cb">
                              <svg viewBox="0 0 16 16">
                                <path d="M3.6 8.3 6.5 11.2 12.4 5.1" />
                              </svg>
                            </span>
                            <span className="n">{c.label}</span>
                            <span className="d">
                              {n} {t("topics")}
                            </span>
                          </div>
                        );
                      })}
                      <div className="pkf">
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            for (const k of [...activeCategories]) onToggleCategory(k);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              for (const k of [...activeCategories]) onToggleCategory(k);
                            }
                          }}
                        >
                          {t("Clear")}
                        </span>
                        <span className="pka" role="button" tabIndex={0} onClick={() => setPopCat(false)}>
                          {t("Done")}
                        </span>
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
              {/* Region is how the module is configured, not a picker on this
                  screen, so it carries no chevron. */}
              <div className="chip">
                {t("Region")}: {region}
              </div>
              <div style={{ flexGrow: 1 }} />
              {/* The artboard's 1W / 1M / 3M segmented control chose a window.
                  This dashboard ranks over the whole series the collector
                  holds, so the control had nothing to switch and is not drawn;
                  Search & compare has the real one. */}
              <span className="cap">
                {selected !== null && selected.freshness !== null
                  ? `${t("Ranked")} ${clock(selected.freshness, locale)}`
                  : ""}
              </span>
            </div>

            {topics.length === 0 ? (
              <div style={{ padding: "40px 20px", maxWidth: 460 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {zh ? "还没有关注任何选题" : "Nothing is being watched yet"}
                </div>
                <p className="mut" style={{ lineHeight: 1.55, marginTop: 6 }}>
                  {zh
                    ? "输入一个短语，助理会开始追踪它在新闻与科技社群里的热度，并把相关报道列出来。"
                    : "Name a phrase and the studio starts tracking how much it is being written about, with the articles behind it."}
                </p>
                <div style={{ marginTop: 12, maxWidth: 280 }}>{watchField}</div>
              </div>
            ) : selected !== null ? (
              <>
                <div
                  style={{
                    flexShrink: 0,
                    padding: "16px 20px 10px",
                    display: "flex",
                    alignItems: "flex-end",
                    gap: 18,
                  }}
                >
                  <div style={{ minWidth: 0, flexGrow: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "#c7c7c7", fontVariantNumeric: "tabular-nums" }}>
                        #01
                      </span>
                      <span className={`bd ${selected.rising ? "grn" : "gray"}`}>
                        {selected.rising ? t("Rising") : t("Cooling")}
                      </span>
                      <span className="bd gray">
                        {selected.sourceKeys.length} {t("sources")}
                      </span>
                      {selected.status !== "new" ? (
                        <span
                          className={`bd ${
                            selected.status === "adopted" ? "blue" : selected.status === "rejected" ? "red" : "amb"
                          }`}
                        >
                          {selected.status === "adopted"
                            ? t("Adopted")
                            : selected.status === "rejected"
                              ? t("Rejected")
                              : t("Saved")}
                        </span>
                      ) : null}
                      {selected.flagged ? (
                        <span className="bd amb" title={selected.flagReason ?? undefined}>
                          {t("Sensitive")}: {selected.flagReason ?? t("flagged, reason not recorded")}
                        </span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 19, fontWeight: 500, letterSpacing: "-0.01em", marginTop: 7 }}>
                      {selected.name}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, justifyContent: "flex-end" }}>
                      <span
                        style={{
                          fontSize: 30,
                          fontWeight: 500,
                          letterSpacing: "-0.02em",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {Math.round(selected.heat)}
                      </span>
                      <span
                        className={selected.change < 0 ? "dn" : "up"}
                        style={{ fontSize: 14, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}
                      >
                        {selected.change < 0 ? "▼" : "▲"} {pct(selected.change, locale)}
                      </span>
                    </div>
                    <div className="cap" style={{ marginTop: 3 }}>
                      {t("heat score")} · {count(selected.sourceKeys.length, locale)} {t("sources")} ·{" "}
                      {count(selected.points.length, locale)} {t("days")}
                    </div>
                  </div>
                </div>

                <div style={{ flexShrink: 0, padding: "0 20px" }}>
                  <div className="lwbox">
                    <div style={{ width: "100%", height: 318 }}>
                      {selected.points.length > 0 ? (
                        <svg
                          width="100%"
                          height={318}
                          viewBox={`0 0 ${CH_W} ${CH_H}`}
                          preserveAspectRatio="none"
                          style={{ display: "block" }}
                        >
                          <defs>
                            <linearGradient id="trends-area" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0" stopColor={`${ACCENT}38`} />
                              <stop offset="1" stopColor={`${ACCENT}02`} />
                            </linearGradient>
                          </defs>
                          {[0, 1, 2, 3].map((k) => {
                            const y = CH_TOP + (k * (CH_BOT - CH_TOP)) / 3;
                            return (
                              <line
                                key={k}
                                x1={0}
                                y1={y}
                                x2={CH_W}
                                y2={y}
                                stroke="#f3f3f3"
                                strokeWidth={1}
                                vectorEffect="non-scaling-stroke"
                              />
                            );
                          })}
                          <path d={chart.area} fill="url(#trends-area)" stroke="none" />
                          <path
                            d={chart.line}
                            fill="none"
                            stroke={ACCENT}
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke"
                          />
                          <line
                            x1={0}
                            y1={CH_H - 0.5}
                            x2={CH_W}
                            y2={CH_H - 0.5}
                            stroke="#ededed"
                            strokeWidth={1}
                            vectorEffect="non-scaling-stroke"
                          />
                        </svg>
                      ) : (
                        <div className="lwload">{t("no data for this topic yet")}</div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
                    <span className="cap" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="sw" style={{ background: ACCENT }} />
                      {t("Mentions / day")}
                    </span>
                    <div style={{ flexGrow: 1 }} />
                    <span className="cap">
                      {firstPoint !== null && lastPoint !== null
                        ? `${shortDate(firstPoint.d, locale)} – ${shortDateYear(lastPoint.d, locale)}`
                        : t("no range")}{" "}
                      · {t("source")}: {selected.sourceKeys.map(sourceName).join(", ") || t("None")}
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    flexGrow: 1,
                    minHeight: 0,
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1.35fr) minmax(0,1fr) 220px",
                    gap: 14,
                    padding: "16px 20px 18px",
                  }}
                >
                  <div className="card" style={{ padding: "13px 15px", overflow: "hidden" }}>
                    <div className="lbl" style={{ padding: 0, marginBottom: 4 }}>
                      {t("Why it’s moving")}
                    </div>
                    {selected.summary !== null ? (
                      <div className="cap" style={{ lineHeight: 1.45, marginBottom: 2 }}>
                        {selected.summary}
                      </div>
                    ) : null}
                    {selected.articles.map((a, i) => (
                      <div className="src" key={`${a.url}-${i}`}>
                        <b>{shortDate(a.at, locale)}</b>
                        <span>
                          <a href={a.url} target="_blank" rel="noreferrer">
                            {a.title}
                          </a>{" "}
                          <span style={{ color: "#999999" }}>{a.domain}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="card" style={{ padding: "13px 15px" }}>
                    <div className="lbl" style={{ padding: 0, marginBottom: 10 }}>
                      {t("Suggested angles")}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      {selected.angles.length === 0 ? (
                        // Angles are the studio's own editorial judgement; until
                        // someone (or their agent) writes them down, say so
                        // rather than leaving a blank card.
                        <div className="mut" style={{ lineHeight: 1.5 }}>
                          {t("No angles yet")}
                          {". "}
                          {t("Ask your agent to suggest some from what it has read.")}
                        </div>
                      ) : null}
                      {selected.angles.map((angle, i) => (
                        <div
                          key={`${angle}-${i}`}
                          style={{ padding: "8px 10px", borderRadius: 8, background: "#f8f8f8", fontSize: 12.5 }}
                        >
                          {angle}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="card" style={{ padding: "13px 15px", display: "flex", flexDirection: "column" }}>
                    <div className="lbl" style={{ padding: 0, marginBottom: 10 }}>
                      {t("Decision")}
                    </div>
                    <div
                      className="btn p"
                      style={{ justifyContent: "center", height: 34 }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected.status === "adopted"}
                      onClick={() => onDecide(selected.id, "adopt")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onDecide(selected.id, "adopt");
                        }
                      }}
                    >
                      {t("Adopt → backlog")}
                    </div>
                    <div
                      className="btn s"
                      style={{ justifyContent: "center", height: 34, marginTop: 7 }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected.status === "rejected"}
                      onClick={() => onDecide(selected.id, "reject")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onDecide(selected.id, "reject");
                        }
                      }}
                    >
                      {t("Reject")}
                    </div>
                    <div
                      className="btn s"
                      style={{ justifyContent: "center", height: 34, marginTop: 7 }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={selected.status === "saved"}
                      onClick={() => onDecide(selected.id, "save")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onDecide(selected.id, "save");
                        }
                      }}
                    >
                      {t("Save for later")}
                    </div>
                    <div className="cap" style={{ marginTop: "auto", lineHeight: 1.5 }}>
                      {t("Your decision re-weights future ranking.")}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div style={{ flexGrow: 1, minHeight: 0 }}>
                <div className="cap" style={{ padding: "28px 16px", textAlign: "center" }}>
                  {t("No topics in these categories yet")}
                </div>
              </div>
            )}
          </div>
          <div
            style={{
              width: 312,
              flexShrink: 0,
              borderLeft: "1px solid #ededed",
              background: "#fcfcfc",
              display: "flex",
              flexDirection: "column",
            }}
          >
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
              {/* The artboard paired this with an "Agent" tab that switched to
                  nothing. The agent is a screen of its own, reached from the
                  rail, so only the panel's own name is drawn. */}
              <div className="rtab on">{t("Watchlist")}</div>
              <div style={{ flexGrow: 1, padding: "0 8px" }}>{watchField}</div>
              <span className="cap">{region}</span>
            </div>

            {/* Column headings over an empty list are furniture, not
                information: they only appear once there is something to head. */}
            <div
              style={{
                flexShrink: 0,
                display: visible.length === 0 ? "none" : "flex",
                alignItems: "center",
                gap: 10,
                height: 30,
                padding: "0 12px",
                borderBottom: "1px solid #ededed",
                background: "#f8f8f8",
              }}
            >
              <span className="lbl" style={{ padding: 0, width: 16 }}>
                #
              </span>
              <span className="lbl" style={{ padding: 0, flexGrow: 1 }}>
                {t("Topic")}
              </span>
              <span className="lbl" style={{ padding: 0, width: 48 }}>
                {selected !== null ? `${selected.points.length} ${t("d")}` : "—"}
              </span>
              <span className="lbl" style={{ padding: 0, width: 26, textAlign: "right" }}>
                {t("Heat")}
              </span>
              <span className="lbl" style={{ padding: 0, width: 54, textAlign: "right" }}>
                {t("Change")}
              </span>
            </div>
            <div style={{ flexGrow: 1, minHeight: 0, overflow: "hidden" }}>
              {visible.map((topic, i) => (
                <div
                  className={`wl${selected !== null && topic.id === selected.id ? " on" : ""}`}
                  key={topic.id}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected !== null && topic.id === selected.id}
                  title={topic.flagged ? (topic.flagReason ?? undefined) : (topic.summary ?? undefined)}
                  onClick={() => setOpenId(topic.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenId(topic.id);
                    }
                  }}
                >
                  <span className="rk">{String(i + 1).padStart(2, "0")}</span>
                  <div className="nmw">
                    <span className="nm">
                      {topic.name}
                      {topic.flagged ? (
                        <span
                          style={{
                            display: "inline-block",
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            background: "#db7706",
                            verticalAlign: 1,
                            marginLeft: 3,
                          }}
                        />
                      ) : null}
                    </span>
                    {/* The reason is why the flag is actionable, but a
                        watchlist row is one line: it is clipped here and given
                        in full on hover, and in full beside the topic when the
                        row is opened. */}
                    <span
                      className="wc"
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {categoryLabel(topic)}
                      {topic.flagged ? (
                        <span style={{ color: "#db7706" }}>
                          {categoryLabel(topic) === "" ? "" : " · "}
                          {topic.flagReason ?? t("flagged, reason not recorded")}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <svg
                    viewBox="0 0 48 18"
                    style={{
                      width: 48,
                      height: 18,
                      flexShrink: 0,
                      fill: "none",
                      stroke: topic.change < 0 ? "#c7c7c7" : ACCENT,
                      strokeWidth: 1.5,
                      strokeLinecap: "round",
                      strokeLinejoin: "round",
                    }}
                  >
                    <polyline points={sparkline(topic.points)} />
                  </svg>
                  <span className="ht">{Math.round(topic.heat)}</span>
                  <span className={`ch ${topic.change < 0 ? "dn" : "up"}`}>{pct(topic.change, locale)}</span>
                </div>
              ))}
              {topics.length > 0 && visible.length === 0 ? (
                <div className="cap" style={{ padding: "28px 16px", textAlign: "center" }}>
                  {t("No topics in these categories yet")}
                </div>
              ) : null}
            </div>
            <div
              style={{
                flexShrink: 0,
                padding: "10px 12px",
                borderTop: "1px solid #ededed",
                display: "flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: 3, background: "#db7706" }} />
              <span className="cap">{t("Sensitive: carries a flag and a reason")}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
