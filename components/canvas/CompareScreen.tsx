"use client";

import { PlatformSearch } from "@/components/research/PlatformSearch";

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
/* "YouTube mostPopular" was the API's chart name, not something anybody calls
   it; in a narrow column it was also the thing that wrapped. */
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
  youtube: "YouTube",
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
  "Corr. with #1": "与首条相关",
  Agent: "助理",
  "Ask about these trends…": "询问这些趋势…",
  "Scoped to your entitled sources": "仅限你有权限的来源",
  "Nothing is being compared yet": "还没有可对比的序列",
  "Add a phrase above and the studio starts collecting how often it is written about.":
    "在上方添加一个短语，工作室就会开始收集它被报道的频率。",
};

/** Line weights, in the artboard's series order. */
const LINE_WIDTHS = [2.4, 1.8, 1.6, 1.6, 1.6];

/*
 * The table's columns.
 *
 * The four numeric columns were 110 / 100 / 110 / 150px — 470px of a column
 * that is ~570px wide at 1280 — so the series name came out as "c…" and the
 * sources were squeezed to a letter per line ("Yo / m…"). Even at 1440 the
 * sources cell wrapped "YouTube mostPopu…" onto two lines.
 *
 * Each numeric column is now its header's width plus padding (the headers set
 * the floor: "单日峰值", "90 天变化", "与首条相关"), 310px in all, and the name
 * and the sources share what is left. The sources cell is one line now — the
 * source and a "+N" for the article sites, with the full list on hover. The
 * English headers are a little longer, so they get a little more.
 *
 * The templates live in CSS (.t .hd / .t .tr, keyed on data-lang) so that a
 * container query can tighten them when the table itself is narrow — 1280,
 * or a wide agent panel: the correlation bar and the "+N" step aside there
 * and the number and the source name keep their room.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ------------------------------------------------------------------ */
/* The artboard's own CSS, scoped — the same shape as [data-files-screen]
 * in app/canvas.css, so the Research classes cannot leak into the other
 * screens and the other screens cannot overwrite these.                */
/* ------------------------------------------------------------------ */
const CSS = `
[data-compare-screen] { font-family: Inter, 'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Source Han Sans SC', system-ui, sans-serif; font-weight: 420; letter-spacing: 0.02em; -webkit-font-smoothing: antialiased; }
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

/* The scope chips (sources, category, region) state what this comparison ran
   over; none of them opens anything. Drawn as bordered chips they looked like
   three buttons that did nothing when pressed, so they are quiet tags now. */
[data-compare-screen] .chip.st { border-color: transparent; background: #f5f5f5; height: 26px; color: #7c7c7c; cursor: default; }
[data-compare-screen] .t .hd > * { white-space: nowrap; }
[data-compare-screen] .t .hd > *, [data-compare-screen] .tr > * { padding-left: 10px; padding-right: 10px; }
[data-compare-screen] .tw { container-type: inline-size; container-name: cmptable; }
[data-compare-screen] .t .hd, [data-compare-screen] .t .tr { grid-template-columns: minmax(110px,1.3fr) 70px 60px 80px 100px minmax(128px,1fr); }
[data-compare-screen][data-lang="en"] .t .hd, [data-compare-screen][data-lang="en"] .t .tr { grid-template-columns: minmax(110px,1.3fr) 80px 72px 88px 104px minmax(128px,1fr); }
@container cmptable (max-width: 600px) {
  [data-compare-screen] .t .hd, [data-compare-screen] .t .tr { grid-template-columns: minmax(110px,1.3fr) 70px 60px 80px 84px minmax(110px,1fr); }
  [data-compare-screen][data-lang="en"] .t .hd, [data-compare-screen][data-lang="en"] .t .tr { grid-template-columns: minmax(110px,1.3fr) 80px 72px 88px 92px minmax(110px,1fr); }
  [data-compare-screen] .t .hd > *, [data-compare-screen] .tr > * { padding-left: 8px; padding-right: 8px; }
  [data-compare-screen] .tr .cbar, [data-compare-screen] .tr .more { display: none; }
}
[data-compare-screen] .more { flex: none; display: inline-flex; align-items: center; height: 18px; padding: 0 5px; border-radius: 6px; background: #f3f3f3; color: #7c7c7c; font-size: 11px; font-variant-numeric: tabular-nums; }
[data-compare-screen] .tr:hover { background: #fafafa; }
/* The series name may take two lines rather than be cut to one letter. */
[data-compare-screen] .nm { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.35; overflow-wrap: anywhere; }
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

/* ------------------------------------------------------------------ */
/* What the sources said, in words a producer can act on.                */
/* ------------------------------------------------------------------ */

/**
 * `series.error` is written by the collector (lib/research/ingest.ts) for the
 * logs as much as for people: raw fetch errors joined with "; ", then a note
 * about which fallback drew the line — "fetch failed; no signal volume, chart
 * drawn from article counts". It was printed as-is, in English, in an amber
 * box, on a Chinese screen: it looked like the page had broken, when what it
 * meant was "one source was unreachable, so the line counts news articles".
 *
 * Each fragment is matched to a sentence here, in zh with the English beside
 * it, and split into two kinds, because they are different news:
 *   — `fallback`: the line is drawn from a different source than usual. Not a
 *     failure; worth knowing when reading the chart's shape.
 *   — `trouble`: a source did not answer this round. Temporary; the collector
 *     retries on its own, so there is nothing for anybody to do.
 * Anything unrecognised is still shown (a message is never swallowed), but as
 * a generic "a source returned an error" with the raw text on hover.
 */
type Explained = { kind: "fallback" | "trouble"; zh: string; en: string };

function explainPart(raw: string): Explained | null {
  const part = raw.trim();
  // The second half of GDELT's own message ("…this address; parked for ten
  // minutes" / "; next attempt after 09:52:10"), split off by the "; " join.
  if (/^(parked for|next attempt after)/i.test(part)) return null;
  const said = /^(.+?) (?:said|answered) (\d{3})/.exec(part);
  if (/no signal volume/i.test(part)) {
    return {
      kind: "fallback",
      zh: "这个词没有检索量数据，走势按新闻报道篇数绘制",
      en: "no search-volume signal for this phrase, so the line counts news articles",
    };
  }
  if (/chart drawn from article counts/i.test(part)) {
    return { kind: "fallback", zh: "走势按新闻报道篇数绘制", en: "the line counts news articles" };
  }
  if (/no fresh data this round/i.test(part)) {
    return { kind: "trouble", zh: "这一轮没取到新数据，显示的是上一次的结果", en: "no fresh data this round; showing the last good result" };
  }
  if (/GDELT is rate-limiting/i.test(part)) {
    return { kind: "trouble", zh: "GDELT 暂时限流，稍后会自动重试", en: "GDELT is briefly rate-limiting us and will be retried" };
  }
  if (/quota/i.test(part)) {
    return { kind: "trouble", zh: "YouTube 今日配额已用完，太平洋时间午夜重置", en: "YouTube's daily quota is used up; it resets at midnight Pacific" };
  }
  if (/fetch failed|could not be reached|timed? ?out|aborted|ECONN|ENOTFOUND|network/i.test(part)) {
    return { kind: "trouble", zh: "有一个来源暂时连不上，稍后会自动重试", en: "a source could not be reached and will be retried" };
  }
  if (said) {
    return {
      kind: "trouble",
      zh: `${said[1]} 暂时不可用（${said[2]}），稍后会自动重试`,
      en: `${said[1]} is unavailable for now (${said[2]}) and will be retried`,
    };
  }
  return { kind: "trouble", zh: "有一个来源返回了错误", en: "a source returned an error" };
}

/** A whole `series.error`, as de-duplicated sentences, trouble first. */
function explainError(raw: string): Explained[] {
  const out: Explained[] = [];
  for (const part of raw.split(/;\s*/)) {
    if (!part.trim()) continue;
    const e = explainPart(part);
    if (e && !out.some((o) => o.zh === e.zh)) out.push(e);
  }
  // "Fetch failed" and "the line counts articles" are cause and effect: say
  // the cause, then what it means for the chart.
  return out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "trouble" ? -1 : 1));
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
          explained: s.error ? explainError(s.error) : [],
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

  /** One series' notes as a sentence, in the reader's language. */
  const sentence = (list: Explained[]) =>
    list.length === 0 ? "" : zh ? `${list.map((e) => e.zh).join("；")}。` : `${list.map((e) => e.en).join("; ")}.`;

  /* Series whose sources said the same thing are said once, together: three
     series behind one rate-limited source is one note, not three. */
  const notes: { text: string; raw: string; trouble: boolean; series: Series[] }[] = [];
  for (const r of rows) {
    if (!r.explained.length) continue;
    const text = sentence(r.explained);
    const same = notes.find((n) => n.text === text);
    if (same) {
      same.series.push(r.series);
      same.raw = `${same.raw}\n${r.series.query}: ${r.series.error}`;
    } else {
      notes.push({
        text,
        raw: `${r.series.query}: ${r.series.error}`,
        trouble: r.explained.some((e) => e.kind === "trouble"),
        series: [r.series],
      });
    }
  }
  const noteFor = (query: string) => {
    const r = rows.find((x) => x.series.query === query);
    return r && r.explained.length ? sentence(r.explained) : undefined;
  };

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
      data-lang={zh ? "zh" : "en"}
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
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

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
              <div className="chip st">
                {t("Sources")}
                <span className="pkv">{props.sourceCount > 0 ? props.sourceCount : t("None")}</span>
              </div>
              <div className="chip st">
                {t("Category")}
                <span className="pkv">{t("All")}</span>
              </div>
              <div className="chip st">
                {t("Region")}
                <span className="pkv">{props.region}</span>
              </div>
              <div style={{ flexGrow: 1 }}></div>
              {/* One line or none: in a narrow column it stacked into a
                  four-line column of two characters each. */}
              <span className="cap el" style={{ minWidth: 0 }} title={t("Reads only the sources you pick")}>
                {t("Reads only the sources you pick")}
              </span>
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
                  title={noteFor(s.query)}
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
            {notes.length > 0 && (
              /*
               * Drawn as a quiet note rather than a warning: amber and raw
               * English made a fallback source look like a broken page. The
               * sentences are explainError's; the collector's own words stay
               * on hover for whoever is debugging a source.
               */
              <div
                role="note"
                style={{
                  flexShrink: 0,
                  display: "flex",
                  gap: 9,
                  alignItems: "flex-start",
                  padding: "8px 20px",
                  borderBottom: "1px solid #ececec",
                  background: "#f8fafd",
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden
                  style={{
                    width: 14,
                    height: 14,
                    marginTop: 2,
                    flexShrink: 0,
                    stroke: "#8a9bb0",
                    fill: "none",
                    strokeWidth: 1.8,
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                  }}
                >
                  <circle cx="12" cy="12" r="8.5" />
                  <path d="M12 11v5.2M12 7.8v.01" />
                </svg>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                  {notes.map((n) => (
                    <div
                      key={n.series.map((x) => x.query).join("|")}
                      title={n.raw}
                      style={{ fontSize: 12, color: "#5f6b7a", lineHeight: 1.55 }}
                    >
                      {n.series.map((x, k) => (
                        <span key={x.query} style={{ whiteSpace: "nowrap" }}>
                          {k > 0 ? (zh ? "、" : ", ") : null}
                          <span
                            className="sw"
                            style={{ background: x.colour, display: "inline-block", marginRight: 5, verticalAlign: "0" }}
                          ></span>
                          <span style={{ color: "#383838", fontWeight: 500 }}>{x.query}</span>
                        </span>
                      ))}
                      {zh ? "：" : ": "}
                      {n.text}
                    </div>
                  ))}
                </div>
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
              /*
               * The chart, the table and the per-platform list scroll as one.
               * Only the table's slot scrolled before, and at 1280×800 the
               * 316px chart above it left that slot ~190px tall: three rows,
               * and the per-platform section was never seen at all.
               */
              <div style={{ flexGrow: 1, minHeight: 0, overflowY: "auto" }}>
            <div style={{ padding: "16px 20px 0" }}>
              <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", columnGap: 10, rowGap: 2, marginBottom: 10 }}>
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
                    style={{ display: "block", fontFamily: "Inter, 'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Source Han Sans SC', system-ui, sans-serif" }}
                  >
                    {yTicks.map((v) => (
                      <line key={`h${v}`} x1={0} x2={plotW} y1={y(v)} y2={y(v)} stroke="#f3f3f3" strokeWidth={1} />
                    ))}
                    {xTicks.map((t, i) => (
                      <line key={`v${i}`} x1={x(t)} x2={x(t)} y1={0} y2={plotH} stroke="#f5f5f5" strokeWidth={1} />
                    ))}
                    <line x1={plotW + 0.5} x2={plotW + 0.5} y1={0} y2={plotH} stroke="#ededed" strokeWidth={1} />
                    <line x1={0} x2={boxW} y1={plotH + 0.5} y2={plotH + 0.5} stroke="#ededed" strokeWidth={1} />
                    {/* A tick label that an end-of-line value sits on is
                        skipped: the two were drawn on top of each other
                        ("50" showing through "53.3"). */}
                    {drawable.length
                      ? yTicks
                          .filter((v) => !endLabels.some((l) => Math.abs(l.y - y(v)) < 12))
                          .map((v) => (
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

            <div className="tw" style={{ padding: "14px 20px 20px" }}>
              <div className="t">
                <div className="hd">
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
                      title={noteFor(r.series.query)}
                    >
                      <div style={{ gap: 9, paddingTop: 7, paddingBottom: 7 }}>
                        <span className="sw" style={{ background: r.series.colour }}></span>
                        <span className="nm" title={r.series.query}>{r.series.query}</span>
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
                          <div className="num" style={{ gap: 7, color: "#c7c7c7" }}>
                            <div className="cbar" style={{ width: 36, height: 4, borderRadius: 2, background: "#ededed", flexShrink: 0 }}>
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
                          <div className="num" style={{ gap: 7 }}>
                            <div className="cbar" style={{ width: 36, height: 4, borderRadius: 2, background: "#ededed", flexShrink: 0 }}>
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
                      {/* One line: the source the line is drawn from, and how
                          many article sites stand behind it, with every one of
                          them on hover. It was the source and two domains
                          joined into a sentence, which wrapped — "YouTube
                          mostPopu… / Google News · …" — in any column narrower
                          than the sentence. */}
                      <div
                        style={{ color: "#7c7c7c", gap: 6 }}
                        title={[sourceName(r.series.sourceKey), ...r.domains].join(" · ")}
                      >
                        <span className="el">{sourceName(r.series.sourceKey)}</span>
                        {r.domains.length ? <span className="more">+{r.domains.length}</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              <PlatformSearch phrases={props.series.map((x) => x.query)} zh={zh} />
            </div>
              </div>
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
