"use client";

import * as React from "react";

/**
 * How long ago, in words — 刚刚, 3 分钟前, 2 小时前, 5 天前 — and past a month
 * the date on the studio's clock (9月1日).
 *
 * One component rather than an `ago()` call at each place, because of
 * hydration. The words depend on *now*, and the server's now is not the
 * browser's: the server writes them once, the browser hydrates a little
 * later, and whenever a minute boundary falls in between the two disagree —
 * React reports the text mismatch (error #418) and redraws the subtree from
 * scratch. Here the words sit in a <time> that carries
 * `suppressHydrationWarning`, so the server's text stands until the first
 * tick, and *now* is read from a shared one-minute ticker as an external
 * store — nothing impure runs during render, and a page left open keeps its
 * times fresh instead of saying 刚刚 for an hour.
 *
 * The exact moment is in `dateTime`, and as a tooltip in Hong Kong time
 * (unless a `title` is given) — the same on the server and in the browser,
 * whatever zone the reader is in.
 */
export function Ago({ iso, zh = true, title }: { iso: string | Date | null | undefined; zh?: boolean; title?: string }) {
  const now = React.useSyncExternalStore(subscribe, readMinute, readMinute);
  const at = iso == null ? NaN : typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  if (!Number.isFinite(at)) return null;
  return (
    <time dateTime={new Date(at).toISOString()} title={title ?? hkDateTime(at, zh)} suppressHydrationWarning>
      {agoText(at, now, zh)}
    </time>
  );
}

const MINUTE = 60_000;
const HK = "Asia/Hong_Kong";

/** The words, as a pure function of the two instants (ms since the epoch). */
export function agoText(at: number, now: number, zh: boolean): string {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return zh ? "刚刚" : "just now";
  if (s < 3600) return zh ? `${Math.round(s / 60)} 分钟前` : `${Math.round(s / 60)} min ago`;
  if (s < 86400) return zh ? `${Math.round(s / 3600)} 小时前` : `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 30) return zh ? `${Math.round(s / 86400)} 天前` : `${Math.round(s / 86400)} d ago`;
  return hkDay(at, zh);
}

/* The formatters are made once: building one is the expensive part. */
const DAY_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: HK, month: "numeric", day: "numeric" });
const DAY_EN = new Intl.DateTimeFormat("en-US", { timeZone: HK, month: "short", day: "numeric" });
const STAMP_ZH = new Intl.DateTimeFormat("zh-CN", { timeZone: HK, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const STAMP_EN = new Intl.DateTimeFormat("en-GB", { timeZone: HK, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** "9月1日" / "Sep 1", on the studio's clock. */
export function hkDay(at: number, zh: boolean): string {
  const d = new Date(at);
  if (!zh) return DAY_EN.format(d);
  const parts = DAY_PARTS.formatToParts(d);
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
  return `${get("month")}月${get("day")}日`;
}

/** "2026/10/03 08:03" / "3 Oct 2026, 08:03", on the studio's clock. */
export function hkDateTime(at: number, zh: boolean): string {
  return (zh ? STAMP_ZH : STAMP_EN).format(new Date(at));
}

/* One ticker for every <Ago> on the page. The snapshot is the current minute,
   so a tick that crosses no boundary re-renders nothing. */
const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;

function readMinute(): number {
  return Math.floor(Date.now() / MINUTE) * MINUTE;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (ticker === null) ticker = setInterval(() => listeners.forEach((fn) => fn()), MINUTE);
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}
