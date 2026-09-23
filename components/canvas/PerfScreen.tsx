"use client";

import * as React from "react";
import { ResearchAgentPanel } from "./ResearchAgentPanel";
import type { ChannelRow, PerformanceRow, Window } from "@/lib/social/service";

/**
 * Content performance, transcribed from design/canvas/Res-Perf.dc.html
 * (Market Research · "loads without a chat prompt · last 28 days").
 *
 * The markup, the nesting, the class names, the pixel values and the colours
 * are the artboard's; only the content is live. Keep this file in step with
 * that artboard — re-transcribe when the design changes, do not re-interpret.
 *
 * Differences the artboard cannot express, all deliberate:
 *   — the artboard drew its chart with TradingView Lightweight Charts from a
 *     CDN. Here it is inline SVG drawn from `series`, with the artboard's own
 *     layout (grid #f5f5f5 / #f3f3f3, axis borders #ededed, 11px #999999
 *     labels, the accent area over the accent line);
 *   — the artboard's chips ("Channel: All ▾", "Last 28 days ▾", "Campaign ▾")
 *     are the real window control and the real platform filter here, so the
 *     window is the `.tf` segmented control the artboard's other Research
 *     screens use and the platform chips carry a pressed state instead of a
 *     chevron into a picker that does not exist;
 *   — the artboard's per-stat "vs previous 28 d" deltas are not drawn: nothing
 *     on this screen knows the previous period, and inventing the comparison
 *     is the one thing a performance screen must never do;
 *   — every metric in `PerformanceRow` is nullable because several platforms
 *     simply do not report it. A metric that was not reported renders as a
 *     muted "—", never as 0, and never as 0%.
 *
 * The window is a prop, never state: the caller owns it and the spec's default
 * (28d) is the caller's to set — this screen does not fight it.
 */

/** The artboard's `accent` prop, at its default (#007BE0). */
const ACCENT = "#007be0";

/** zh-CN is the default locale (spec §4.1); English is the artboard's own. */
const ZH: Record<string, string> = {
  "Content performance": "内容表现",
  Views: "播放量",
  "Views in window": "窗口期播放量",
  "Lifetime views": "累计播放量",
  Likes: "点赞",
  Comments: "评论",
  "Engagement rate": "互动率",
  Posts: "贴文",
  "Daily views": "每日播放量",
  "across every post in the window": "窗口内所有贴文合计",
  "By channel": "按渠道",
  views: "播放量",
  Post: "贴文",
  Channel: "渠道",
  Published: "发布时间",
  "Watch-thru": "完播率",
  Engage: "互动",
  All: "全部",
  "Check now": "立即更新",
  Checking: "更新中",
  via: "来自",
  "not enough data yet": "数据还不够",
  "not reported by this platform": "该平台不提供这项数据",
  "never checked": "尚未更新",
  "No channel is connected yet": "还没有连接任何渠道",
  "Connect a YouTube, Instagram or LinkedIn account and this screen fills with your own posts and their numbers.":
    "连接 YouTube、Instagram 或领英账号后，这个页面会显示你自己的贴文和数据。",
  "No posts in this window": "此时段没有贴文",
  "Nothing was published in this period. Try a longer window, or check for new posts now.":
    "这个时段内没有发布过内容。可以换成更长的时段，或者立即检查有没有新贴文。",
  "Show 90 days": "查看 90 天",
};

/** The platforms the studio publishes to, written the way each one writes
 * itself. An unknown platform appears as itself rather than as a crash —
 * `channels.platform` is free text (lib/db/schema/social.ts). */
const PLATFORM_NAMES: Record<string, string> = {
  youtube: "YouTube",
  youtube_shorts: "YouTube Shorts",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
  twitter: "X",
  tiktok: "TikTok",
  facebook: "Facebook",
  threads: "Threads",
  wechat: "WeChat OA",
  weibo: "Weibo",
  bilibili: "Bilibili",
  xiaohongshu: "Xiaohongshu",
  douyin: "Douyin",
  kuaishou: "Kuaishou",
};

const WINDOW_DAYS: Record<Window, number> = { "7d": 7, "28d": 28, "90d": 90 };
const WINDOW_LABEL: Record<Window, string> = { "7d": "7d", "28d": "28d", "90d": "90d" };
const WINDOW_LABEL_ZH: Record<Window, string> = { "7d": "7 天", "28d": "28 天", "90d": "90 天" };

/** The post table's grid, in the artboard's shape: one flexible title column
 * and fixed numeric columns. */
/*
 * The post's title is what a person actually reads down this table; the rest
 * are numbers with known widths. It had `minmax(0,1fr)` while sitting beside a
 * 210px "By channel" block, so on anything but a very wide window the titles
 * came out as "亚芳对话…" and the table was unreadable.
 *
 * A floor of 260px on the title, and the numeric columns give up a few pixels
 * each. They are numbers: they do not need the room.
 */
const GRID = "minmax(260px,1fr) 78px 78px 70px 62px 72px 74px 66px";

/* ------------------------------------------------------------------ */
/* The artboard's own <style>, minus the rail and sidebar rules (neither
 * is ours) and minus the html/body rules (the artboard is a 1440x900
 * frame, the product fills the viewport). Every selector is scoped to
 * [data-perf-screen] so these one-letter class names cannot collide with
 * — or be overridden by — the rest of the app. Source order is the
 * artboard's, so the cascade inside is unchanged.                      */
/* ------------------------------------------------------------------ */
const CSS = `
[data-perf-screen] { font-family: Inter, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', 'Source Han Sans SC', system-ui, sans-serif; font-weight: 420; letter-spacing: 0.02em; -webkit-font-smoothing: antialiased; }
[data-perf-screen], [data-perf-screen] * { box-sizing: border-box; }
[data-perf-screen] a { color: #007be0; text-decoration: none; }
[data-perf-screen] img { display: block; }
[data-perf-screen] p { margin: 0; }

@keyframes rowIn { from { transform: translateY(7px); opacity: 0 } to { transform: none; opacity: 1 } }
[data-perf-screen] .tr { animation: rowIn .3s cubic-bezier(.32,.72,0,1) both; }
[data-perf-screen] .tr:nth-of-type(1){animation-delay:.01s} [data-perf-screen] .tr:nth-of-type(2){animation-delay:.035s}
[data-perf-screen] .tr:nth-of-type(3){animation-delay:.06s} [data-perf-screen] .tr:nth-of-type(4){animation-delay:.085s}
[data-perf-screen] .tr:nth-of-type(5){animation-delay:.11s} [data-perf-screen] .tr:nth-of-type(6){animation-delay:.135s}
[data-perf-screen] .tr:nth-of-type(7){animation-delay:.16s} [data-perf-screen] .tr:nth-of-type(8){animation-delay:.185s}

[data-perf-screen] .lbl { font-size: 10.5px; font-weight: 500; color: #999999; padding: 0 9px; }
[data-perf-screen] .bar { height: 48px; flex-shrink: 0; border-bottom: 1px solid #ededed; display: flex; align-items: center; gap: 10px; padding: 0 20px; }
[data-perf-screen] .h1 { font-size: 14px; font-weight: 500; }
[data-perf-screen] .mut { font-size: 12px; color: #999999; }
[data-perf-screen] .btn { height: 30px; padding: 0 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; white-space: nowrap; }
[data-perf-screen] .btn.p { background: #007be0; color: #fff; font-weight: 500; }
[data-perf-screen] .btn.s { border: 1px solid #ededed; color: #525252; }
[data-perf-screen] .btn svg { width: 13px; height: 13px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
[data-perf-screen] .chip { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; border: 1px solid #ededed; border-radius: 8px; font-size: 12px; color: #4a5763; white-space: nowrap; }
[data-perf-screen] .chip svg { width: 10px; height: 10px; stroke: #999999; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
[data-perf-screen] .bd { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 6px; font-size: 11px; font-weight: 500; white-space: nowrap; }
[data-perf-screen] .gray { background: #f3f3f3; color: #525252 }
[data-perf-screen] .stat { border: 1px solid #ededed; border-radius: 12px; padding: 13px 14px; background: #fff; min-width: 0; }
/* Six of these share the row now, so the label is allowed two lines and the
   number shrinks with the column rather than pushing a tile wider than its
   share. */
[data-perf-screen] .stat i { font-style: normal; display: block; font-size: 10.5px; font-weight: 500; color: #999999; line-height: 1.35; }
[data-perf-screen] .stat b { display: block; font-size: clamp(16px, 1.45vw, 22px); font-weight: 500; letter-spacing: -0.01em; margin-top: 6px; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

[data-perf-screen] .t { width: 100%; }
[data-perf-screen] .t .hd { height: 32px; border-bottom: 1px solid #ededed; display: grid; align-items: center; }
[data-perf-screen] .t .hd > * { font-size: 10.5px; font-weight: 500; color: #7c7c7c; padding: 0 12px; }
[data-perf-screen] .tr { height: 46px; border-bottom: 1px solid #f3f3f3; display: grid; align-items: center; }
[data-perf-screen] .tr > * { font-size: 12.5px; color: #383838; padding: 0 12px; min-width: 0; display: flex; align-items: center; }
[data-perf-screen] .num { justify-content: flex-end; font-variant-numeric: tabular-nums; }
[data-perf-screen] .el { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
[data-perf-screen] .up { color: #278f5e; } [data-perf-screen] .dn { color: #e03636; }
[data-perf-screen] .tf { display: flex; gap: 2px; padding: 2px; border-radius: 8px; background: #f3f3f3; }
[data-perf-screen] .tf div { height: 24px; padding: 0 10px; border-radius: 6px; display: flex; align-items: center; font-size: 11.5px; color: #7c7c7c; font-weight: 500; }
[data-perf-screen] .tf div.on { background: #fff; color: #171717; box-shadow: 0 1px 2px rgba(0,0,0,.1); }
[data-perf-screen] .cap { font-size: 11px; color: #999999; }
[data-perf-screen] .lwbox { position: relative; }
[data-perf-screen] .lwload { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #c7c7c7; }
[data-perf-screen] .sw { width: 9px; height: 9px; border-radius: 3px; flex-shrink: 0; }
[data-perf-screen] .pkv { color: #171717; font-weight: 500; margin-left: 5px; }
[data-perf-screen] .chip.pkon { border-color: var(--ac); color: #171717; font-weight: 500; }

/* Additions the product needs and a static artboard did not: buttons that look
 * like the artboard's divs, right-aligned numeric headers (the artboard's
 * .hd > * are grid items, so its .num rule never reached them), and a disabled
 * state for the one button that can be in flight. */
[data-perf-screen] button { font-family: inherit; letter-spacing: inherit; background: transparent; }
[data-perf-screen] .t .hd > * { display: flex; align-items: center; }
[data-perf-screen] .t .hd button { border: 0; padding: 0; color: inherit; font-size: inherit; font-weight: inherit; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
[data-perf-screen] .btn, [data-perf-screen] .chip, [data-perf-screen] .tf div { cursor: pointer; }
[data-perf-screen] .btn { border: 0; }
[data-perf-screen] .btn.s { border: 1px solid #ededed; }
[data-perf-screen] [aria-disabled="true"] { opacity: .5; pointer-events: none; }
`;

/* ------------------------------------------------------------------ */
/* Format. Nothing here invents a number: a metric that is null stays   */
/* null all the way to the muted dash the cell renders.                 */
/* ------------------------------------------------------------------ */

/** Intl wants a real tag; the app's "en" means en-GB (lib/i18n.ts). */
function tag(locale: string): string {
  return locale === "en" ? "en-GB" : locale;
}

/** "45.3K" — the headline shape. The exact figure rides along in `title`. */
function compact(n: number, locale: string): string {
  return new Intl.NumberFormat(tag(locale), { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** "1,284,300" — the full figure, for `title` and for the channel bars. */
function full(n: number, locale: string): string {
  return new Intl.NumberFormat(tag(locale)).format(n);
}

/** A 0..1 fraction as the artboard's "41.2%". */
function pct1(x: number, locale: string): string {
  return `${new Intl.NumberFormat(tag(locale), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(x * 100)}%`;
}

/** "22 Aug" — the chart's and the header's date shape. */
function day(d: Date, locale: string): string {
  return new Intl.DateTimeFormat(tag(locale), { day: "numeric", month: "short" }).format(d);
}

/** "3 天前" / "3d ago", in lib/i18n.ts's words so the app says it one way.
 * `now` is read here rather than in the component body, which keeps render
 * pure (react-hooks/purity) and matches the other canvas screens. */
function timeAgo(d: Date, locale: string, now: number = Date.now()): string {
  const zh = locale.startsWith("zh");
  const secs = Math.round((now - d.getTime()) / 1000);
  if (secs < 60) return zh ? "刚刚" : "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return zh ? `${mins} 分钟前` : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return zh ? `${hours} 小时前` : `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return zh ? `${days} 天前` : `${days}d ago`;
  return new Intl.DateTimeFormat(tag(locale), { day: "numeric", month: "short", year: "numeric" }).format(d);
}

/** The days the window covers, computed the way the query computed them
 * (lib/social/service.ts windowStart): the last N days, today included. */
function windowRange(w: Window): { start: Date; end: Date } {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (WINDOW_DAYS[w] - 1));
  return { start, end };
}

function platformName(key: string): string {
  return PLATFORM_NAMES[key] ?? (key.charAt(0).toUpperCase() + key.slice(1));
}

/** Nice round tick values across a range — the same helper CompareScreen uses. */
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

export type PerfScreenProps = {
  locale: string;
  rows: PerformanceRow[];
  totals: {
    posts: number;
    /** Lifetime views of the posts published in this window. */
    views: number;
    /** Views gained *during* the window, across every post however old. */
    viewsInWindow: number;
    likes: number;
    comments: number;
    engagementRate: number | null; // 0..1, averaged over posts that report it
  };
  /** total views per day across the window */
  series: { d: string; v: number }[];
  window: Window;
  /** null = all platforms */
  platform: string | null;
  channels: ChannelRow[];
  syncedAt: Date | null;
  sort: { key: "views" | "likes" | "comments" | "engagementRate" | "publishedAt"; dir: "asc" | "desc" };
  pending: boolean;

  onWindow: (w: Window) => void;
  onPlatform: (platform: string | null) => void;
  onSort: (key: PerfScreenProps["sort"]["key"]) => void;
  onSyncNow: () => void;
  /** The model the right-hand panel names under its composer. */
  model: string;
  /** Hands a question to the agent on /chat, where it can cite the files the
   * asker is allowed to read. */
  onAsk: (prompt: string) => void;
  /** The conversation so far, rendered in the agent panel. */
  thread?: React.ReactNode;
  /** Controls above the composer: history, a new thread. */
  tools?: React.ReactNode;
};

type SortKey = PerfScreenProps["sort"]["key"];

/** The row value a sort key reads. Null stays null: it sorts last either way,
 * because "not reported" is not "worst". */
function sortValue(row: PerformanceRow, key: SortKey): number | null {
  if (key === "publishedAt") return row.publishedAt === null ? null : row.publishedAt.getTime();
  return row[key];
}

export function PerfScreen(props: PerfScreenProps): React.JSX.Element {
  const { locale, rows, totals, series, window: win, platform, channels, syncedAt, sort, pending, model, onAsk, thread, tools } = props;
  const zh = locale.startsWith("zh");
  const t = (key: string) => (zh ? (ZH[key] ?? key) : key);

  const boxRef = React.useRef<HTMLDivElement | null>(null);
  // 1440 − 52 rail − 212 sidebar − 40 padding − 210 channel column − 16 gap
  const [boxW, setBoxW] = React.useState(910);

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth || 910));
    ro.observe(el);
    setBoxW(el.clientWidth || 910);
    return () => ro.disconnect();
  }, []);

  /* --------------------------------------------------- what is on screen */

  /** The window this screen is actually showing. Stated in the header because
   * a chart that does not say its range is a chart nobody can check
   * (spec §4.3). */
  const range = React.useMemo(() => windowRange(win), [win]);

  /** The platforms behind the numbers, from the connected channels. */
  const platforms = React.useMemo(() => {
    const seen: string[] = [];
    for (const c of channels) if (!seen.includes(c.platform)) seen.push(c.platform);
    return seen;
  }, [channels]);

  const sourceLine = platforms.map(platformName).join(", ");

  const freshness = syncedAt === null ? t("never checked") : timeAgo(syncedAt, locale);

  const sorted = React.useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const x = sortValue(a, sort.key);
      const y = sortValue(b, sort.key);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return sort.dir === "asc" ? x - y : y - x;
    });
    return out;
  }, [rows, sort]);

  /** Views per platform, summed from the rows that report views. A platform
   * whose posts report no views at all is not drawn as a zero bar. */
  const byPlatform = React.useMemo(() => {
    const totalsByKey = new Map<string, number>();
    for (const r of rows) {
      if (r.views === null) continue;
      totalsByKey.set(r.platform, (totalsByKey.get(r.platform) ?? 0) + r.views);
    }
    return [...totalsByKey.entries()]
      .map(([key, views]) => ({ key, views }))
      .sort((a, b) => b.views - a.views);
  }, [rows]);

  const topPlatformViews = byPlatform.length > 0 ? byPlatform[0].views : 0;

  /* ------------------------------------------------------------- chart */

  const points = React.useMemo(
    () =>
      series
        .map((p) => ({ t: Date.parse(`${p.d}T00:00:00Z`), v: p.v }))
        .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v))
        .sort((a, b) => a.t - b.t),
    [series],
  );

  const CH = 214; // the artboard's chart height
  const AXIS_W = 52;
  const TIME_H = 22;
  const plotW = Math.max(120, boxW - AXIS_W);
  const plotH = CH - TIME_H;
  const xRight = plotW - 10;
  /* The artboard reserved its bottom 30% for a comments histogram. `series` is
   * views per day and nothing else, so the line uses the room the histogram
   * would have taken; the top margin is the artboard's .06. */
  const yTop = plotH * 0.06;
  const yBot = plotH * 0.94;

  const drawable = points.length >= 2;
  const tMin = drawable ? points[0].t : 0;
  const tMax = drawable ? points[points.length - 1].t : 0;
  const values = points.map((p) => p.v);
  const vMax = values.length > 0 ? Math.max(...values) : 0;
  /* Views per day start at zero: a chart zoomed to the top of the range makes
   * a flat week look like a cliff. */
  const vMin = 0;

  const yTicks = ticksFor(vMin, vMax, 4);
  const x = (ms: number) => (tMax > tMin ? ((ms - tMin) / (tMax - tMin)) * xRight : xRight / 2);
  const y = (v: number) => (vMax > vMin ? yBot - ((v - vMin) / (vMax - vMin)) * (yBot - yTop) : yBot);

  const xTickCount = Math.max(2, Math.min(7, Math.round(plotW / 130)));
  const xTicks: number[] = [];
  if (drawable) {
    for (let i = 0; i < xTickCount; i++) xTicks.push(tMin + ((tMax - tMin) * i) / (xTickCount - 1));
  }

  const line = drawable
    ? points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(2)} ${y(p.v).toFixed(2)}`).join(" ")
    : "";
  const area = drawable
    ? `${line} L${x(tMax).toFixed(2)} ${yBot.toFixed(2)} L${x(tMin).toFixed(2)} ${yBot.toFixed(2)} Z`
    : "";

  /** The chart states its own range: the days it actually holds when it holds
   * any, the requested window when it does not. */
  const chartRange = drawable
    ? `${day(new Date(tMin), locale)} – ${day(new Date(tMax), locale)}`
    : `${day(range.start, locale)} – ${day(range.end, locale)}`;
  const chartCaption =
    sourceLine === "" ? chartRange : `${chartRange} · ${zh ? "来源" : "source"}: ${sourceLine}`;

  /* --------------------------------------------------------- fragments */

  const dash = (why: string) => (
    <span style={{ color: "#c7c7c7" }} title={why}>
      —
    </span>
  );
  const notReported = t("not reported by this platform");

  const syncButton = (
    <button
      type="button"
      className="btn s"
      aria-disabled={pending}
      disabled={pending}
      onClick={() => props.onSyncNow()}
    >
      {pending ? `${t("Checking")}…` : t("Check now")}
    </button>
  );

  /** The five headline numbers. `null` means the platforms did not report it,
   * and says so; it never becomes a zero. */
  const stats: { label: string; value: string; title: string }[] = [
    /*
     * Two view numbers, because there are two (REVIEW.md #6).
     *
     * The tile used to sum lifetime views of posts published in the window and
     * sit directly above a chart summing views gained *during* it. On a
     * channel with history that is 1.4M over a chart totalling 40k, and
     * neither figure is wrong — together, unlabelled, they were unreadable.
     */
    {
      label: t("Views in window"),
      value: compact(totals.viewsInWindow, locale),
      title: zh
        ? `窗口期内新增播放量：${full(totals.viewsInWindow, locale)}（与下方图表一致）`
        : `${full(totals.viewsInWindow, locale)} gained during this window. This is what the chart below sums.`,
    },
    {
      label: t("Lifetime views"),
      value: compact(totals.views, locale),
      title: zh
        ? `本窗口期发布的贴文的累计播放量：${full(totals.views, locale)}`
        : `${full(totals.views, locale)} in total, for the posts published in this window, over their whole lives.`,
    },
    {
      label: t("Likes"),
      value: compact(totals.likes, locale),
      title: full(totals.likes, locale),
    },
    {
      label: t("Comments"),
      value: compact(totals.comments, locale),
      title: full(totals.comments, locale),
    },
    {
      label: t("Engagement rate"),
      value: totals.engagementRate === null ? "—" : pct1(totals.engagementRate, locale),
      title: totals.engagementRate === null ? notReported : pct1(totals.engagementRate, locale),
    },
    {
      label: t("Posts"),
      value: full(totals.posts, locale),
      title: full(totals.posts, locale),
    },
  ];

  /** A sortable column head: the artboard's 10.5px label, plus the arrow that
   * says which way the table is actually ordered. */
  const sortHead = (key: SortKey, label: string, numeric: boolean) => {
    const on = sort.key === key;
    return (
      <div className={numeric ? "num" : undefined}>
        <button
          type="button"
          onClick={() => props.onSort(key)}
          aria-label={
            on
              ? `${label}, ${sort.dir === "asc" ? (zh ? "升序" : "ascending") : zh ? "降序" : "descending"}`
              : `${label}, ${zh ? "点击排序" : "sort by this"}`
          }
          style={{ color: on ? "#171717" : undefined }}
        >
          {label}
          <span style={{ fontSize: 8, color: on ? "#171717" : "#c7c7c7" }}>
            {on ? (sort.dir === "asc" ? "▲" : "▼") : "▼"}
          </span>
        </button>
      </div>
    );
  };

  const frameStyle = { ["--ac" as string]: ACCENT } as React.CSSProperties;

  /* ------------------------------------------------------------ render */

  /**
   * What the panel can say from these rows alone.
   *
   * The artboard scripted a paragraph and a cost. This names the best and
   * worst post in the window and nothing else, because that is the whole of
   * what this screen knows without asking a model.
   */
  const agentNote = React.useMemo(() => {
    if (rows.length === 0) {
      return zh ? "这个时段内没有发布任何内容。" : "Nothing was published in this window.";
    }
    const withViews = rows.filter((r) => r.views !== null);
    if (withViews.length === 0) {
      return zh
        ? "这些帖子还没有可用的数据，平台通常会延迟两三天。"
        : "None of these posts has readable numbers yet. Platforms usually run two to three days behind.";
    }
    const best = withViews.reduce((a, b) => ((b.views ?? 0) > (a.views ?? 0) ? b : a));
    const worst = withViews.reduce((a, b) => ((b.views ?? 0) < (a.views ?? 0) ? b : a));
    const title = (r: PerformanceRow) => (r.title ?? "").slice(0, 40) || (zh ? "无标题" : "untitled");
    const unreported = rows.length - withViews.length;

    return [
      zh
        ? `表现最好的是《${title(best)}》，${full(best.views ?? 0, locale)} 次播放；最低的是《${title(worst)}》，${full(worst.views ?? 0, locale)} 次。`
        : `The strongest post is “${title(best)}” at ${full(best.views ?? 0, locale)} views. The weakest is “${title(worst)}” at ${full(worst.views ?? 0, locale)}.`,
      unreported > 0
        ? zh
          ? `另有 ${full(unreported, locale)} 个贴文尚无数据。`
          : `${full(unreported, locale)} posts have no numbers yet.`
        : "",
    ]
      .filter(Boolean)
      .join(zh ? "" : " ");
  }, [rows, zh, locale]);

  return (
    <div
      data-perf-screen=""
      style={{
        ...frameStyle,
        flexGrow: 1,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        background: "#ffffff",
        color: "#171717",
        overflow: "hidden",
      }}
    >
      <style>{CSS}</style>

      {/* The artboard also drew a search box and a notification bell here.
          Neither had anything behind it, so neither is drawn: global search
          lives on the rail, at /search. What replaces them is the provenance
          the spec asks every chart for — the range, the sources, the age. */}
      <div className="bar">
        <span className="h1">{t("Content performance")}</span>
        <span className="mut">
          {day(range.start, locale)} – {day(range.end, locale)}
          {sourceLine === "" ? "" : ` · ${t("via")} ${sourceLine}`}
          {` · ${freshness}`}
        </span>
        <div style={{ flexGrow: 1 }} />
      </div>

      {channels.length === 0 ? (
        /* Nothing is connected: an empty table with a zero above it reads as a
           studio that published nothing, which is a different and much worse
           claim than "we cannot see anything yet". */
        <div style={{ padding: "40px 20px", maxWidth: 460 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{t("No channel is connected yet")}</div>
          <p className="mut" style={{ lineHeight: 1.55, marginTop: 6 }}>
            {t(
              "Connect a YouTube, Instagram or LinkedIn account and this screen fills with your own posts and their numbers.",
            )}
          </p>
        </div>
      ) : (
        /* The artboard's body is a row: everything above, and its 312px Agent
           panel down the right-hand edge. */
        <div style={{ flexGrow: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
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
            <div className="tf">
              {(["7d", "28d", "90d"] as const).map((w) => (
                <div
                  key={w}
                  className={win === w ? "on" : undefined}
                  role="button"
                  tabIndex={0}
                  aria-pressed={win === w}
                  onClick={() => props.onWindow(w)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      props.onWindow(w);
                    }
                  }}
                >
                  {zh ? WINDOW_LABEL_ZH[w] : WINDOW_LABEL[w]}
                </div>
              ))}
            </div>
            {/* The artboard's "Channel: All ▾" chip, opened out: the studio's
                own platforms, from `channels`, never a fixed list. */}
            <div
              className={`chip${platform === null ? " pkon" : ""}`}
              role="button"
              tabIndex={0}
              aria-pressed={platform === null}
              onClick={() => props.onPlatform(null)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  props.onPlatform(null);
                }
              }}
            >
              {t("All")}
            </div>
            {platforms.map((key) => (
              <div
                key={key}
                className={`chip${platform === key ? " pkon" : ""}`}
                role="button"
                tabIndex={0}
                aria-pressed={platform === key}
                onClick={() => props.onPlatform(key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    props.onPlatform(key);
                  }
                }}
              >
                {platformName(key)}
              </div>
            ))}
            <div style={{ flexGrow: 1 }} />
            {syncButton}
          </div>

          <div
            style={{
              flexShrink: 0,
              display: "grid",
              /* One row, whatever the count. It was hard-coded to five and
                 there are six tiles, so "posts" dropped onto a line of its
                 own — one small box under five, which reads as a mistake
                 rather than as a layout. */
              gridTemplateColumns: `repeat(${stats.length}, minmax(0,1fr))`,
              gap: 12,
              padding: "14px 20px 0",
            }}
          >
            {stats.map((s, i) => (
              <div className="stat" key={s.label}>
                <i>{s.label}</i>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
                  <b title={s.title}>{s.value}</b>
                  {/* The artboard put a sparkline in every card. Only views has
                      a day-by-day series behind it, so only views gets one. */}
                  {i === 0 && drawable ? (
                    <svg
                      viewBox="0 0 72 24"
                      style={{
                        width: 72,
                        height: 24,
                        fill: "none",
                        stroke: ACCENT,
                        strokeWidth: 1.6,
                        strokeLinecap: "round",
                        strokeLinejoin: "round",
                      }}
                    >
                      <polyline
                        points={points
                          .map((p, j) => {
                            const px = 2 + (j * 68) / (points.length - 1);
                            const py = vMax > 0 ? 22 - (p.v / vMax) * 20 : 12;
                            return `${px.toFixed(1)},${py.toFixed(1)}`;
                          })
                          .join(" ")}
                      />
                    </svg>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div style={{ flexShrink: 0, padding: "14px 20px 0" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{t("Daily views")}</span>
              <span className="cap">{t("across every post in the window")}</span>
              <div style={{ flexGrow: 1 }} />
              <span className="cap">{chartCaption}</span>
            </div>
            <div className="lwbox">
              <div ref={boxRef} style={{ width: "100%", height: CH }}>
                {drawable ? (
                  <svg
                    width={boxW}
                    height={CH}
                    viewBox={`0 0 ${boxW} ${CH}`}
                    style={{ display: "block", fontFamily: "Inter, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', 'Source Han Sans SC', system-ui, sans-serif" }}
                  >
                    <defs>
                      <linearGradient id="perf-area" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor={`${ACCENT}30`} />
                        <stop offset="1" stopColor={`${ACCENT}02`} />
                      </linearGradient>
                    </defs>
                    {yTicks.map((v) => (
                      <line key={`h${v}`} x1={0} x2={plotW} y1={y(v)} y2={y(v)} stroke="#f3f3f3" strokeWidth={1} />
                    ))}
                    {xTicks.map((ms, i) => (
                      <line key={`v${i}`} x1={x(ms)} x2={x(ms)} y1={0} y2={plotH} stroke="#f5f5f5" strokeWidth={1} />
                    ))}
                    <line x1={plotW + 0.5} x2={plotW + 0.5} y1={0} y2={plotH} stroke="#ededed" strokeWidth={1} />
                    <line x1={0} x2={boxW} y1={plotH + 0.5} y2={plotH + 0.5} stroke="#ededed" strokeWidth={1} />
                    <path d={area} fill="url(#perf-area)" stroke="none" />
                    <path
                      d={line}
                      fill="none"
                      stroke={ACCENT}
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {yTicks.map((v) => (
                      <text key={`hl${v}`} x={plotW + 8} y={y(v) + 4} fill="#999999" fontSize={11}>
                        {compact(v, locale)}
                      </text>
                    ))}
                    {xTicks.map((ms, i) => (
                      <text
                        key={`vl${i}`}
                        x={x(ms)}
                        y={plotH + 15}
                        fill="#999999"
                        fontSize={11}
                        textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"}
                      >
                        {day(new Date(ms), locale)}
                      </text>
                    ))}
                  </svg>
                ) : (
                  /* One day is not a line, and no days are not a chart. An
                     empty axis would read as a chart whose data failed. */
                  <div className="lwload">{t("not enough data yet")}</div>
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              flexGrow: 1,
              minHeight: 0,
              display: "grid",
              // Was a fixed 210px, which the table paid for. It shrinks first
              // now, and disappears below the width where it would squeeze the
              // titles.
              gridTemplateColumns: "minmax(0,180px) minmax(0,1fr)",
              gap: 16,
              padding: "14px 20px 16px",
              overflow: "hidden",
            }}
          >
            <div style={{ overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 11 }}>
                <span className="lbl" style={{ padding: 0 }}>
                  {t("By channel")}
                </span>
                <span className="cap">{t("views")}</span>
              </div>
              {byPlatform.length === 0 ? (
                <div className="cap" style={{ lineHeight: 1.5 }}>
                  {notReported}
                </div>
              ) : null}
              {byPlatform.map((p, i) => (
                <div key={p.key} style={{ marginBottom: 11 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 5 }}>
                    <span className="el">{platformName(p.key)}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums", color: "#525252" }}>
                      {full(p.views, locale)}
                    </span>
                  </div>
                  <div style={{ height: 7, borderRadius: 4, background: "#f3f3f3" }}>
                    <div
                      style={{
                        width: `${topPlatformViews > 0 ? Math.round((p.views / topPlatformViews) * 100) : 0}%`,
                        height: 7,
                        borderRadius: 4,
                        background: i === 0 ? ACCENT : "#c7c7c7",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ minWidth: 0, overflow: "auto" }}>
              {rows.length === 0 ? (
                /* Connected, but nothing went out in this period. */
                <div style={{ padding: "32px 12px", maxWidth: 460 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{t("No posts in this window")}</div>
                  <p className="mut" style={{ lineHeight: 1.55, marginTop: 6 }}>
                    {t("Nothing was published in this period. Try a longer window, or check for new posts now.")}
                  </p>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    {win === "90d" ? null : (
                      <button type="button" className="btn s" onClick={() => props.onWindow("90d")}>
                        {t("Show 90 days")}
                      </button>
                    )}
                    {syncButton}
                  </div>
                </div>
              ) : (
                <div className="t">
                  <div className="hd" style={{ gridTemplateColumns: GRID }}>
                    <div>{t("Post")}</div>
                    <div>{t("Channel")}</div>
                    {sortHead("publishedAt", t("Published"), false)}
                    {sortHead("views", t("Views"), true)}
                    {sortHead("likes", t("Likes"), true)}
                    {sortHead("comments", t("Comments"), true)}
                    <div className="num">{t("Watch-thru")}</div>
                    {sortHead("engagementRate", t("Engage"), true)}
                  </div>
                  {sorted.map((r) => (
                    <div key={r.id} className="tr" style={{ gridTemplateColumns: GRID, height: 42 }}>
                      <div style={{ gap: 10 }}>
                        {r.thumbnailUrl === null ? (
                          <div
                            style={{
                              width: 46,
                              height: 26,
                              borderRadius: 4,
                              background: "#f3f3f3",
                              flexShrink: 0,
                            }}
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.thumbnailUrl}
                            alt=""
                            // Google's thumbnail host refuses a cross-origin
                            // referrer, so without this every poster is broken.
                            referrerPolicy="no-referrer"
                            style={{ width: 46, height: 26, borderRadius: 4, objectFit: "cover", flexShrink: 0 }}
                          />
                        )}
                        {r.permalink === null ? (
                          <span className="el" title={r.title ?? undefined}>
                            {r.title ?? (zh ? "无标题" : "Untitled")}
                          </span>
                        ) : (
                          <a
                            className="el"
                            href={r.permalink}
                            target="_blank"
                            rel="noreferrer noopener"
                            title={r.title ?? r.permalink}
                          >
                            {r.title ?? (zh ? "无标题" : "Untitled")}
                          </a>
                        )}
                      </div>
                      <div>
                        <span className="bd gray" title={r.channelName ?? undefined}>
                          {platformName(r.platform)}
                        </span>
                      </div>
                      <div style={{ color: "#7c7c7c" }}>
                        {r.publishedAt === null ? (
                          dash(zh ? "没有发布时间" : "no publish date")
                        ) : (
                          <span
                            className="el"
                            title={new Intl.DateTimeFormat(tag(locale), {
                              dateStyle: "medium",
                              timeStyle: "short",
                            }).format(r.publishedAt)}
                          >
                            {timeAgo(r.publishedAt, locale)}
                          </span>
                        )}
                      </div>
                      <div className="num" title={r.views === null ? notReported : full(r.views, locale)}>
                        {r.views === null ? dash(notReported) : compact(r.views, locale)}
                      </div>
                      <div className="num" title={r.likes === null ? notReported : full(r.likes, locale)}>
                        {r.likes === null ? dash(notReported) : compact(r.likes, locale)}
                      </div>
                      <div className="num" title={r.comments === null ? notReported : full(r.comments, locale)}>
                        {r.comments === null ? dash(notReported) : compact(r.comments, locale)}
                      </div>
                      <div className="num">
                        {r.completionRate === null ? dash(notReported) : pct1(r.completionRate, locale)}
                      </div>
                      <div className="num">
                        {r.engagementRate === null ? dash(notReported) : pct1(r.engagementRate, locale)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <ResearchAgentPanel
          accent={ACCENT}
          zh={zh}
          scope={
            zh
              ? `${full(totals.posts, locale)} 个贴文 · ${full(channels.length, locale)} 个渠道`
              : `${full(totals.posts, locale)} posts · ${full(channels.length, locale)} channels`
          }
          note={agentNote}
          placeholder={zh ? "询问这些数据…" : "Ask about these numbers…"}
          model={model}
          onAsk={onAsk}
          thread={thread}
          tools={tools}
        />
        </div>
      )}
    </div>
  );
}
