"use client";

import { ModelPicker } from "@/components/shell/ModelPicker";

import * as React from "react";
import { useResizable } from "@/components/ui/Resizer";
import { PhrasePicker, type Suggestion } from "@/components/research/PhrasePicker";

/**
 * Search & compare, transcribed from design/canvas/Res-Compare.dc.html
 * (Market Research · "up to five series on one time axis").
 *
 * The markup, the nesting, the pixel values and the colours are the
 * artboard's; only the content is live. This file must stay in step with that
 * artboard — if the design changes, re-transcribe rather than re-interpret.
 *
 * Two differences the artboard cannot express, both deliberate:
 *   — the artboard draws its chart with TradingView Lightweight Charts loaded
 *     from a CDN. Here the chart is inline SVG drawn from `series[].points`,
 *     with the same layout the artboard configured (grid #f5f5f5 / #f3f3f3,
 *     axis borders #ededed, 11px #999999 labels, scale margins .08 / .06, the
 *     same per-series line widths, and the coloured end-of-line value label);
 *   — the artboard's "14 d change" column is labelled for the window actually
 *     being shown, because the window is a prop here and fixed there.
 */

export type Series = {
  query: string;
  colour: string; // assigned by the caller, in artboard order
  points: { d: string; v: number }[];
  articles: { title: string; url: string; domain: string; at: string }[];
  sourceKey: string;
  fetchedAt: string | null;
  pending: boolean; // queued for collection, no data yet
  error: string | null;
};

type Window = "1m" | "3m" | "6m";

const WINDOW_DAYS: Record<Window, number> = { "1m": 30, "3m": 90, "6m": 180 };
const WINDOW_LABEL: Record<Window, string> = { "1m": "1M", "3m": "3M", "6m": "6M" };
const WINDOW_WORDS: Record<Window, string> = { "1m": "1 month", "3m": "3 months", "6m": "6 months" };
const WINDOW_WORDS_ZH: Record<Window, string> = { "1m": "1 个月", "3m": "3 个月", "6m": "6 个月" };

/** The sources the studio reads, by the key `series_cache` stores. */
const SOURCE_NAMES: Record<string, string> = {
  gdelt: "GDELT",
  googlenews: "Google News",
  hackernews: "Hacker News",
  scmp: "SCMP",
  techcrunch: "TechCrunch",
  verge: "The Verge",
  coindesk: "CoinDesk",
  nikkei: "Nikkei Asia",
  bloomberg: "Bloomberg",
  reuters: "Reuters",
  youtube: "YouTube mostPopular",
  gtrends: "Google Trends",
};

/** zh-CN is the default locale (spec §4.1); English is the artboard's own. */
const ZH: Record<string, string> = {
  "Search & compare": "搜索与对比",
  "up to five series on one time axis": "最多五条序列，同一时间轴",
  Sources: "来源",
  Category: "类别",
  All: "全部",
  None: "无",
  Region: "地区",
  "Reads only the sources you pick": "只读取你选中的来源",
  "Export as report": "导出为报告",
  "Mention volume, indexed": "提及量（指数化）",
  "Day 1 = 100 for each series, so shape compares rather than absolute size":
    "每条序列第 1 天 = 100，比较的是走势而非绝对量",
  Series: "序列",
  "Peak / day": "单日峰值",
  "Avg / day": "日均",
  "d change": "天变化",
  "Corr. with #1": "与第一条的相关性",
  Agent: "助理",
  "Ask about these trends…": "询问这些趋势…",
  "Scoped to your entitled sources": "仅限你有权限的来源",
  "Nothing is being compared yet": "还没有可对比的序列",
  "Add a phrase above and the studio starts collecting how often it is written about.":
    "在上方添加一个短语，工作室就会开始收集它被报道的频率。",
};

/** Line weights, in the artboard's series order. */
const LINE_WIDTHS = [2.4, 1.8, 1.6, 1.6, 1.6];

const GRID = "minmax(0,1.5fr) 110px 100px 110px 150px minmax(0,1fr)";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ------------------------------------------------------------------ */
/* The artboard's own CSS, scoped — the same shape as [data-files-screen]
 * in app/canvas.css, so the Research classes cannot leak into the other
 * screens and the other screens cannot overwrite these.                */
/* ------------------------------------------------------------------ */
const CSS = `
[data-compare-screen] { font-family: Inter, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', 'Source Han Sans SC', system-ui, sans-serif; font-weight: 420; letter-spacing: 0.02em; -webkit-font-smoothing: antialiased; }
[data-compare-screen], [data-compare-screen] * { box-sizing: border-box; }
[data-compare-screen] p { margin: 0; }
[data-compare-screen] img { display: block; }
@keyframes rowIn { from { transform: translateY(7px); opacity: 0 } to { transform: none; opacity: 1 } }
[data-compare-screen] .tr { animation: rowIn .3s cubic-bezier(.32,.72,0,1) both; }
[data-compare-screen] .tr:nth-of-type(1){animation-delay:.01s} [data-compare-screen] .tr:nth-of-type(2){animation-delay:.035s}
[data-compare-screen] .tr:nth-of-type(3){animation-delay:.06s} [data-compare-screen] .tr:nth-of-type(4){animation-delay:.085s}
[data-compare-screen] .tr:nth-of-type(5){animation-delay:.11s} [data-compare-screen] .tr:nth-of-type(6){animation-delay:.135s}
[data-compare-screen] .tr:nth-of-type(7){animation-delay:.16s} [data-compare-screen] .tr:nth-of-type(8){animation-delay:.185s}
[data-compare-screen] .n { display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 9px; border-radius: 8px; font-size: 12.5px; color: #525252; transition: background .16s ease; }
[data-compare-screen] .n.on { background: #ffffff; box-shadow: 0 1px 2px rgba(0,0,0,0.1); color: #171717; font-weight: 500; }
[data-compare-screen] .n b { margin-left: auto; font-size: 11.5px; font-weight: 500; color: #999999; }
[data-compare-screen] .n i { margin-left: auto; font-style: normal; display: inline-flex; align-items: center; height: 17px; padding: 0 6px; border-radius: 9px; background: #ffe7e7; color: #e03636; font-size: 11px; font-weight: 500; }
[data-compare-screen] .lbl { font-size: 11.5px; font-weight: 500; color: #999999; padding: 0 9px; }
[data-compare-screen] .bar { height: 48px; flex-shrink: 0; border-bottom: 1px solid #ededed; display: flex; align-items: center; gap: 10px; padding: 0 20px; }
[data-compare-screen] .h1 { font-size: 15px; font-weight: 500; }
[data-compare-screen] .mut { font-size: 12.5px; color: #999999; }
[data-compare-screen] .btn { height: 30px; padding: 0 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; white-space: nowrap; }
[data-compare-screen] .btn.p { background: #007be0; color: #fff; font-weight: 500; }
[data-compare-screen] .btn.s { border: 1px solid #ededed; color: #525252; }
[data-compare-screen] .btn svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
[data-compare-screen] .chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border: 1px solid #ededed; border-radius: 8px; font-size: 12.5px; color: #4a5763; white-space: nowrap; }
[data-compare-screen] .chip svg { width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
[data-compare-screen] .av { width: 20px; height: 20px; border-radius: 10px; object-fit: cover; flex-shrink: 0; }
[data-compare-screen] .t { width: 100%; }
[data-compare-screen] .t .hd { height: 32px; border-bottom: 1px solid #ededed; display: grid; align-items: center; }
[data-compare-screen] .t .hd > * { font-size: 11.5px; font-weight: 500; color: #7c7c7c; padding: 0 12px; }
/* A floor, not a fixed height. The Sources cell wraps to three lines on a
   narrow window, and a fixed 46px meant those lines were drawn over the row
   beneath — "BBC" sitting on top of the next series' sources. */
[data-compare-screen] .tr { min-height: 46px; border-bottom: 1px solid #f3f3f3; display: grid; align-items: center; }
[data-compare-screen] .tr > * { font-size: 12.5px; color: #383838; padding: 0 12px; min-width: 0; display: flex; align-items: center; }
[data-compare-screen] .num { justify-content: flex-end; font-variant-numeric: tabular-nums; }
[data-compare-screen] .el { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
[data-compare-screen] .up { color: #278f5e; } [data-compare-screen] .dn { color: #e03636; }
[data-compare-screen] .tf { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: #f3f3f3; }
[data-compare-screen] .tf div { height: 24px; padding: 0 10px; border-radius: 6px; display: flex; align-items: center; font-size: 11.5px; color: #7c7c7c; font-weight: 500; }
[data-compare-screen] .tf div.on { background: #fff; color: #171717; box-shadow: 0 1px 2px rgba(0,0,0,.1); }
[data-compare-screen] .rtab { height: 26px; padding: 0 11px; border-radius: 7px; display: flex; align-items: center; font-size: 12.5px; color: #7c7c7c; }
[data-compare-screen] .rtab.on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.1); color: #171717; font-weight: 500; }
[data-compare-screen] .cap { font-size: 11.5px; color: #999999; }
[data-compare-screen] .lwbox { position: relative; }
[data-compare-screen] .lwload { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11.5px; color: #c7c7c7; }
[data-compare-screen] .sw { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
[data-compare-screen] .pkw { position: relative; }
[data-compare-screen] .pkv { color: #171717; font-weight: 500; margin-left: 5px; }
[data-compare-screen] .pkb { margin-left: 6px; min-width: 17px; height: 17px; padding: 0 5px; box-sizing: border-box; border-radius: 9px; background: var(--ac); color: #fff; font-size: 11.5px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; }
[data-compare-screen] .chip.pkon { border-color: var(--ac); }

/* Additions the product needs and a static artboard did not: pointers on the
 * things that are now really clickable, and a borderless input in the chip. */
[data-compare-screen] .tf div, [data-compare-screen] .btn, [data-compare-screen] .n { cursor: pointer; }
[data-compare-screen] .rtab { white-space: nowrap; }
[data-compare-screen] .btn { border: 0; }
[data-compare-screen] .chip svg[data-x] { cursor: pointer; }
[data-compare-screen] .addq { border: 0; outline: 0; background: transparent; font: inherit; letter-spacing: inherit; color: #171717; width: 142px; padding: 0; }
[data-compare-screen] .addq::placeholder { color: #999999; }
[data-compare-screen] [aria-disabled="true"] { opacity: .5; pointer-events: none; }
`;

/* ------------------------------------------------------------------ */
/* Arithmetic. Everything the table and the chart say is derived here.  */
/* ------------------------------------------------------------------ */

type Pt = { t: number; v: number };

/** "Day 1 = 100 for each series": index to 100 at the first non-zero point. */
function indexed(series: Series): Pt[] {
  const pts = series.points
    .map((p) => ({ t: Date.parse(`${p.d}T00:00:00Z`), v: p.v }))
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
    .sort((a, b) => a.t - b.t);
  const base = pts.find((p) => p.v > 0);
  if (!base) return [];
  return pts.map((p) => ({ t: p.t, v: Math.round((p.v / base.v) * 1000) / 10 }));
}

/** The app's own definition (lib/research/service.ts): first third vs last third. */
function changeOver(points: { d: string; v: number }[]): number {
  if (points.length < 6) return 0;
  const third = Math.max(1, Math.floor(points.length / 3));
  const avg = (xs: { v: number }[]) => xs.reduce((a, b) => a + b.v, 0) / xs.length;
  const start = avg(points.slice(0, third));
  if (!start) return avg(points.slice(-third)) > 0 ? 1 : 0;
  return (avg(points.slice(-third)) - start) / start;
}

/** Pearson r between two series, over the days they share. */
function correlation(a: Pt[], b: Pt[]): number {
  const other = new Map(b.map((p) => [p.t, p.v]));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of a) {
    const q = other.get(p.t);
    if (q !== undefined) {
      xs.push(p.v);
      ys.push(q);
    }
  }
  const n = xs.length;
  if (n < 3) return 0;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a1 = xs[i] - mx;
    const b1 = ys[i] - my;
    num += a1 * b1;
    dx += a1 * a1;
    dy += b1 * b1;
  }
  if (!dx || !dy) return 0;
  const r = num / Math.sqrt(dx * dy);
  return Math.max(-1, Math.min(1, r));
}

function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** The artboard's number shapes: 2,104 · 31.4 · 884 · 11.9 */
function fmtN(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v >= 100) return group(Math.round(v));
  if (v >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

function fmtPct(x: number): string {
  const pct = x * 100;
  const sign = pct < 0 ? "−" : "+";
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
}

function fmtDay(ms: number, zh: boolean): string {
  const d = new Date(ms);
  const day = d.getUTCDate();
  const mon = d.getUTCMonth();
  return zh ? `${mon + 1}月${day}日` : `${day} ${MONTHS[mon]}`;
}

function sourceName(key: string): string {
  return SOURCE_NAMES[key] ?? key;
}

function shortDomain(domain: string): string {
  return domain.replace(/^www\./, "");
}

/** Nice round tick values across a range. */
function ticksFor(min: number, max: number, want: number): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, want);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 0.001; v += step) {
    out.push(Math.round(v * 1000) / 1000);
  }
  return out;
}

/* ------------------------------------------------------------------ */

export function CompareScreen(props: {
  series: Series[];
  window: "1m" | "3m" | "6m";
  region: string;
  sourceCount: number;
  exporting: boolean;
  locale: string;
  /** The model actually answering, for the line under the panel composer. */
  model: string;
  onAddSeries: (query: string) => void;
  /**
   * Phrases worth offering: what is already watched, and what the region is
   * searching for. The box used to be empty and unhelped, so the only way to
   * compare a topic the studio already collects was to remember its exact
   * wording and type it again.
   */
  suggestions?: Suggestion[];
  onRemoveSeries: (query: string) => void;
  onWindowChange: (window: "1m" | "3m" | "6m") => void;
  onExport: () => void;
  /** Hands a question to the employee's agent. */
  onAsk: (prompt: string) => void;
  /** The conversation so far, in the agent panel. Asking used to navigate to
   * /chat, which took the chart away in order to discuss the chart. */
  thread?: React.ReactNode;
  /** A phrase is being queued. The screen says so, so nobody presses Enter
   * four times waiting for something to happen. */
  adding?: boolean;
}): React.JSX.Element {
  const zh = props.locale.startsWith("zh");
  const t = (key: string) => (zh ? (ZH[key] ?? key) : key);
  const collecting = zh ? "收集中" : "collecting";

  const [draft, setDraft] = React.useState("");
  // The agent column shares one stored width across every screen that
  // draws it, so narrowing it here does not leave it wide over there.
  const { width: agentWidth, handle: agentHandle } = useResizable("agent-panel", {
    min: 220, max: 620, initial: 272, edge: "left",
  });
  const [ask, setAsk] = React.useState("");
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const [boxW, setBoxW] = React.useState(824); // 1440 − 52 rail − 212 sidebar − 312 panel − 40 padding

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth || 824));
    ro.observe(el);
    setBoxW(el.clientWidth || 824);
    return () => ro.disconnect();
  }, []);

  const rows = React.useMemo(
    () =>
      props.series.map((s, i) => {
        const pts = indexed(s);
        const values = s.points.map((p) => p.v).filter((v) => Number.isFinite(v));
        const domains: string[] = [];
        for (const a of s.articles) {
          const d = shortDomain(a.domain);
          if (d && !domains.includes(d)) domains.push(d);
        }
        return {
          series: s,
          lineWidth: LINE_WIDTHS[Math.min(i, LINE_WIDTHS.length - 1)],
          pts,
          peak: values.length ? Math.max(...values) : 0,
          avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0,
          change: changeOver(s.points),
          domains,
        };
      }),
    [props.series],
  );

  const first = rows.length ? rows[0].pts : [];
  const drawable = rows.filter((r) => r.pts.length >= 2);

  const tMin = drawable.length ? Math.min(...drawable.map((r) => r.pts[0].t)) : 0;
  const tMax = drawable.length ? Math.max(...drawable.map((r) => r.pts[r.pts.length - 1].t)) : 0;
  const allValues = drawable.flatMap((r) => r.pts.map((p) => p.v));
  const vMin = allValues.length ? Math.min(...allValues) : 0;
  const vMax = allValues.length ? Math.max(...allValues) : 100;

  const sourceKeys: string[] = [];
  for (const s of props.series) if (s.sourceKey && !sourceKeys.includes(s.sourceKey)) sourceKeys.push(s.sourceKey);

  const chartCaption = drawable.length
    ? `${fmtDay(tMin, zh)} – ${fmtDay(tMax, zh)} ${new Date(tMax).getUTCFullYear()} · ${
        zh ? "来源" : "source"
      }: ${sourceKeys.map(sourceName).join(", ")}`
    : `${zh ? "暂无数据" : "no data yet"} · ${zh ? "来源" : "source"}: ${
        sourceKeys.length ? sourceKeys.map(sourceName).join(", ") : zh ? "等待中" : "pending"
      }`;

  const windowWords = zh ? WINDOW_WORDS_ZH[props.window] : WINDOW_WORDS[props.window];

  /* The agent's note, said from the data rather than from the artboard's demo. */
  const leader = rows.length
    ? rows.reduce((best, r) => (r.change > best.change ? r : best), rows[0])
    : null;
  const follower = rows
    .filter((r) => r !== leader && r.pts.length >= 2 && first.length >= 2)
    .map((r) => ({ r, corr: correlation(first, r.pts) }))
    .sort((a, b) => b.corr - a.corr)[0];
  const fading = rows.filter((r) => r !== leader && r.change < 0).sort((a, b) => a.change - b.change)[0];

  const q = (s: string) => (zh ? `「${s}」` : `“${s}”`);
  const agentNote = !leader
    ? zh
      ? "还没有可比较的序列。"
      : "Nothing to compare yet."
    : [
        zh
          ? `${q(leader.series.query)} 在这 ${windowWords} 内变动最大（${fmtPct(leader.change)}）。`
          : `${q(leader.series.query)} moved most over the ${windowWords} (${fmtPct(leader.change)}).`,
        follower && follower.corr > 0.5
          ? zh
            ? `${q(follower.r.series.query)} 与其同步，r = ${follower.corr.toFixed(2)}。`
            : `${q(follower.r.series.query)} tracks it at r = ${follower.corr.toFixed(2)}.`
          : "",
        fading
          ? zh
            ? `${q(fading.series.query)} 正在降温。`
            : `${q(fading.series.query)} is fading.`
          : "",
      ]
        .filter(Boolean)
        .join(" ");

  /* ---------------- chart geometry ---------------- */
  const CH = 316;
  const AXIS_W = 52;
  const TIME_H = 22;
  const plotW = Math.max(120, boxW - AXIS_W);
  const plotH = CH - TIME_H;
  const xRight = plotW - 10;
  const yTop = plotH * 0.08;
  const yBot = plotH * 0.94;

  const yTicks = ticksFor(vMin, vMax, 5);
  const tickStep = yTicks.length > 1 ? Math.abs(yTicks[1] - yTicks[0]) : 1;
  const tickDp = tickStep >= 10 ? 0 : 1;

  const x = (t: number) => (tMax > tMin ? ((t - tMin) / (tMax - tMin)) * xRight : xRight / 2);
  const y = (v: number) => (vMax > vMin ? yBot - ((v - vMin) / (vMax - vMin)) * (yBot - yTop) : (yBot + yTop) / 2);

  const xTickCount = Math.max(2, Math.min(7, Math.round(plotW / 130)));
  const xTicks: number[] = [];
  if (drawable.length && tMax > tMin) {
    for (let i = 0; i < xTickCount; i++) xTicks.push(tMin + ((tMax - tMin) * i) / (xTickCount - 1));
  }

  /* End-of-line value labels, nudged apart so five series stay readable. */
  const endLabels = drawable
    .map((r) => {
      const last = r.pts[r.pts.length - 1];
      return { colour: r.series.colour, value: last.v, y: y(last.v) };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) {
    if (endLabels[i].y - endLabels[i - 1].y < 17) endLabels[i].y = endLabels[i - 1].y + 17;
  }

  return (
    <div
      data-compare-screen=""
      style={{
        ["--ac" as string]: "#007be0",
        flexGrow: 1,
        display: "flex",
        background: "#ffffff",
        color: "#171717",
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      <style>{CSS}</style>

      {/* The module sidebar is a shared component now: see ResearchSidebar. */}
            <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        {/* The artboard also drew a search box and a notification bell here.
            Neither had anything behind it — there is no topic search and no
            notification feed — so they are not drawn: global search lives on
            the rail, at /search. */}
        <div className="bar">
          <span className="h1">{t("Search & compare")}</span>
          <span className="mut">{t("up to five series on one time axis")}</span>
          <div style={{ flexGrow: 1 }}></div>
        </div>

        <div style={{ flexGrow: 1, display: "flex", minHeight: 0 }}>
          <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div
              style={{
                flexShrink: 0,
                height: 46,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "0 20px",
                borderBottom: "1px solid #ededed",
              }}
            >
              {/* The artboard drew these three as pickers. None of them has a
                  picker behind it on this screen, so they carry the chevron no
                  longer: they state the scope this comparison actually ran in. */}
              <div className="chip">
                {t("Sources")}
                <span className="pkv">{props.sourceCount > 0 ? props.sourceCount : t("None")}</span>
              </div>
              <div className="chip">
                {t("Category")}
                <span className="pkv">{t("All")}</span>
              </div>
              <div className="chip">
                {t("Region")}: {props.region}
              </div>
              <div style={{ flexGrow: 1 }}></div>
              <span className="cap">{t("Reads only the sources you pick")}</span>
            </div>

            <div
              style={{
                flexShrink: 0,
                minHeight: 56,
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 20px",
                borderBottom: "1px solid #ededed",
                flexWrap: "wrap",
              }}
            >
              {props.series.map((s) => (
                <div
                  key={s.query}
                  className="chip"
                  style={{ background: "#fff" }}
                  title={s.error ?? undefined}
                >
                  <span className="sw" style={{ background: s.colour }}></span>
                  {s.query}
                  {s.pending ? (
                    <span className="cap" style={{ color: "#c7c7c7" }}>
                      {collecting}
                    </span>
                  ) : null}
                  <svg viewBox="0 0 24 24" data-x="" onClick={() => props.onRemoveSeries(s.query)}>
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </div>
              ))}
              <PhrasePicker
                value={draft}
                onChange={setDraft}
                onPick={(phrase) => {
                  if (props.adding || props.series.length >= 5) return;
                  props.onAddSeries(phrase);
                  setDraft("");
                }}
                suggestions={(props.suggestions ?? []).filter(
                  (s) => !props.series.some((x) => x.query.toLowerCase() === s.phrase.toLowerCase()),
                )}
                busy={props.adding}
                disabled={props.series.length >= 5}
                zh={zh}
                style={{ width: 250 }}
                placeholder={
                  props.adding
                    ? zh
                      ? "正在排队收集…"
                      : "queuing it…"
                    : props.series.length >= 5
                      ? zh
                        ? "已满 5 条"
                        : "five is the limit"
                      : zh
                        ? `添加序列 · ${props.series.length} / 5`
                        : `Add series · ${props.series.length} of 5`
                }
                emptyNote={
                  zh
                    ? "输入一个词开始收集它。"
                    : "Type a phrase and the studio starts collecting it."
                }
              />
              <div style={{ flexGrow: 1 }}></div>
              <div className="tf">
                {(["1m", "3m", "6m"] as const).map((w) => (
                  <div
                    key={w}
                    className={props.window === w ? "on" : undefined}
                    onClick={() => props.onWindowChange(w)}
                  >
                    {WINDOW_LABEL[w]}
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn s"
                disabled={props.exporting || props.series.length === 0}
                aria-disabled={props.exporting || props.series.length === 0}
                onClick={() => !props.exporting && props.onExport()}
                style={{ background: "transparent", fontFamily: "inherit", letterSpacing: "inherit" }}
              >
                {t("Export as report")}
              </button>
            </div>

            {/*
              * What the sources actually said.
              *
              * This was on the chip's `title` and nowhere else, so a source
              * that is rate-limiting us looked exactly like a phrase nobody
              * writes about: a thin chart and no explanation. A person cannot
              * act on a tooltip they do not know to hover.
              */}
            {props.series.some((s) => s.error) && (
              <div
                style={{
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  padding: "10px 20px",
                  borderBottom: "1px solid #ededed",
                  background: "#fffaf3",
                }}
              >
                {props.series
                  .filter((s) => s.error)
                  .map((s) => (
                    <div key={s.query} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      <span className="sw" style={{ background: s.colour, flexShrink: 0 }}></span>
                      <span style={{ fontSize: 12.5, color: "#5c4420", lineHeight: 1.55 }}>
                        <b style={{ fontWeight: 500 }}>{s.query}</b>
                        {" · "}
                        {s.error}
                      </span>
                    </div>
                  ))}
              </div>
            )}

            {props.series.length === 0 ? (
              /* Nothing is being compared: an empty axis would read as a chart
                 whose data failed, so say what to do instead. */
              <div style={{ padding: "40px 20px", maxWidth: 460 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{t("Nothing is being compared yet")}</div>
                <p className="mut" style={{ lineHeight: 1.55, marginTop: 6 }}>
                  {t("Add a phrase above and the studio starts collecting how often it is written about.")}
                </p>
              </div>
            ) : (
              <>
            <div style={{ flexShrink: 0, padding: "16px 20px 0" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
                <span style={{ fontSize: 15, fontWeight: 500 }}>{t("Mention volume, indexed")}</span>
                <span className="cap">
                  {t("Day 1 = 100 for each series, so shape compares rather than absolute size")}
                </span>
              </div>
              <div className="lwbox">
                <div ref={boxRef} style={{ width: "100%", height: 316 }}>
                  <svg
                    width={boxW}
                    height={CH}
                    viewBox={`0 0 ${boxW} ${CH}`}
                    style={{ display: "block", fontFamily: "Inter, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', 'Source Han Sans SC', system-ui, sans-serif" }}
                  >
                    {yTicks.map((v) => (
                      <line key={`h${v}`} x1={0} x2={plotW} y1={y(v)} y2={y(v)} stroke="#f3f3f3" strokeWidth={1} />
                    ))}
                    {xTicks.map((t, i) => (
                      <line key={`v${i}`} x1={x(t)} x2={x(t)} y1={0} y2={plotH} stroke="#f5f5f5" strokeWidth={1} />
                    ))}
                    <line x1={plotW + 0.5} x2={plotW + 0.5} y1={0} y2={plotH} stroke="#ededed" strokeWidth={1} />
                    <line x1={0} x2={boxW} y1={plotH + 0.5} y2={plotH + 0.5} stroke="#ededed" strokeWidth={1} />
                    {drawable.length
                      ? yTicks.map((v) => (
                          <text key={`hl${v}`} x={plotW + 8} y={y(v) + 4} fill="#999999" fontSize={11}>
                            {v.toFixed(tickDp)}
                          </text>
                        ))
                      : null}
                    {xTicks.map((t, i) => (
                      <text
                        key={`vl${i}`}
                        x={x(t)}
                        y={plotH + 15}
                        fill="#999999"
                        fontSize={11}
                        textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
                      >
                        {fmtDay(t, zh)}
                      </text>
                    ))}
                    {drawable.map((r) => (
                      <path
                        key={r.series.query}
                        d={r.pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(2)} ${y(p.v).toFixed(2)}`).join(" ")}
                        fill="none"
                        stroke={r.series.colour}
                        strokeWidth={r.lineWidth}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                    {endLabels.map((l, i) => (
                      <g key={`e${i}`}>
                        <rect x={plotW + 2} y={l.y - 8} width={AXIS_W - 4} height={16} rx={3} fill={l.colour} />
                        <text
                          x={plotW + AXIS_W / 2}
                          y={l.y + 4}
                          fill="#ffffff"
                          fontSize={11}
                          fontWeight={500}
                          textAnchor="middle"
                        >
                          {l.value.toFixed(1)}
                        </text>
                      </g>
                    ))}
                  </svg>
                </div>
                {drawable.length ? null : (
                  <div className="lwload">{props.series.some((s) => s.pending) ? `${collecting}…` : zh ? "暂无数据" : "no data yet"}</div>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 7 }}>
                <span className="cap">{chartCaption}</span>
              </div>
            </div>

            <div style={{ flexGrow: 1, minHeight: 0, padding: "14px 20px 18px" }}>
              <div className="t">
                <div className="hd" style={{ gridTemplateColumns: GRID }}>
                  <div>{t("Series")}</div>
                  <div className="num">{t("Peak / day")}</div>
                  <div className="num">{t("Avg / day")}</div>
                  <div className="num">
                    {WINDOW_DAYS[props.window]} {t("d change")}
                  </div>
                  <div className="num">{t("Corr. with #1")}</div>
                  <div>{t("Sources")}</div>
                </div>
                {rows.map((r, i) => {
                  const corr = i === 0 ? (r.pts.length ? 1 : 0) : correlation(first, r.pts);
                  const quiet = r.series.pending || !r.series.points.length;
                  return (
                    <div
                      key={r.series.query}
                      className="tr"
                      style={{ gridTemplateColumns: GRID }}
                      title={r.series.error ?? undefined}
                    >
                      <div style={{ gap: 9 }}>
                        <span className="sw" style={{ background: r.series.colour }}></span>
                        <span className="el">{r.series.query}</span>
                      </div>
                      {quiet ? (
                        <>
                          <div className="num" style={{ color: "#c7c7c7" }}>
                            {collecting}
                          </div>
                          <div className="num" style={{ color: "#c7c7c7" }}>
                            —
                          </div>
                          <div className="num" style={{ color: "#c7c7c7" }}>
                            —
                          </div>
                          <div className="num" style={{ gap: 8, color: "#c7c7c7" }}>
                            <div style={{ width: 60, height: 4, borderRadius: 2, background: "#ededed" }}>
                              <div style={{ width: "0%", height: 4, borderRadius: 2, background: "#c7c7c7" }}></div>
                            </div>
                            —
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="num">{fmtN(r.peak)}</div>
                          <div className="num">{fmtN(r.avg)}</div>
                          <div className={r.change < 0 ? "num dn" : "num up"}>{fmtPct(r.change)}</div>
                          <div className="num" style={{ gap: 8 }}>
                            <div style={{ width: 60, height: 4, borderRadius: 2, background: "#ededed" }}>
                              <div
                                style={{
                                  width: `${Math.round(Math.abs(corr) * 100)}%`,
                                  height: 4,
                                  borderRadius: 2,
                                  background: "#c7c7c7",
                                }}
                              ></div>
                            </div>
                            {corr.toFixed(2)}
                          </div>
                        </>
                      )}
                      {/* Two lines at most, and the rest on hover: a series
                          read from six places should not make its row three
                          times the height of its neighbours. */}
                      <div
                        style={{ color: "#7c7c7c", paddingTop: 9, paddingBottom: 9, alignItems: "flex-start" }}
                        title={[sourceName(r.series.sourceKey), ...r.domains].join(" · ")}
                      >
                        <span
                          style={{
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                            lineHeight: 1.35,
                          }}
                        >
                          {[sourceName(r.series.sourceKey), ...r.domains.slice(0, 2)].join(" · ")}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
              </>
            )}
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
                    stroke: "#007be0",
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
              <span className="cap">{props.region}</span>
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
                <span style={{ width: 6, height: 6, borderRadius: 3, background: "#007be0" }}></span>
                <span style={{ fontSize: 11.5, color: "#525252" }}>
                  {props.series.length} {zh ? "个序列" : "series"} · {windowWords}
                </span>
              </div>
            </div>
            {/* The artboard scripted a conversation here — a question nobody
                asked and a tool result nobody ran. What is left is the one
                thing this screen can say from its own numbers. */}
            {props.thread ?? (
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
                      props.onAsk(ask);
                      setAsk("");
                    }
                  }}
                  aria-label={t("Ask about these trends…")}
                  placeholder={t("Ask about these trends…")}
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
                  <ModelPicker current={props.model} zh={zh} />
                  <button
                    type="button"
                    aria-label={zh ? "发送" : "Send"}
                    onClick={() => {
                      if (ask.trim()) {
                        props.onAsk(ask);
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
                      background: "#007be0",
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
            {/* The artboard put a running cost here. Nothing on this screen has
                spent anything yet, so the figure would be invented; spend is
                shown against the real ledger in Settings. */}
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
              <span style={{ fontSize: 11.5, color: "#999999" }}>{t("Scoped to your entitled sources")}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
