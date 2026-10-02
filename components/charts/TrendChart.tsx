"use client";

import * as React from "react";
import { AreaSeries, ColorType, TickMarkType, createChart, type Time, type UTCTimestamp } from "lightweight-charts";

/**
 * A number over time, drawn with TradingView's Lightweight Charts (the owner,
 * 29 Sep: "use an actual good chart lib"). `mini` is the sparkline in a
 * table cell or an account tile: no axes, no crosshair, no logo (the
 * attribution the licence asks for is on the 账号数据 page instead).
 *
 * (QA, 2 Oct) The big chart's TradingView logo sat on top of the line; it is
 * off, and a one-line text credit sits under the chart instead. The axis
 * printed the same date at every 6-hour reading; a date shows once, at the
 * day's first tick, and the ticks inside a day show the hour. More room on
 * top so the highest price label is not clipped.
 */
export function TrendChart({
  points,
  height = 220,
  width,
  color = "#1f6feb",
  mini = false,
  label,
  format,
  zh = true,
}: {
  points: { at: string; v: number }[];
  height?: number;
  width?: number;
  color?: string;
  mini?: boolean;
  label?: string;
  format?: (n: number) => string;
  /** The credit under the big chart is in the page's language. */
  zh?: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const key = points.map((p) => `${p.at}:${p.v}`).join("|");
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const data = byTime(points);
    if (data.length < 2) return;
    /* Over more than three days, one point a day (the day's last reading, Hong
       Kong time): the axis then has each date once and no hours between
       (QA, 2 Oct: 9月28日 twice, 9月29日 three times under a video's chart). */
    const daily = data[data.length - 1].time - data[0].time > 3 * 86_400 ? byDay(data) : null;
    if (daily && daily.length < 2) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#8a8a8a", fontSize: 11, fontFamily: "inherit", attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: !mini, color: "#f0efeb" } },
      rightPriceScale: { visible: !mini, borderVisible: false, scaleMargins: mini ? { top: 0.15, bottom: 0.1 } : { top: 0.2, bottom: 0.08 } },
      leftPriceScale: { visible: false },
      timeScale: { visible: !mini, borderVisible: false, fixLeftEdge: true, fixRightEdge: true, tickMarkFormatter: (t: Time, type: TickMarkType) => (type === TickMarkType.Time || type === TickMarkType.TimeWithSeconds ? hour(t) : day(t)) },
      crosshair: mini ? { vertLine: { visible: false, labelVisible: false }, horzLine: { visible: false, labelVisible: false } } : { vertLine: { color: "#c9c8c2", labelBackgroundColor: "#171717" }, horzLine: { color: "#c9c8c2", labelBackgroundColor: "#171717" } },
      handleScroll: false,
      handleScale: false,
      localization: { locale: "zh-CN", timeFormatter: (t: Time) => day(t), ...(format ? { priceFormatter: format } : {}) },
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor: fade(color, mini ? 0.14 : 0.2),
      bottomColor: fade(color, 0),
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: !mini,
      crosshairMarkerVisible: !mini,
      priceFormat: { type: "price", precision: 0, minMove: 1 },
    });
    series.setData(daily ?? data);
    chart.timeScale().fitContent();
    return () => chart.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mini, color, height]);
  const box = <div ref={ref} role="img" aria-label={label} style={{ width: width ?? "100%", height, position: "relative" }} />;
  if (mini) return box;
  return (
    <div style={{ width: width ?? "100%" }}>
      {box}
      <div style={{ fontSize: 10.5, color: "#b0afa9", textAlign: "right", marginTop: 4 }}>
        <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" style={{ color: "inherit", textDecoration: "none" }}>
          {zh ? "图表由 TradingView 提供" : "Charts by TradingView"}
        </a>
      </div>
    </div>
  );
}

/** One point per second, oldest first (the library refuses repeats and disorder). */
function byTime(points: { at: string; v: number }[]): { time: UTCTimestamp; value: number }[] {
  const m = new Map<number, number>();
  for (const p of points) {
    const t = Math.floor(Date.parse(p.at) / 1000);
    if (Number.isFinite(t) && Number.isFinite(p.v)) m.set(t, p.v);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([t, v]) => ({ time: t as UTCTimestamp, value: v }));
}

/** The last reading of each Hong Kong day, as that day. */
function byDay(data: { time: UTCTimestamp; value: number }[]): { time: string; value: number }[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" });
  const m = new Map<string, number>();
  for (const p of data) m.set(fmt.format(new Date(p.time * 1000)), p.value);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([time, value]) => ({ time, value }));
}

function day(t: Time): string {
  if (typeof t === "string") {
    const [, mo, d] = t.split("-").map(Number);
    return `${mo}月${d}日`;
  }
  const d = typeof t === "number" ? new Date(t * 1000) : new Date(t.year, t.month - 1, t.day);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function hour(t: Time): string {
  const d = typeof t === "number" ? new Date(t * 1000) : typeof t === "string" ? new Date(t) : new Date(t.year, t.month - 1, t.day);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fade(hex: string, a: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
